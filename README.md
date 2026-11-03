# Watch Logger

Mekanik saatin sapmasını (s/gün) ölçen PWA. Saatin fotoğrafını çekersin; uygulama saati görüntü
işlemeyle **otomatik okur** (hh:mm:ss.ss), gerçek çekim anıyla karşılaştırır ve kaydeder.

## Otomatik okuma (`src/cv/`, Web Worker'da, eğitim verisi yok)

1. **Kadran merkezi** — zıt gradyanlı kenar çiftlerinin orta noktaları oylanır (`center.ts`).
2. **Dakika halkası** — 60 çizginin 60. harmonik enerjisini en büyükleyen afin elips (ızgara + Nelder–Mead, `ring.ts`).
3. **Perspektif** — 60 çizginin iç uçları tek tek alt-pikselde bulunur, RANSAC homografi, 3 tur (`dial.ts`; tipik RMS 0,4–0,8 px).
4. **12 yönü** — saat endeksi fazı (30° periyot) + çubuk endeksi olmayan iki konum: taç (12) ve tarih (3) (`orient.ts`).
5. **Akrep/yelkovan** — lüm şeritleri; referans zamandan beklenen açılarla eşlenir (`hands.ts`).
6. **Saniye ibresi** — yelkovanın kesirli konumunun öngördüğü pencerede ince çizgi araması, tam çözünürlükte
   ağırlık merkezli TLS doğru (uç + kuyruk). İbre düzlemi kadrana paraleldir; izdüşümde homoteti ile eşlenir,
   bu yüzden **yön paralakstan etkilenmez**.

Örnek 6 fotoğrafta (10 s içinde çekilmiş) sapma −15,24 s, std 0,14 s; okunan saniye kesirleri 28 800 A/h
çarkın 1/8 s adımlarına ~±0,05 s içinde oturur. Güven düşükse veya uyarı varsa otomatik kaydetmez.

- **Gerçek zaman:** Cihaz saati `time.akamai.com` ile senkronlanır (Cristian algoritması, tipik ±5–30 ms).
- **Kare zamanı:** `requestVideoFrameCallback` ile yakalanan karenin zamanı, kamera gecikme kalibrasyonu ile düzeltilir.
- **Galeriden yükleme:** EXIF `DateTimeOriginal + SubSecTimeOriginal + OffsetTimeOriginal` (iPhone HEIC dahil).
- Veriler yalnızca cihazda (IndexedDB). CSV dışa/içe aktarma var.

## Geliştirme

```sh
pnpm install
pnpm dev      # https://<bilgisayar-ip>:5173 — iPhone'da aç, sertifika uyarısını geç
pnpm test                       # örnek HEIC'ler + heif-convert + magick varsa uçtan uca CV testi de çalışır
RAW=<gri-raw-dizini> pnpm exec tsx scripts/cv-eval.ts 1445 1446   # geliştirme: örneklerde okuma raporu
pnpm build    # dist/ → herhangi bir statik HTTPS host (GitHub/Cloudflare Pages)
```

## Kamera gecikmesi kalibrasyonu (bir kez)

1. Bilgisayarda uygulamayı aç → Ayarlar → **Referans saat**.
2. Telefonda Ayarlar → **Kalibrasyon çekimi** → ekranı çek.
3. Fotoğrafta görünen zamanı gir. 3–5 kez tekrarla; medyan kullanılır.
