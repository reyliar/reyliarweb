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

`script.js`, profil fotografini ve favicon'u Discord CDN avatarina, avatar decoration'i varsa decoration assetine, activity/status alanini da Lanyard verisine gore gunceller. Discord `primary_guild`/`clan` verisi varsa kullanicinin server tag badge'i de isim yaninda gosterilir. `kv.bio` veya `kv.about` varsa bio olarak kullanilir; yoksa fallback metin gosterilir.

GitHub Pages icin `CNAME` dosyasi hazir: `reyliar.xyz`.
