const DISCORD_API = "https://discord.com/api/v10";
const DEFAULT_USER_ID = "1421177012814614548";

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

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "GET") {
      return json({ success: false, error: "Method not allowed" }, { status: 405 });
    }

    if (!env.DISCORD_BOT_TOKEN) {
      return json({ success: false, error: "DISCORD_BOT_TOKEN is not configured" }, { status: 500 });
    }

    const url = new URL(request.url);
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

    const response = json(
      {
        success: true,
        source: "discord-rest",
        user: payload,
      },
      {
        headers: {
          "Cache-Control": "public, max-age=60",
        },
      }
    );

    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  },
};
