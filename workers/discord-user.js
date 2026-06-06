import { DurableObject } from "cloudflare:workers";

const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_GATEWAY = "wss://gateway.discord.gg/?v=10&encoding=json";
const DEFAULT_USER_ID = "1421177012814614548";
const GATEWAY_INTENTS = 1 | 256;
const PRESENCE_TIMEOUT_MS = 8000;
const PROFILE_CACHE_SECONDS = 1;
const PROFILE_CACHE_MS = PROFILE_CACHE_SECONDS * 1000;
const PRESENCE_WAIT_MS = 1500;
const VIEW_COUNTER_KEY = "views:home";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const liveProfileHeaders = {
  "Cache-Control": `public, max-age=${PROFILE_CACHE_SECONDS}, must-revalidate`,
  "CDN-Cache-Control": "no-store",
  "Cloudflare-CDN-Cache-Control": "no-store",
};

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
      ...(init.headers || {}),
    },
  });
}

function profileCacheKey(url, userId) {
  return new Request(`${url.origin}${url.pathname}?userId=${userId}`);
}

function validDiscordId(value) {
  return /^\d{17,20}$/.test(value || "");
}

function hasViewCookie(request) {
  return /(?:^|;\s*)reyliar_viewed=1(?:;|$)/.test(request.headers.get("Cookie") || "");
}

async function handleViews(request, env) {
  if (!env.VIEW_COUNTER) {
    return json({ success: false, error: "VIEW_COUNTER is not configured" }, { status: 500 });
  }

  if (request.method !== "GET" && request.method !== "POST") {
    return json({ success: false, error: "Method not allowed" }, { status: 405 });
  }

  const shouldIncrement = request.method === "POST" && !hasViewCookie(request);
  const current = Number(await env.VIEW_COUNTER.get(VIEW_COUNTER_KEY)) || 0;
  const count = shouldIncrement ? current + 1 : current;

  if (shouldIncrement) {
    await env.VIEW_COUNTER.put(VIEW_COUNTER_KEY, String(count));
  }

  return json(
    {
      success: true,
      count,
      counted: shouldIncrement,
    },
    {
      headers: {
        "Cache-Control": "no-store",
        ...(shouldIncrement
          ? { "Set-Cookie": "reyliar_viewed=1; Max-Age=86400; Path=/; SameSite=Lax; Secure" }
          : {}),
      },
    }
  );
}

function normalizePresence(presence) {
  if (!presence) return null;

  return {
    source: "discord-gateway",
    discord_status: presence.status || "offline",
    status: presence.status || "offline",
    activities: presence.activities || [],
    client_status: presence.client_status || {},
    guild_id: presence.guild_id,
  };
}

function decodeGatewayMessage(data) {
  if (typeof data === "string") return data;
  return new TextDecoder().decode(data);
}

function fetchGatewayPresence(env, userId) {
  return new Promise((resolve) => {
    let ws;
    let sequence = null;
    let heartbeatTimer;
    let done = false;

    const finish = (presence) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      try {
        if (ws && ws.readyState === 1) ws.close(1000, "presence fetched");
      } catch {
        // Ignore cleanup failures.
      }
      resolve(normalizePresence(presence));
    };

    const timeout = setTimeout(() => finish(null), PRESENCE_TIMEOUT_MS);

    const send = (payload) => {
      if (ws?.readyState === 1) ws.send(JSON.stringify(payload));
    };

    const requestGuildMemberPresence = (guildId) => {
      if (!guildId) return;

      send({
        op: 8,
        d: {
          guild_id: guildId,
          user_ids: [userId],
          presences: true,
          nonce: `reyliar-${Date.now()}`.slice(0, 32),
        },
      });
    };

    try {
      ws = new WebSocket(DISCORD_GATEWAY);

      ws.addEventListener("message", (event) => {
        let packet;
        try {
          packet = JSON.parse(decodeGatewayMessage(event.data));
        } catch {
          return;
        }

        if (packet.s !== null && packet.s !== undefined) sequence = packet.s;

        if (packet.op === 10) {
          const interval = packet.d?.heartbeat_interval || 45000;
          heartbeatTimer = setInterval(() => send({ op: 1, d: sequence }), interval);

          send({
            op: 2,
            d: {
              token: env.DISCORD_BOT_TOKEN,
              intents: GATEWAY_INTENTS,
              properties: {
                os: "cloudflare-workers",
                browser: "reyliar.xyz",
                device: "reyliar.xyz",
              },
            },
          });
          return;
        }

        if (packet.op === 9 || packet.op === 7) {
          finish(null);
          return;
        }

        if (packet.t === "READY") {
          const preferredGuild = env.DISCORD_PRESENCE_GUILD_ID;
          const guildIds = preferredGuild
            ? [preferredGuild]
            : (packet.d?.guilds || []).map((guild) => guild.id).filter(Boolean).slice(0, 10);

          for (const guildId of guildIds) requestGuildMemberPresence(guildId);
          return;
        }

        if (packet.t === "GUILD_CREATE") {
          const presence = (packet.d?.presences || []).find((item) => item.user?.id === userId);
          if (presence) finish(presence);
          return;
        }

        if (packet.t === "PRESENCE_UPDATE" && packet.d?.user?.id === userId) {
          finish(packet.d);
          return;
        }

        if (packet.t === "GUILD_MEMBERS_CHUNK") {
          const presence = (packet.d?.presences || []).find((item) => item.user?.id === userId);
          if (presence) {
            finish(presence);
            return;
          }

          const member = (packet.d?.members || []).find((item) => item.user?.id === userId);
          if (member) finish({ status: "offline", activities: [], client_status: {}, guild_id: packet.d.guild_id });
        }
      });

      ws.addEventListener("close", () => {
        clearTimeout(timeout);
        finish(null);
      });

      ws.addEventListener("error", () => {
        clearTimeout(timeout);
        finish(null);
      });
    } catch {
      clearTimeout(timeout);
      finish(null);
    }
  });
}

