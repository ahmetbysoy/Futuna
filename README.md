# Futuna

Türkçe arayüzlü, mikro-modüler bir Vite + React vadeli piyasa izleme paneli. Piyasa özeti, sinyaller, akış/derinlik, favoriler, tarayıcı, desen havuzu, oturum kaydı ve walk-forward backtest ekranlarını içerir.

## Geliştirme

```sh
npm ci
npm run dev
```

Üretim derlemesi ve tip kontrolleri:

```sh
npm run check
npm run build
```

## Playwright E2E

Desktop Chromium, Firefox ve WebKit ile Pixel 7/iPhone WebKit mobil profilleri için headless testler tanımlıdır. Testler Binance REST/WebSocket yanıtlarını deterministik fixture’larla taklit eder; canlı borsa bağlantısını doğrulamaz.

```sh
npm run test:e2e:install # Playwright browser motorlarını indir
npm run test:e2e         # tüm desktop + mobile test matrisi
npm run test:e2e:ui      # etkileşimli Playwright arayüzü
npm run test:e2e:ui:live # canlı test arayüzü, port 9323
npm run test:e2e:report  # son HTML raporunu aç
```

Linux’ta browser sistem bağımlılıkları için ilk kurulumda:

```sh
sudo npx playwright install-deps chromium firefox webkit
```

Dashboard ekran görüntüleri `artifacts/screenshots/` altında; görsel karşılaştırma baseline’ları `e2e/screenshots.spec.ts-snapshots/` altındadır.

## GitHub Pages

`main` dalına her push, `.github/workflows/pages.yml` ile build ve GitHub Pages deploy’unu başlatır. Actions tamamlandıktan sonra site şu adreste yayınlanır:

<https://ahmetbysoy.github.io/Futuna/>
