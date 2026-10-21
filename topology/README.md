# Etkileşimli topoloji haritası

TourVisio uçak API mimari planının (`../README.md`) 3D topoloji haritası: bileşenler, bağlantılar ve beş temel akış. Tek bir HTML dosyasıdır, harici istek yapmaz, `file://` ile doğrudan açılır.

## Nasıl açılır

`dist/tourvisio-topology.html` dosyasını çift tıklayın ya da tarayıcıya sürükleyin. Sunucu, internet ya da kurulum gerekmez.

- **3D | 2D** (üstte, ya da `3` ve `2` tuşları): aynı yerleşimin iki izdüşümü. 900 px altındaki ekranlarda liste görünümü açılır.
- **Bileşene tıklayın**: bağlandığı her şey vurgulanır, panelde rol, teknoloji, erişim bölgesi, ölçek, "Kullanan" ve "Bağımlılıkları" ile planın ilgili bölümü görünür. `Esc` seçimi temizler.
- **Akış düğmeleri** (Uçuş arama, Listeleme, TourVisio token, Next.js kimlik doğrulama, Deploy): numaralı adımlar bağlantıların üstünde görünür. Sol ve sağ ok tuşları ya da alttaki düğmelerle adım adım ilerlenir, `Esc` akıştan çıkar.
- Sekmeler: Harita, Bileşenler (tablo), Akışlar (numaralı listeler), Hakkında (lejant, klavye kısayolları).
- Renkler: yeşil public, turuncu iç ağ, mavi dış servis, gri ileride (kesikli). Tema sistem ayarını izler, sağ üstteki düğme açık, koyu ve sistem arasında döner.
- Bağlantı adresi durumu saklar: `#view=2d&flow=search&step=3&node=redis`.

## Nasıl güncellenir

İçerik yalnız `topology.json` içindedir (bileşenler, konumlar, bağlantılar, akışlar). Değiştirdikten sonra:

```bash
node topology/build.cjs     # dist/tourvisio-topology.html üretir
node topology/verify.cjs    # "verify: OK" yazmalı, aksi halde exit 1
```

`verify.cjs` şemayı, referans bütünlüğünü (bağlantı uçları, akış adımları, ikonlar, ızgara çakışması), her iki izdüşümde yerleşim ve yönlendirmeyi, içerik kurallarını (em dash yok, harici istek yok) ve `dist` dosyasının güncel olup olmadığını denetler. Bir bileşenin `readme` alanındaki başlık `../README.md` içinde bulunamazsa uyarı verir (hata değildir).

`node topology/build.cjs --check` yalnız `dist` dosyasının güncelliğini doğrular.

## Dosyalar

| Yol | Rol |
|---|---|
| `topology.json` | Tek içerik kaynağı. Bir bileşen eklemek için `nodes` içine konum (`col`, `row`) ve `tier` ile bir kayıt, bağlantı için `edges`, akış adımı için `flows` içine ekleme yapılır. |
| `src/` | Görüntüleyici: `geometry.js` (ızgara yerleşimi, izometrik izdüşüm, bağlantı yönlendirme), `app.js` (çizim ve arayüz), `styles.css`, `index.template.html`, `icons.json`. |
| `assets/fonts/` | Geist ve Geist Mono (SIL Open Font License 1.1, `OFL.txt`). Derleme sırasında base64 olarak gömülür. |
| `build.cjs`, `verify.cjs` | Bağımsız Node betikleri (paket gerektirmez), çıktı deterministiktir. |
| `dist/tourvisio-topology.html` | Üretilmiş tek dosya. Elle düzenlemeyin. |

## Bilinen sınırlar

- 3D görünümde bileşen konumları `topology.json` içindeki ızgaradan gelir; yeni bir sütun eklenirse `tiers[].cols` de güncellenmelidir.
- `file://` ile açılan sayfalarda bazı tarayıcılar `localStorage` erişimini engeller; bu durumda tema seçimi hatırlanmaz, sayfa yine çalışır.
