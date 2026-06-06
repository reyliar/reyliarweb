# reyliar.xyz

Statik Linktree tarzi tek sayfalik site tabani. Tasarim kirmizi/siyah bio-link profili, Discord status alani ve sosyal link kartlari uzerine kurulu.

## Duzenleme

- Profil metni ve linkler: `index.html`
- Renkler, layout ve responsive ayarlar: `styles.css`
- Discord/Lanyard API baglantisi: `script.js`
- Profil gorseli: `assets/avatar.svg`
- Arka plan gorseli: `assets/resident-evil-banner.jpg`

## Discord API

Site, Discord presence icin Lanyard kullanir: `https://api.lanyard.rest/v1/users/:user_id`.

1. Discord'da Developer Mode ac.
2. reyliar kullanicisina sag tikla ve Copy User ID yap.
3. `index.html` icindeki `data-discord-user-id=""` alanina ID'yi yaz.
4. Presence gorunmesi icin kullanicinin Lanyard Discord sunucusunda bulunmasi gerekir.

Hizli deneme icin URL sonuna `?discordId=USER_ID` de eklenebilir.

### Resmi Discord API proxy

Frontend'e Discord bot token koyma. Resmi Discord REST API icin `workers/discord-user.js` Cloudflare Worker olarak deploy edilebilir.

Bot token chat'e, commit'e veya client-side JavaScript'e girdiyse Discord Developer Portal'dan token'i resetle ve yeni token'i secret olarak kaydet.

Worker ayari:

- Route: `reyliar.xyz/api/discord-user`
- Secret: `DISCORD_BOT_TOKEN`
- Endpoint: `https://discord.com/api/v10/users/:user_id`

Deploy:

```powershell
wrangler secret put DISCORD_BOT_TOKEN
wrangler deploy
```

`script.js`, once `/api/discord-user` uzerinden resmi Discord user object verisini dener. Buradan profil fotografi, avatar decoration ve `primary_guild` server tag badge'i gelir. Activity/status icin Lanyard fallback kalir; cunku Discord REST API kullanicinin "Playing" presence verisini vermez.

`kv.bio` veya `kv.about` varsa bio olarak kullanilir; yoksa fallback metin gosterilir.

GitHub Pages icin `CNAME` dosyasi hazir: `reyliar.xyz`.
