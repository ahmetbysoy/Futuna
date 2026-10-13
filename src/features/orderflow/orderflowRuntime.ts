import type { DepthSyncStatus, MarketMode, Timeframe } from '@/features/market/types'
import { systemClock, type Clock } from './clock'
import { orderflowStore, type OrderflowDepthActivity, type OrderflowRawState, type OrderflowStore } from './orderflowStore'
import { CompassEngine } from './engines/compassEngine'
import { FlowCalibrator, type StorageLike } from './engines/flowCalibrator'
import { HeatSampler } from './engines/heatSampler'
import { IcebergDetector, type IcebergContext } from './engines/icebergDetector'
import { MultiCvdEngine } from './engines/multiCvd'
import { computeBookObi, MultiObiEngine } from './engines/multiObi'
import { SpoofDetector, type SpoofDepthContext } from './engines/spoofDetector'
import { DomSweepDetector, type SweepDepthContext } from './engines/sweepDetector'
import { TradeDetectors } from './engines/tradeDetectors'
import { WallTracker, type WallTrackerInput } from './engines/wallTracker'
import type { DetectorConfig, FlowEventDraft, OrderflowTrade, WallAgeRecord } from './types'

const DEFAULT_CONFIG: DetectorConfig = {
  whaleMin: 300_000,
  whaleAlerts: true,
  wallPct: 90,
  liveWallCount: 5,
  liveWallRange: 0.5,
  compassHalf: 10_000,
  compassIceTick: 15,
  compassWallTick: 10,
}

const ENGINE_TICK_MS = 250
const HEAT_SAMPLE_RANGE_PCT = 0.01

export class OrderflowRuntime {
  readonly calibrator: FlowCalibrator
  readonly multiCvd: MultiCvdEngine
  readonly multiObi: MultiObiEngine
  readonly tradeDetectors: TradeDetectors
  readonly spoofDetector: SpoofDetector
  readonly sweepDetector: DomSweepDetector
  readonly icebergDetector: IcebergDetector
  readonly wallTracker: WallTracker
  readonly heatSampler: HeatSampler
  readonly compassEngine: CompassEngine

