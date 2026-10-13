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
| 1 | Add order-flow types, React-independent bounded store, generation-safe market/depth ingestion, tick-size feed, throttled `useSyncExternalStore` hook | Type-check/build; inspect store population with deterministic fixtures; existing Order Book behavior unchanged | In progress |
| 2 | Add pure clock-injected engines: calibrator, CVD/OBI, trade detectors, spoof/filled, DOM sweep, iceberg, wall tracker, heat sampler, compass; add Vitest | Engine-specific normal/threshold/cooldown/reset tests; `npm run test:unit`; check/build | Not started |
| 3 | Add v5 `DepthPrimitive` and `createSeriesMarkers` integration; expose chart/series lifecycle; implement heatmap, ladder, rays, live walls, mid/spread/last-price lines | Fixture-backed primitive drawing; pan/zoom/resize/theme alignment; mobile chart bounds; check/build | Not started |
| 4 | Add `DecisionStrip`, `FlowMini`, `CompassWidget`, `ChartStatusPill`; integrate chart panel/dashboard and expanded event list | Responsive 360/390/430/768/1280 checks; keyboard/semantic review; E2E snapshots; check/build | Not started |
| 5 | Persist order-flow settings, searchable advanced cards, three presets and custom-preset state | Persistence, preset, search and reset E2E; check/build | Not started |
| 6 | Connect flat order-flow events and delayed 10/30/60-second outcomes to session recorder; high-flow alert cooldown | Deterministic event/session JSON and one-alert checks; check/build | Not started |
| 7 | Harden reconnect/resync, offline/spot states, hidden-tab drawing, storage failures, memory/performance bounds | Soak/large-book checks; no stale-generation events; check/build/E2E | Not started |
| 8 | Optional pre-signal/hybrid score — explicitly excluded unless separately approved | Separate scope/PR only; never alter existing signal score silently | Out of scope |
| 9 | Final docs, test matrix, delivery report | `npm run check`, `npm run build`, `npm run test:unit`, `npm run test:e2e`; report live exchange as **UNVERIFIED** when applicable | Not started |

## Cross-phase acceptance checklist

- [ ] Store receives numeric-key full depth, applied diffs, trades, liquidations, mark/funding, and OI without React renders on every packet.
- [ ] Symbol/mode/timeframe generations prevent stale stream writes; spot mode does not fabricate futures-only data.
- [ ] Existing 400 ms top-20 `useDepthBook` publication and Order Book panel remain unchanged.
- [ ] All high-rate collections have explicit count/time bounds; 15-minute heat history is a fixed ring, not repeated array shifting.
- [ ] v5 chart primitive aligns to price/time coordinates on pan, zoom, resize, and theme change; canvas colors are explicit hex/RGBA values.
- [ ] Detector outputs appear consistently in chart markers, flow events, session records, and alerts.
- [ ] Existing decision/signal scoring remains unchanged; new compass is a separate read-only indicator.
- [ ] Settings persist and presets/search/reset work; mobile has no horizontal overflow.
- [ ] All configured checks and tests pass; live-exchange behavior is reported honestly.