export class DiscordProfileState extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.user = null;
    this.userFetchedAt = 0;
    this.userFetchPromise = null;
    this.userRateLimitedUntil = 0;
    this.presence = null;
    this.presenceWaiters = [];
    this.ws = null;
    this.sequence = null;
    this.heartbeatTimer = null;
    this.connecting = false;
    this.guildIds = [];
    this.userId = DEFAULT_USER_ID;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId") || DEFAULT_USER_ID;

    if (!validDiscordId(userId)) {
      return json({ success: false, error: "Invalid Discord user id" }, { status: 400 });
    }

    this.userId = userId;

    if (!this.env.DISCORD_BOT_TOKEN) {
      return json({ success: false, error: "DISCORD_BOT_TOKEN is not configured" }, { status: 500 });
    }

    try {
      const user = await this.getUser(userId);

      if (this.env.DISCORD_ENABLE_GATEWAY_PRESENCE !== "false") {
        this.ensureGateway(userId);
      }

      if (!this.presence && this.env.DISCORD_ENABLE_GATEWAY_PRESENCE !== "false") {
        await this.waitForPresence(PRESENCE_WAIT_MS);
      }

      return json(
        {
          success: true,
          source: "discord-rest",
          user,
          presence: this.presence,
        },
        { headers: liveProfileHeaders }
      );
    } catch (error) {
      return json(
        {
          success: false,
          error: error?.message || "Discord profile state failed",
        },
        { status: 502, headers: liveProfileHeaders }
      );
    }
  }

  async getUser(userId) {
    const now = Date.now();
    if (this.user && this.user.id === userId && now - this.userFetchedAt < PROFILE_CACHE_MS) {
      return this.user;
    }

    if (this.userFetchPromise) return this.userFetchPromise;

    if (now < this.userRateLimitedUntil) {
      if (this.user) return this.user;
      throw new Error("Discord user request is temporarily rate limited");
    }

    this.userFetchPromise = this.fetchUser(userId).finally(() => {
      this.userFetchPromise = null;
    });

    return this.userFetchPromise;
  }

  async fetchUser(userId) {
    const response = await fetch(`${DISCORD_API}/users/${userId}`, {
      headers: {
        Authorization: `Bot ${this.env.DISCORD_BOT_TOKEN}`,
        "User-Agent": "DiscordBot (https://reyliar.xyz, 1.0)",
      },
    });

    const payload = await response.json();

    if (response.status === 429) {
      const retryAfter = Number(payload.retry_after || response.headers.get("Retry-After") || 1);
      this.userRateLimitedUntil = Date.now() + Math.ceil(retryAfter * 1000);
      if (this.user) return this.user;
    }

    if (!response.ok) {
      throw new Error("Discord API request failed");
    }

    this.user = payload;
    this.userFetchedAt = Date.now();
    return payload;
  }

  ensureGateway(userId) {
    if (this.ws?.readyState === 1 || this.connecting) return;

    this.connecting = true;
    this.sequence = null;

    try {
      this.ws = new WebSocket(DISCORD_GATEWAY);
    } catch {
      this.connecting = false;
      return;
    }

    this.ws.addEventListener("message", (event) => this.handleGatewayMessage(event, userId));
    this.ws.addEventListener("close", () => this.closeGateway());
    this.ws.addEventListener("error", () => this.closeGateway());
  }

  closeGateway() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.ws = null;
    this.connecting = false;
  }

  handleGatewayMessage(event, userId) {
    let packet;
    try {
      packet = JSON.parse(decodeGatewayMessage(event.data));
    } catch {
      return;
    }

    if (packet.s !== null && packet.s !== undefined) this.sequence = packet.s;

    if (packet.op === 10) {
      const interval = packet.d?.heartbeat_interval || 45000;
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = setInterval(() => this.sendGateway({ op: 1, d: this.sequence }), interval);

      this.sendGateway({
        op: 2,
        d: {
          token: this.env.DISCORD_BOT_TOKEN,
          intents: GATEWAY_INTENTS,
          properties: {
            os: "cloudflare-workers",
            browser: "reyliar.xyz",
            device: "reyliar.xyz",
          },
        },
      });
      return;
    }

    if (packet.op === 7 || packet.op === 9) {
      this.closeGateway();
      return;
    }

    if (packet.t === "READY") {
      this.connecting = false;
      const preferredGuild = this.env.DISCORD_PRESENCE_GUILD_ID;
      this.guildIds = preferredGuild
        ? [preferredGuild]
        : (packet.d?.guilds || []).map((guild) => guild.id).filter(Boolean).slice(0, 10);

      for (const guildId of this.guildIds) this.requestGuildMemberPresence(guildId, userId);
      return;
    }

    if (packet.t === "GUILD_CREATE") {
      const presence = (packet.d?.presences || []).find((item) => item.user?.id === userId);
      if (presence) this.setPresence(presence);
      return;
    }

    if (packet.t === "PRESENCE_UPDATE" && packet.d?.user?.id === userId) {
      this.setPresence(packet.d);
      return;
    }

    if (packet.t === "GUILD_MEMBERS_CHUNK") {
      const presence = (packet.d?.presences || []).find((item) => item.user?.id === userId);
      if (presence) {
        this.setPresence(presence);
        return;
      }

      const member = (packet.d?.members || []).find((item) => item.user?.id === userId);
      if (member) this.setPresence({ status: "offline", activities: [], client_status: {}, guild_id: packet.d.guild_id });
    }
  }

  sendGateway(payload) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(payload));
  }

  requestGuildMemberPresence(guildId, userId) {
    if (!guildId) return;

    this.sendGateway({
      op: 8,
      d: {
        guild_id: guildId,
        user_ids: [userId],
        presences: true,
        nonce: `reyliar-${Date.now()}`.slice(0, 32),
      },
    });
  }

  setPresence(presence) {
    this.presence = normalizePresence(presence);
    const waiters = this.presenceWaiters.splice(0);
    for (const resolve of waiters) resolve(this.presence);
  }

  waitForPresence(timeoutMs) {
    if (this.presence) return Promise.resolve(this.presence);

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        const index = this.presenceWaiters.indexOf(done);
        if (index >= 0) this.presenceWaiters.splice(index, 1);
        resolve(this.presence);
      }, timeoutMs);

      const done = (presence) => {
        clearTimeout(timeout);
        resolve(presence);
      };

      this.presenceWaiters.push(done);
    });
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    if (url.pathname === "/api/views") {
      return handleViews(request, env);
    }

    if (request.method !== "GET") {
      return json({ success: false, error: "Method not allowed" }, { status: 405 });
    }

    if (!env.DISCORD_BOT_TOKEN) {
      return json({ success: false, error: "DISCORD_BOT_TOKEN is not configured" }, { status: 500 });
    }

    const userId = url.searchParams.get("userId") || DEFAULT_USER_ID;

    if (!validDiscordId(userId)) {
      return json({ success: false, error: "Invalid Discord user id" }, { status: 400 });
    }

    if (env.DISCORD_PROFILE_STATE) {
      const stub = env.DISCORD_PROFILE_STATE.getByName(userId);
      return stub.fetch(request);
    }

    const cache = caches.default;
    const cacheKey = profileCacheKey(url, userId);
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    const discordResponse = await fetch(`${DISCORD_API}/users/${userId}`, {
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        "User-Agent": "DiscordBot (https://reyliar.xyz, 1.0)",
      },
    });

    const payload = await discordResponse.json();

    if (!discordResponse.ok) {
      return json(
        { success: false, error: "Discord API request failed", discord: payload },
        { status: discordResponse.status }
      );
    }

    const presence = env.DISCORD_ENABLE_GATEWAY_PRESENCE === "false"
      ? null
      : await fetchGatewayPresence(env, userId);

    const response = json(
      {
        success: true,
        source: "discord-rest",
        user: payload,
        presence,
      },
      {
        headers: liveProfileHeaders,
      }
    );

    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  },
};