  private config: DetectorConfig = { ...DEFAULT_CONFIG }
  private generation: number | null = null
  private lastTrade: OrderflowTrade | null = null
  private lastLiquidation: OrderflowRawState['lastLiquidation'] = null
  private lastDepthActivity: OrderflowDepthActivity | null = null
  private previousBestBid: number | null = null
  private previousBestAsk: number | null = null
  private wallAges = new Map<string, WallAgeRecord>()
  private depthSeeded = false
  private processing = false
  private processAgain = false
  private unsubscribeRaw: (() => void) | null = null
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly store: OrderflowStore = orderflowStore,
    private readonly clock: Clock = systemClock,
    storage = getCalibrationStorage(),
  ) {
    this.calibrator = new FlowCalibrator(clock, storage)
    this.multiCvd = new MultiCvdEngine(clock)
    this.multiObi = new MultiObiEngine(clock)
    this.tradeDetectors = new TradeDetectors(clock)
    this.spoofDetector = new SpoofDetector(clock)
    this.sweepDetector = new DomSweepDetector(clock)
    this.icebergDetector = new IcebergDetector(clock)
    this.wallTracker = new WallTracker(clock)
    this.heatSampler = new HeatSampler()
    this.compassEngine = new CompassEngine()
  }

  start() {
    if (this.unsubscribeRaw) return () => this.stop()
    this.unsubscribeRaw = this.store.subscribeRaw(this.handleRawUpdate)
    this.timer = setInterval(() => this.tick(), ENGINE_TICK_MS)
    this.handleRawUpdate()
    return () => this.stop()
  }

  stop() {
    this.unsubscribeRaw?.()
    this.unsubscribeRaw = null
    if (this.timer != null) clearInterval(this.timer)
    this.timer = null
  }

  setConfig(config: Partial<DetectorConfig>) {
    this.config = normalizeConfig({ ...this.config, ...config })
    this.calibrator.setFallback(this.config.whaleMin)
    this.tick()
  }

  getConfig() {
    return { ...this.config }
  }

  /** Deterministic public tick for tests and non-React consumers. */
  tick(now = this.clock.now()) {
    const raw = this.store.getRawState()
    this.ensureGeneration(raw, now)
    if (!raw.depthSynced && (raw.lastTradeTs == null || now - raw.lastTradeTs > 180_000)) return

    const cvd = this.multiCvd.momentum(now)
    const obi = this.multiObi.alignment(now)
    const compass = this.compassEngine.compute({
      now,
      depthReady: raw.depthSynced && raw.depthReady,
      bestBid: raw.bestBid,
      bestAsk: raw.bestAsk,
      tickSize: raw.tickSize,
      normalizationNotional: this.calibrator.isWarm()
        ? this.calibrator.percentile(0.80) ?? this.calibrator.threshold() * 0.5
        : this.calibrator.threshold() * 0.5,
      cvd,
      events: Array.from(raw.events),
      walls: Array.from(raw.walls.values()),
      icebergs: this.icebergDetector.confirmedIcebergs(),
      lastSweepTs: raw.lastSweepTs,
      config: {
        compassHalf: this.config.compassHalf,
        compassIceTick: this.config.compassIceTick,
        compassWallTick: this.config.compassWallTick,
      },
    })
    this.store.setComputedMetrics(cvd, obi, compass)

    if (raw.depthSynced && raw.depthReady) {
      const frame = this.heatSampler.sample(this.heatInput(raw), now)
      if (frame) this.store.pushHeatFrame(frame)
    }
  }

  resetForTest(symbol = 'BTCUSDT', mode: MarketMode = 'futures', timeframe: Timeframe = '1m', now = this.clock.now()) {
    const generation = this.store.reset(symbol, mode, timeframe)
    this.ensureGeneration(this.store.getRawState(), now)
    return generation
  }

  private readonly handleRawUpdate = () => {
    if (this.processing) {
      this.processAgain = true
      return
    }
    this.processing = true
    try {
      do {
        this.processAgain = false
        this.processRaw(this.store.getRawState())
      } while (this.processAgain)
    } finally {
      this.processing = false
    }
  }

  private processRaw(raw: OrderflowRawState) {
    const now = this.clock.now()
    this.ensureGeneration(raw, now)

    if (raw.lastTrade && raw.lastTrade !== this.lastTrade) {
      this.lastTrade = raw.lastTrade
      this.processTrade(raw.lastTrade, raw, now)
    }

    if (raw.lastLiquidation && raw.lastLiquidation !== this.lastLiquidation) {
      this.lastLiquidation = raw.lastLiquidation
      if (raw.mode === 'futures') this.processLiquidation(raw.lastLiquidation)
    }

    const activity = raw.depthActivity
    if (activity && activity !== this.lastDepthActivity) {
      this.lastDepthActivity = activity
      this.processDepthActivity(activity, raw, now)
    }

    if (!raw.depthSynced && this.depthSeeded) this.resetDepthEngines(raw.depthStatus)
    if (raw.depthSynced && raw.depthReady && !this.depthSeeded) this.seedDepthEngines(raw, now)
  }

  private ensureGeneration(raw: OrderflowRawState, now: number) {
    if (this.generation === raw.generation) return
    this.generation = raw.generation
    this.lastTrade = null
    this.lastLiquidation = null
    this.lastDepthActivity = raw.depthActivity
    this.previousBestBid = null
    this.previousBestAsk = null
    this.wallAges.clear()
    this.depthSeeded = false
    this.tradeDetectors.reset()
    this.multiCvd.reset()
    this.multiObi.reset()
    this.spoofDetector.reset()
    this.sweepDetector.reset()
    this.icebergDetector.reset()
    this.wallTracker.reset()
    this.heatSampler.reset()
    this.compassEngine.reset()
    this.calibrator.reset(raw.symbol, this.config.whaleMin, now)
  }

  private processTrade(trade: OrderflowTrade, raw: OrderflowRawState, now: number) {
    this.calibrator.add(trade.notional, now)
    this.multiCvd.add(trade, now)
    const threshold = this.calibrator.threshold()
    const tradeEvents = this.tradeDetectors.onTrade(trade, threshold, this.config.whaleAlerts, now)
    this.emit(tradeEvents)

    if (!raw.depthSynced) return
    this.spoofDetector.onTrade(trade, now)
    this.sweepDetector.onTrade(trade, now)
    const context = this.icebergContext(raw)
    this.icebergDetector.onTrade(trade, context, now)
    this.wallTracker.onTrade(trade, raw.depthTickSize, now)
  }

  private processLiquidation(liquidation: NonNullable<OrderflowRawState['lastLiquidation']>) {
    const event: FlowEventDraft = {
      type: 'LIQUIDATION',
      sev: liquidation.notional >= this.calibrator.bigThreshold() ? 'high' : 'medium',
      text: `${liquidation.side === 'long' ? 'Long' : 'Short'} tasfiye · ${compact(liquidation.notional)} USDT @ ${priceText(liquidation.price)}`,
      ts: liquidation.ts,
      side: liquidation.side,
      price: liquidation.price,
      notional: liquidation.notional,
      source: 'market',
    }
    this.emit([event])
  }

  private processDepthActivity(activity: OrderflowDepthActivity, raw: OrderflowRawState, now: number) {
    if (activity.kind === 'status') {
      if (!raw.depthSynced) this.resetDepthEngines(activity.status)
      return
    }
    if (activity.kind === 'snapshot') {
      if (raw.depthSynced && raw.depthReady) this.seedDepthEngines(raw, now)
      return
    }
    if (!raw.depthSynced || !raw.depthReady) return
    if (!this.depthSeeded) this.seedDepthEngines(raw, now)

    const spoofContext: SpoofDepthContext = {
      bestBid: raw.bestBid,
      bestAsk: raw.bestAsk,
      previousBestBid: this.previousBestBid,
      previousBestAsk: this.previousBestAsk,
      tickSize: raw.tickSize,
      whaleThreshold: this.calibrator.threshold(),
    }
    const sweepContext: SweepDepthContext = {
      bestBid: raw.bestBid,
      bestAsk: raw.bestAsk,
      previousBestBid: this.previousBestBid,
      previousBestAsk: this.previousBestAsk,
      whaleThreshold: this.calibrator.threshold(),
    }
    const icebergContext = this.icebergContext(raw)

    const wallAgeUpserts: WallAgeRecord[] = []
    const wallAgeRemoves: string[] = []
    this.updateWallAgeSide(activity.bids, 'bid', raw.bids, now, wallAgeUpserts, wallAgeRemoves)
    this.updateWallAgeSide(activity.asks, 'ask', raw.asks, now, wallAgeUpserts, wallAgeRemoves)
    this.store.updateWallAges(wallAgeUpserts, wallAgeRemoves)

    const events = [
      ...this.spoofDetector.onDepthDiff(activity.bids, activity.asks, spoofContext, now),
      ...this.sweepDetector.onDepthDiff(activity.bids, activity.asks, sweepContext, now),
      ...this.icebergDetector.onDepthDiff(activity.bids, activity.asks, icebergContext, now),
    ]
    this.emit(events)

    const wallResult = this.wallTracker.update(this.wallInput(raw, now))
    if (wallResult.updated) this.store.replaceWalls(wallResult.walls)
    this.emit(wallResult.events)
    this.multiObi.snapshot(computeBookObi(raw.bids, raw.asks), now)
    const frame = this.heatSampler.sample(this.heatInput(raw), now)
    if (frame) this.store.pushHeatFrame(frame)

    this.previousBestBid = raw.bestBid
    this.previousBestAsk = raw.bestAsk
  }

  private seedDepthEngines(raw: OrderflowRawState, now: number) {
    this.spoofDetector.onSnapshot(raw.bids, raw.asks, now)
    this.sweepDetector.onSnapshot(raw.bids, raw.asks)
    this.icebergDetector.onSnapshot(raw.bids, raw.asks)
    this.multiObi.snapshot(computeBookObi(raw.bids, raw.asks), now)
    this.seedWallAges(raw, now)
    this.wallTracker.reset()
    const walls = this.wallTracker.seed(this.wallInput(raw, now))
    this.store.replaceWalls(walls)
    const frame = this.heatSampler.sample(this.heatInput(raw), now, true)
    if (frame) this.store.pushHeatFrame(frame)
    this.previousBestBid = raw.bestBid
    this.previousBestAsk = raw.bestAsk
    this.depthSeeded = true
  }

  private resetDepthEngines(_status: DepthSyncStatus) {
    this.depthSeeded = false
    this.previousBestBid = null
    this.previousBestAsk = null
    this.spoofDetector.reset()
    this.sweepDetector.reset()
    this.icebergDetector.reset()
    this.wallTracker.reset()
    this.heatSampler.reset()
    this.multiObi.reset()
    this.compassEngine.reset()
    this.wallAges.clear()
    this.store.replaceWalls([])
    this.store.replaceWallAges([])
    const now = this.clock.now()
    this.store.setComputedMetrics(this.multiCvd.momentum(now), this.multiObi.alignment(now), this.compassEngine.snapshot())
  }

  private emit(events: readonly FlowEventDraft[]) {
    for (const event of events) this.store.addFlowEvent(event)
  }

  private seedWallAges(raw: OrderflowRawState, now: number) {
    this.wallAges.clear()
    for (const [side, book] of [['bid', raw.bids], ['ask', raw.asks]] as const) {
      for (const [price, quantity] of book) {
        if (price <= 0 || quantity <= 0) continue
        const key = `${side}|${price}`
        const notional = price * quantity
        this.wallAges.set(key, { key, side, price, bornTs: now, peakNotional: notional, lastSeenTs: now })
      }
    }
    this.trimWallAges()
    this.store.replaceWallAges(Array.from(this.wallAges.values()))
  }

  private updateWallAgeSide(
    updates: readonly [number, number][],
    side: 'bid' | 'ask',
    book: ReadonlyMap<number, number>,
    now: number,
    upserts: WallAgeRecord[],
    removes: string[],
  ) {
    for (const [price, quantity] of updates) {
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(quantity) || quantity < 0) continue
      const key = `${side}|${price}`
      if (quantity === 0) {
        this.wallAges.delete(key)
        removes.push(key)
        continue
      }
      const notional = price * (book.get(price) ?? quantity)
      const previous = this.wallAges.get(key)
      const record: WallAgeRecord = {
        key,
        side,
        price,
        bornTs: previous?.bornTs ?? now,
        peakNotional: Math.max(previous?.peakNotional ?? 0, notional),
        lastSeenTs: now,
      }
      this.wallAges.set(key, record)
      upserts.push(record)
    }
    this.trimWallAges()
  }

  private trimWallAges() {
    while (this.wallAges.size > 2_000) {
      const firstKey = this.wallAges.keys().next().value as string | undefined
      if (firstKey == null) break
      this.wallAges.delete(firstKey)
    }
  }

  private wallInput(raw: OrderflowRawState, now: number): WallTrackerInput {
    return {
      bids: raw.bids,
      asks: raw.asks,
      bestBid: raw.bestBid,
      bestAsk: raw.bestAsk,
      tickSize: raw.tickSize,
      depthTickSize: raw.depthTickSize,
      wallMin: this.calibrator.wallThreshold(),
      liveWallCount: this.config.liveWallCount,
      liveWallRange: this.config.liveWallRange,
      trades: raw.trades,
      now,
    }
  }

  private heatInput(raw: OrderflowRawState) {
    return {
      bids: raw.bids,
      asks: raw.asks,
      bestBid: raw.bestBid,
      bestAsk: raw.bestAsk,
      depthTickSize: raw.depthTickSize,
      rangePct: HEAT_SAMPLE_RANGE_PCT,
    }
  }

  private icebergContext(raw: OrderflowRawState): IcebergContext {
    return {
      bestBid: raw.bestBid,
      bestAsk: raw.bestAsk,
      tickSize: raw.tickSize,
      depthTickSize: raw.depthTickSize,
      whaleThreshold: this.calibrator.threshold(),
    }
  }
}

