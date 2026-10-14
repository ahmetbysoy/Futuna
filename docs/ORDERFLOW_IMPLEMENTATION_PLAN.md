# Order-Flow Implementation Plan

## Goal

Add a modular, read-only `src/features/orderflow/` layer to the existing Vite + React 19 dashboard. Preserve the current `signalEngine`/`DecisionContext`, throttled Order Book path, and unrelated Signals, Scanner, Pool, Backtest, and Favorites behavior. User-facing copy will be Turkish; code, filenames, comments, and commits remain English.

## Working rules

- Deliver one short milestone commit per completed phase; stage only files belonging to that phase.
- After every phase, run and read the output of `npm run check` and `npm run build`; after the engine phase onward, also run the relevant Vitest/E2E tests.
- Keep existing public market subscriptions and avoid private account/order APIs, API keys, and new runtime dependencies.
- Preserve Playwright E2E coverage; do not call fixture validation live-exchange validation.
- Do not stage the pre-existing, uncommitted `skills-lock.json` change.
- Use the repository's `react-vite-best-practices` and accessibility skills, the current interface guidelines, and `design-system/futures-scanner/MASTER.md` when implementing UI/performance work.

## Baseline and Phase 0

**Status: COMPLETE.**

- Inspected the existing market context, sequence-checked depth hook, REST market API/types, chart and chart panel, dashboard/flow integration, settings storage/UI, session recorder, alert monitor, current CSS/design system, and Playwright market fixtures.
- Inspected the reference HTML's calibrator, CVD/OBI, trade/DOM sweep, iceberg, wall tracking, compass, heatmap, and settings/preset sections. Known reference defects are explicitly listed in the source TODO: broken CVD slope arithmetic, permissive iceberg behavior with missing mid, DOM sweep missing from compass freshness, late `_notional` mutation, CSS-variable marker colors, and `shift()`-based heat-frame retention. These will not be copied.
- Verified installed Lightweight Charts v5 types: `ISeriesApi.attachPrimitive`/`detachPrimitive`, `createSeriesMarkers` and plugin `setMarkers`, `IPriceScaleApi.width()`, `timeToIndex(time, findNearest?)`, and `logicalToCoordinate`. Verified Fancy Canvas `useBitmapCoordinateSpace`; `drawBackground` belongs to an `IPrimitivePaneRenderer` returned by the primitive pane view.
- Baseline command `npm ci && npm run check && npm run build`: **PASS** (68 packages installed, audit reported 0 vulnerabilities; TypeScript/e2e type-check and Vite production build passed).
- Existing architecture notes: `MarketContext` currently retains short 65-second/3,000-trade and 400-liquidation buffers and emits a one-second `FlowSnapshot`; `useDepthBook` sequence-checks full local books but exposes only top-20 React levels at 400 ms. The new store must not replace or accelerate that React summary path.
- Live Binance behavior has not been independently confirmed; it remains **UNVERIFIED** until a real exchange stream can be observed in this environment.

## Phases and milestone checks

