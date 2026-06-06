const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_GATEWAY = "wss://gateway.discord.gg/?v=10&encoding=json";
const DEFAULT_USER_ID = "1421177012814614548";
const GATEWAY_INTENTS = 1 | 256;
const PRESENCE_TIMEOUT_MS = 8000;
const VIEW_COUNTER_KEY = "views:home";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
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

    const cache = caches.default;
    const cacheKey = new Request(`${url.origin}${url.pathname}?userId=${userId}`, request);
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
        headers: {
          "Cache-Control": "public, max-age=75",
        },
      }
    );

    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  },
};
