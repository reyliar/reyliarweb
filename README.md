# reyliar.xyz

A static Linktree-style single-page site base. The design is built around a red and black bio-link profile, a live Discord status card, social links, email contact, and a custom music player.

## Editing

- Profile text and links: `index.html`
- Colors, layout, and responsive rules: `styles.css`
- Discord API and music player behavior: `script.js`
- Main profile image: `assets/ada-wong-icon.jpg`
- Discord card fallback image: `assets/avatar.svg`
- Background image: `assets/resident-evil-banner.jpg`

## Discord API

The site uses a Cloudflare Worker for official Discord REST API profile data and Discord Gateway presence data for status/activity updates. Lanyard is only used as an extra fallback.

1. Enable Developer Mode in Discord.
2. Right-click the target Discord user and choose Copy User ID.
3. Put the ID in the `data-discord-user-id=""` field in `index.html`.
4. For presence to appear, the bot must share a server with the target user and `Presence Intent` must be enabled.

For quick testing, append `?discordId=USER_ID` to the URL.

### Official Discord API Proxy

Do not put a Discord bot token in frontend code. `workers/discord-user.js` can be deployed as a Cloudflare Worker to proxy the official Discord REST API.

If the bot token was ever pasted into chat, committed, or placed in client-side JavaScript, reset it from the Discord Developer Portal and store the new token as a secret.

Worker setup:

- Route: `reyliar.xyz/api/*`
- Secret: `DISCORD_BOT_TOKEN`
- Endpoint: `https://discord.com/api/v10/users/:user_id`
- View counter endpoint: `reyliar.xyz/api/views`
- KV binding: `VIEW_COUNTER`

Deploy:

```powershell
wrangler secret put DISCORD_BOT_TOKEN
wrangler deploy
```

`script.js` first tries `/api/discord-user` for the official Discord user object. That response provides the profile photo, avatar decoration, and `primary_guild` server tag badge. Activity/status are updated from the Discord Gateway presence payload returned by the same Worker.

The Worker also attempts to read presence through Discord Gateway. For that to work:

- The bot token must be valid.
- The bot must share a server with the target user.
- `Presence Intent` must be enabled in the Developer Portal.
- If needed, provide `DISCORD_PRESENCE_GUILD_ID` as a Worker environment variable.

If presence is found, status, activity, and activity icon are rendered from Discord Gateway data. If the profile bio is not available in the official REST user object, it is left blank and no old default bio is shown.

The `CNAME` file is ready for GitHub Pages: `reyliar.xyz`.