function normalizeConfig(config: DetectorConfig): DetectorConfig {
  return {
    whaleMin: validPositive(config.whaleMin, DEFAULT_CONFIG.whaleMin),
    whaleAlerts: Boolean(config.whaleAlerts),
    wallPct: clamp(config.wallPct, 10, 100, DEFAULT_CONFIG.wallPct),
    liveWallCount: Math.round(clamp(config.liveWallCount, 2, 20, DEFAULT_CONFIG.liveWallCount)),
    liveWallRange: clamp(config.liveWallRange, 0.1, 2, DEFAULT_CONFIG.liveWallRange),
    compassHalf: [5_000, 10_000, 20_000, 30_000].includes(config.compassHalf)
      ? config.compassHalf
      : DEFAULT_CONFIG.compassHalf,
    compassIceTick: Math.round(clamp(config.compassIceTick, 1, 100, DEFAULT_CONFIG.compassIceTick)),
    compassWallTick: Math.round(clamp(config.compassWallTick, 1, 100, DEFAULT_CONFIG.compassWallTick)),
  }
}

function getCalibrationStorage(): StorageLike | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    const storage = window.localStorage
    return {
      getItem: (key) => storage.getItem(key),
      setItem: (key, value) => storage.setItem(key, value),
    }
  } catch {
    return undefined
  }
}

function validPositive(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function clamp(value: number, min: number, max: number, fallback: number) {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback
}

function compact(value: number) {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${(abs / 1_000).toFixed(1)}K`
  return String(Math.round(abs))
}

function priceText(value: number) {
  return value.toLocaleString('tr-TR', { maximumFractionDigits: 8 })
}

export const orderflowRuntime = new OrderflowRuntime()
