# reyliar.xyz

Statik Linktree tarzi tek sayfalik site tabani. Tasarim kirmizi/siyah bio-link profili, Discord status alani ve sosyal link kartlari uzerine kurulu.

## Duzenleme

- Profil metni ve linkler: `index.html`
- Renkler, layout ve responsive ayarlar: `styles.css`
- Discord API baglantisi: `script.js`
- Ana profil gorseli: `assets/ada-wong-icon.jpg`
- Discord karti fallback gorseli: `assets/avatar.svg`
- Arka plan gorseli: `assets/resident-evil-banner.jpg`

## Discord API

Site, profil bilgileri icin Cloudflare Worker uzerinden resmi Discord REST API'yi, status/activity icin Discord Gateway presence verisini kullanir. Lanyard yalnizca ek fallback olarak denenir.

1. Discord'da Developer Mode ac.
2. reyliar kullanicisina sag tikla ve Copy User ID yap.
3. `index.html` icindeki `data-discord-user-id=""` alanina ID'yi yaz.
4. Presence gorunmesi icin botun hedef kullaniciyla ortak bir sunucuda olmasi ve `Presence Intent` ayarinin acik olmasi gerekir.

Hizli deneme icin URL sonuna `?discordId=USER_ID` de eklenebilir.

### Resmi Discord API proxy

Frontend'e Discord bot token koyma. Resmi Discord REST API icin `workers/discord-user.js` Cloudflare Worker olarak deploy edilebilir.

Bot token chat'e, commit'e veya client-side JavaScript'e girdiyse Discord Developer Portal'dan token'i resetle ve yeni token'i secret olarak kaydet.

Worker ayari:

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

`script.js`, once `/api/discord-user` uzerinden resmi Discord user object verisini dener. Buradan profil fotografi, avatar decoration ve `primary_guild` server tag badge'i gelir. Activity/status ayni Worker payload'indaki Discord Gateway presence verisinden guncellenir.

Worker ayrica Discord Gateway ile presence okumayi dener. Bunun calismasi icin:

- Bot token gecerli olmali.
- Bot, hedef kullaniciyla ortak bir sunucuda olmali.
- Developer Portal'da `Presence Intent` acik olmali.
- Gerekirse Worker env olarak `DISCORD_PRESENCE_GUILD_ID` verilebilir.

Presence bulunursa status, activity ve activity icon'u Discord Gateway verisinden gosterilir. Profil bio resmi REST user object icinde gelmezse bos birakilir; eski default bio otomatik gosterilmez.

GitHub Pages icin `CNAME` dosyasi hazir: `reyliar.xyz`.