| Phase | Scope | Planned verification | Status |
|---|---|---|---|
| 0 | Inspect repository, baseline, reference behavior, and v5 APIs | `npm ci`, `npm run check`, `npm run build`; read outputs | Complete |
| 1 | Add order-flow types, React-independent bounded store, generation-safe market/depth ingestion, tick-size feed, throttled `useSyncExternalStore` hook | `npm run check`/`npm run build` PASS; 26 existing Playwright tests PASS; direct store smoke PASS for full depth/diffs, 8k trades, 500 liquidations, 40 events, 900 heat frames, and generation/spot guards | Complete |
| 2 | Add pure clock-injected engines: calibrator, CVD/OBI, trade detectors, spoof/filled, DOM sweep, iceberg, wall tracker, heat sampler, compass; integrate the raw-store runtime; add Vitest | `npm run test:unit`: 16/16 PASS; `npm run check` PASS; `npm run build` PASS; Playwright matrix 26/26 PASS | Complete |
| 3 | Add v5 `DepthPrimitive` and `createSeriesMarkers` integration; expose chart/series lifecycle; implement heatmap, ladder, rays, live walls, mid/spread/last-price lines | Primitive/time-projection tests plus E2E pan/zoom/resize/theme interactions; commit `a361002` | Complete |
| 4 | Add `DecisionStrip`, `FlowMini`, `CompassWidget`, `ChartStatusPill`; integrate chart panel/dashboard and expanded event list | Responsive dashboard and fixture-backed event-list/chart checks; commit `ed906f4` | Complete |
| 5 | Persist order-flow settings, searchable advanced cards, three presets and custom-preset state | E2E persistence, search, presets, symbol-threshold reset, global reset; commit `38aa307` plus Phase 7 acceptance-test extension | Complete |
| 6 | Connect flat order-flow events and delayed 10/30/60-second outcomes to session recorder; high-flow alert cooldown | Base event/alert integration `c486a3e`; delayed outcome capture, reload recovery, and stop-time flush `7cbb37f` | Complete |
| 7 | Harden reconnect/resync, offline/spot states, hidden-tab drawing, storage failures, memory/performance bounds | Deterministic reconnect/sequence-gap/spot/offline tests, depth/store bounds, stale-generation tests, storage failures, chart lifecycle; all final checks pass in `7cbb37f` | Complete (`7cbb37f`) |
| 8 | Optional pre-signal/hybrid score — explicitly excluded unless separately approved | Separate scope/PR only; never alter existing signal score silently | Out of scope |
| 9 | Final docs, test matrix, delivery report | `npm run check` PASS; `npm run test:unit` 34/34 PASS; `npm run build` PASS; configured Playwright matrix 47/47 PASS; live exchange reported as **UNVERIFIED** | Complete |

## Final verification (2026-10-14)

- `npm run check`: **PASS**.
- `npm run test:unit`: **34/34 PASS** across 9 test files.
- `npm run build`: **PASS** (Vite production build).
- `npm run test:e2e`: **47/47 PASS** with one Playwright worker across Chromium, Firefox, WebKit, mobile Chromium, and mobile WebKit.
- Tracked screenshots produced by E2E were restored; no generated screenshot changes are included.
- Phase 3–6 milestone commits: `a361002`, `ed906f4`, `38aa307`, `c486a3e`; Phase 6 delayed-outcome follow-up and Phase 7 hardening: `7cbb37f`.
- **Live Binance behavior remains UNVERIFIED.** E2E tests use deterministic fixtures and do not constitute live exchange validation.

## Cross-phase acceptance checklist

- [x] Store receives numeric-key full depth, applied diffs, trades, liquidations, mark/funding, and OI without React renders on every packet.
- [x] Symbol/mode/timeframe generations prevent stale stream writes; spot mode does not fabricate futures-only data.
- [x] Existing 400 ms top-20 `useDepthBook` publication and Order Book panel remain unchanged.
- [x] All high-rate collections have explicit count/time bounds; 15-minute heat history is a fixed ring, not repeated array shifting.
- [x] Pure engine coverage and store-driven runtime integration are in place; CVD/OBI and the separate compass do not modify `signalEngine` or decision scoring.
- [x] Heat sampling is capped to 220 bins per one-second frame and 900 frames; wall history and per-symbol calibration samples are bounded.
- [x] The v5 primitive resolves current price/time coordinates during each draw; time-projection tests and E2E pan/zoom/resize/theme interactions pass. Canvas colors are explicit RGBA values.
- [x] Detector events feed chart markers and the event UI; marker unit tests, flow UI checks, alert E2E, and session event/outcome E2E cover the separate consumers.
- [x] Existing decision/signal scoring remains unchanged; the scalping compass is a separate read-only indicator.
- [x] Settings persist and presets/search/symbol-threshold reset/global reset work; configured mobile E2E checks pass without horizontal overflow.
- [x] `npm run check`, `npm run test:unit`, `npm run build`, and the configured Playwright matrix pass. Live-exchange behavior remains **UNVERIFIED**.
