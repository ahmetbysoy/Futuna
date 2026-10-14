# Order-Flow Layer

## Scope

`src/features/orderflow/` adds read-only market-microstructure views to the existing Vite + React dashboard. It does not submit orders, request account data, use API keys, connect private endpoints, or modify the existing `signalEngine`/`DecisionContext` scoring.

The UI is Turkish. The micro-module remains separate from the existing 400 ms, top-20 Order Book React path.

## Data flow

1. `MarketContext` consumes the existing public trade, liquidation, ticker, and mark streams. `useDepthBook` continues to seed and sequence-check the full depth book from REST snapshots plus WebSocket diffs.
2. Generation-tagged raw packets are copied into `orderflowStore`, which owns bounded ring buffers and emits raw updates independently of React.
3. `OrderflowRuntime` feeds pure clock-injected engines for trade/DOM events, CVD/OBI, walls, calibration, heat frames, and the separate scalping compass.
4. UI components subscribe to throttled snapshots with `useSyncExternalStore`. Alerts and the session recorder subscribe to events independently.
5. `DepthPrimitive` attaches to the Lightweight Charts v5 candlestick series. It renders the heatmap, DOM ladder, wall rays, and live-wall overlays through primitive pane views; price/time coordinates are resolved from the current chart transform during drawing.

## Retention and safety bounds

| Data | Bound |
|---|---|
| Order-flow trades | 8,000 entries and 10 minutes |
| Liquidations | 500 entries and 10 minutes; futures mode only |
| Flow-event feed | 40 entries |
| Heat history | 900 one-second frames (15 minutes), at most 220 bins per frame |
| Local depth held by the order-flow store | 1,500 levels per side high-water; trim to the nearest 1,000 when exceeded |
| Active walls / wall-age log | 20 / 2,000 |
| Spoof/iceberg/DOM detector working sets | Explicit per-engine caps (1,000–3,000 levels; trade queues capped at 8,000) |
| Compass inputs | 40 recent events, 20 walls, and 20 confirmed icebergs |
| OBI / calibration samples | 3,600 OBI samples over 3 minutes / 500 calibration samples per symbol |
| Session event list / session history | 2,000 events / 10 sessions |
| Pending delayed outcomes | 100 flow events; oldest pending event is evicted when full |
| Chart heatmap raster | At most 1.5 million byte cells per chart; oversized rasters are skipped |

The chart’s live-wall pulse pauses when the document is hidden and resumes when visible. The canvas uses explicit RGBA colors rather than CSS variables.

## Resilience and data quality

- Reconnects advance socket/snapshot generations; late REST snapshots and callbacks from replaced sockets are ignored.
- A futures depth sequence gap clears the visible depth state and requests a fresh seed before returning to `live`.
- Spot fallback is visibly labeled and cannot create futures-only liquidation events. When neither public source is available, order-flow status is explicitly offline/unavailable.
- Subscriber exceptions are isolated so a UI listener cannot stop raw ingestion or later listeners. Storage exceptions degrade to defaults/no-op writes rather than taking down the app.
- Event and deduplication collections are bounded. Local session records remain in browser storage; no account or user data is requested.

## Session outcome measurements

For each recorded order-flow event with a valid reference price, the recorder schedules observations at 10, 30, and 60 seconds. An outcome includes the reference and observed prices, signed return percentage, expected direction (when inferable), direction agreement, quote freshness, and a status. Quotes older than 30 seconds are not treated as valid outcome prices. If the session ends first, remaining windows are recorded as `session-ended` with null price/return fields. Pending windows are reconstructed from a saved active session after a page reload; the pending queue is capped at 100 events.

These are delayed observational measurements, not predictive probabilities or trading recommendations.

## Verification

```sh
npm run check
npm run test:unit
npm run build
npm run test:e2e
```

Playwright uses deterministic REST/WebSocket fixtures across Chromium, Firefox, WebKit, and the configured mobile profiles. The suite covers depth reconnect and sequence-gap resync, spot/offline labeling, alert/session event integration, session outcome timing (including reload and stop-time incomplete windows), settings search/presets/reset/persistence, and chart interaction through pan/zoom/theme changes and narrow resizing.

Latest final run (2026-10-14): `npm run check` **PASS**; `npm run test:unit` **34/34 PASS**; `npm run build` **PASS**; `npm run test:e2e` **47/47 PASS**.

**Live Binance behavior is UNVERIFIED.** Fixture-backed tests establish application behavior against controlled responses; they are not evidence that a live exchange connection has been validated. Optional Phase 8 pre-signal/hybrid scoring is intentionally out of scope.
