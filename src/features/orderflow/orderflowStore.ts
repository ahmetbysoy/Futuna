import type { DepthSyncStatus, MarketMode, Timeframe } from '@/features/market/types'
import { systemClock, type Clock } from './clock'
import type {
  CompassComponents,
  CompassState,
  FlowEventRecord,
  FlowEventType,
  FlowSeverity,
  CvdMomentum,
  HeatFrame,
  LiquidationRecord,
  ObiSnapshot,
  OrderflowCalibration,
  OrderflowSide,
  OrderflowSnapshot,
  OrderflowTrade,
  WallAgeRecord,
  WallRecord,
} from './types'

const MAX_TRADES = 8_000
const MAX_LIQUIDATIONS = 500
const MAX_EVENTS = 40
const MAX_HEAT_FRAMES = 900
const MAX_WALL_AGES = 2_000
const MAX_WALLS = 20
const MAX_BOOK_LEVELS = 1_500
const BOOK_LEVELS_AFTER_TRIM = 1_000
const TRADE_RETENTION_MS = 10 * 60_000
const LIQUIDATION_RETENTION_MS = 10 * 60_000
const HEAT_RETENTION_SEC = 900
const UI_SNAPSHOT_INTERVAL_MS = 100

export interface RingBufferView<T> extends Iterable<T> {
  readonly length: number
  first(): T | undefined
  last(): T | undefined
  toArray(): T[]
}

class RingBuffer<T> implements RingBufferView<T> {
  private values: Array<T | undefined>
  private head = 0
  private count = 0

  constructor(private readonly capacity: number) {
    this.values = new Array<T | undefined>(capacity)
  }

  get length() {
    return this.count
  }

  push(value: T) {
    if (this.count < this.capacity) {
      this.values[(this.head + this.count) % this.capacity] = value
      this.count += 1
      return
    }

    this.values[this.head] = value
    this.head = (this.head + 1) % this.capacity
  }

  first() {
    return this.count > 0 ? this.values[this.head] : undefined
  }

  last() {
    if (this.count === 0) return undefined
    return this.values[(this.head + this.count - 1) % this.capacity]
  }

  dropFirst() {
    if (this.count === 0) return undefined
    const value = this.values[this.head]
    this.values[this.head] = undefined
    this.head = (this.head + 1) % this.capacity
    this.count -= 1
    return value
  }

  clear() {
    this.values.fill(undefined)
    this.head = 0
    this.count = 0
  }

  toArray() {
    const result: T[] = []
    for (let index = 0; index < this.count; index += 1) {
      const value = this.values[(this.head + index) % this.capacity]
      if (value !== undefined) result.push(value)
    }
    return result
  }

  *[Symbol.iterator](): Iterator<T> {
    for (let index = 0; index < this.count; index += 1) {
      const value = this.values[(this.head + index) % this.capacity]
      if (value !== undefined) yield value
    }
  }
}

interface MutableOrderflowState {
  symbol: string
  mode: MarketMode
  timeframe: Timeframe
  sessionKey: string
  generation: number
  tickSize: number
  depthTickSize: number
  bids: Map<number, number>
  asks: Map<number, number>
  bestBid: number | null
  bestAsk: number | null
  spread: number | null
  depthReady: boolean
  depthSynced: boolean
  depthStatus: DepthSyncStatus
  lastUpdateId: number | null
  trades: RingBuffer<OrderflowTrade>
  liquidations: RingBuffer<LiquidationRecord>
  events: RingBuffer<FlowEventRecord>
  walls: Map<string, WallRecord>
  wallAges: Map<string, WallAgeRecord>
  heatFrames: RingBuffer<HeatFrame>
  lastTrade: OrderflowTrade | null
  lastLiquidation: LiquidationRecord | null
  lastTradeTs: number | null
  lastDepthTs: number | null
  lastMarkTs: number | null
  lastWsTs: number | null
  markPrice: number | null
  funding: number | null
  oi: number | null
  oiChangePct: number | null
  lastSweepTs: number | null
  lastSweepDirection: 'LONG' | 'SHORT' | null
  cvd: CvdMomentum
  obi: ObiSnapshot
  compass: CompassState
  calibration: OrderflowCalibration
  depthActivity: OrderflowDepthActivity | null
  eventSequence: number
}

export interface OrderflowRawState {
  readonly symbol: string
  readonly mode: MarketMode
  readonly timeframe: Timeframe
  readonly sessionKey: string
  readonly generation: number
  readonly tickSize: number
  readonly depthTickSize: number
  readonly bids: ReadonlyMap<number, number>
  readonly asks: ReadonlyMap<number, number>
  readonly bestBid: number | null
  readonly bestAsk: number | null
  readonly spread: number | null
  readonly depthReady: boolean
  readonly depthSynced: boolean
  readonly depthStatus: DepthSyncStatus
  readonly lastUpdateId: number | null
  readonly depthActivity: OrderflowDepthActivity | null
  readonly trades: RingBufferView<OrderflowTrade>
  readonly liquidations: RingBufferView<LiquidationRecord>
  readonly events: RingBufferView<FlowEventRecord>
  readonly walls: ReadonlyMap<string, WallRecord>
  readonly wallAges: ReadonlyMap<string, WallAgeRecord>
  readonly heatFrames: RingBufferView<HeatFrame>
  readonly lastTrade: OrderflowTrade | null
  readonly lastLiquidation: LiquidationRecord | null
  readonly lastTradeTs: number | null
  readonly lastDepthTs: number | null
  readonly lastMarkTs: number | null
  readonly lastWsTs: number | null
  readonly markPrice: number | null
  readonly funding: number | null
  readonly oi: number | null
  readonly oiChangePct: number | null
  readonly lastSweepTs: number | null
  readonly lastSweepDirection: 'LONG' | 'SHORT' | null
  readonly cvd: CvdMomentum
  readonly obi: ObiSnapshot
  readonly compass: CompassState
}

export interface DepthBookStatusUpdate {
  status: DepthSyncStatus
  updatedAt: number | null
  clearBook?: boolean
}

export interface DepthBookSnapshotUpdate {
  bids: ReadonlyMap<number, number>
  asks: ReadonlyMap<number, number>
  lastUpdateId: number
  status: 'syncing' | 'live'
  updatedAt: number
}

export interface DepthBookDiffUpdate {
  bids: readonly [number, number][]
  asks: readonly [number, number][]
  lastUpdateId: number
  updatedAt: number
}

export type OrderflowDepthActivity =
  | { kind: 'status'; status: DepthSyncStatus; updatedAt: number | null; clearBook?: boolean }
  | { kind: 'snapshot'; updatedAt: number; lastUpdateId: number }
  | {
      kind: 'diff'
      bids: readonly [number, number][]
      asks: readonly [number, number][]
      updatedAt: number
      lastUpdateId: number
    }

export type NewFlowEvent = Omit<FlowEventRecord, 'id' | 'ts'> & {
  id?: string
  ts?: number
}

function emptyComponents(): CompassComponents {
  return { ice: 0, drift: 0, flow: 0, pull: 0, wall: 0 }
}

function emptyCompass(): CompassState {
  return {
    score: 0,
    components: emptyComponents(),
    direction: 'FLAT',
    label: 'Nötr / sıkışma',
    color: '#93a59a',
    updatedAt: null,
  }
}

function emptyCvd(): CvdMomentum {
  return {
    s10: 0,
    s30: 0,
    s60: 0,
    s180: 0,
    direction: 'FLAT',
    accelerating: false,
    allAligned: false,
    score: 0,
  }
}

function emptyObi(): ObiSnapshot {
  return {
    s5: 0,
    s15: 0,
    s30: 0,
    s60: 0,
    aligned: 'MIXED',
    strength: 0,
    trend: 'FLAT',
  }
}

function createState(symbol: string, mode: MarketMode, timeframe: Timeframe, generation: number): MutableOrderflowState {
  const tickSize = 0.01
  return {
    symbol,
    mode,
    timeframe,
    sessionKey: `${symbol}|${mode}|${timeframe}`,
    generation,
    tickSize,
    depthTickSize: tickSize * 10,
    bids: new Map(),
    asks: new Map(),
    bestBid: null,
    bestAsk: null,
    spread: null,
    depthReady: false,
    depthSynced: false,
    depthStatus: mode === 'offline' ? 'offline' : 'connecting',
    lastUpdateId: null,
    trades: new RingBuffer<OrderflowTrade>(MAX_TRADES),
    liquidations: new RingBuffer<LiquidationRecord>(MAX_LIQUIDATIONS),
    events: new RingBuffer<FlowEventRecord>(MAX_EVENTS),
    walls: new Map(),
    wallAges: new Map(),
    heatFrames: new RingBuffer<HeatFrame>(MAX_HEAT_FRAMES),
    lastTrade: null,
    lastLiquidation: null,
    lastTradeTs: null,
    lastDepthTs: null,
    lastMarkTs: null,
    lastWsTs: null,
    markPrice: null,
    funding: null,
    oi: null,
    oiChangePct: null,
    lastSweepTs: null,
    lastSweepDirection: null,
    cvd: emptyCvd(),
    obi: emptyObi(),
    compass: emptyCompass(),
    calibration: {
      warm: false,
      samples: 0,
      threshold: 300_000,
      wallMin: 24_000,
      bigWhale: 600_000,
      p50: null,
      p80: null,
      p95: null,
    },
    depthActivity: null,
    eventSequence: 0,
  }
}

function validPositive(value: number) {
  return Number.isFinite(value) && value > 0
}

function copyWall(wall: WallRecord): WallRecord {
  return {
    ...wall,
    history: wall.history.map((point) => ({ ...point })),
  }
}

export class OrderflowStore {
  private state: MutableOrderflowState
  private snapshot: OrderflowSnapshot
  private generationSequence = 0
  private lastSnapshotAt = 0
  private snapshotTimer: ReturnType<typeof setTimeout> | null = null
  private listeners = new Set<() => void>()
  private rawListeners = new Set<() => void>()
  private eventListeners = new Set<(event: FlowEventRecord) => void>()

  constructor(private readonly clock: Clock = systemClock) {
    this.state = createState('', 'offline', '1m', 0)
    this.snapshot = {} as OrderflowSnapshot
    this.publishSnapshot()
  }

  readonly getSnapshot = () => this.snapshot

  readonly getServerSnapshot = () => this.snapshot

  readonly getRawState = (): OrderflowRawState => this.state

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly subscribeRaw = (listener: () => void) => {
    this.rawListeners.add(listener)
    return () => this.rawListeners.delete(listener)
  }

  readonly subscribeEvents = (listener: (event: FlowEventRecord) => void) => {
    this.eventListeners.add(listener)
    return () => { this.eventListeners.delete(listener) }
  }

  reset(symbol: string, mode: MarketMode = 'offline', timeframe: Timeframe = '1m') {
    if (this.snapshotTimer != null) {
      clearTimeout(this.snapshotTimer)
      this.snapshotTimer = null
    }

    this.generationSequence += 1
    this.state = createState(symbol, mode, timeframe, this.generationSequence)
    this.lastSnapshotAt = this.clock.now()
    this.publishSnapshot()
    this.notifyRawListeners()
    return this.state.generation
  }

  isGenerationCurrent(generation: number, symbol?: string) {
    return this.state.generation === generation && (symbol == null || this.state.symbol === symbol)
  }

  isCurrentMarket(symbol: string, mode: MarketMode, generation: number) {
    return this.state.symbol === symbol && this.state.mode === mode && this.state.generation === generation
  }

  isCurrentSession(sessionKey: string) {
    return this.state.sessionKey === sessionKey
  }

  setTickSize(symbol: string, generation: number, tickSize: number) {
    if (!this.isGenerationCurrent(generation, symbol) || !validPositive(tickSize)) return false
    this.state.tickSize = tickSize
    this.state.depthTickSize = Math.max(Number.EPSILON, tickSize * 10)
    this.changed()
    return true
  }

  setDepthStatus(symbol: string, generation: number, update: DepthBookStatusUpdate) {
    if (!this.isGenerationCurrent(generation, symbol)) return false
    const state = this.state
    if (update.clearBook) this.clearBook(state)
    state.depthStatus = update.status
    state.depthSynced = update.status === 'live' && state.depthReady
    if (update.status === 'offline' || update.status === 'connecting' || update.status === 'unavailable' || update.status === 'rest-fallback') {
      state.depthSynced = false
    }
    if (update.updatedAt != null && Number.isFinite(update.updatedAt)) state.lastDepthTs = update.updatedAt
    state.depthActivity = { kind: 'status', ...update }
    this.changed()
    return true
  }

  ingestDepthSnapshot(symbol: string, generation: number, update: DepthBookSnapshotUpdate) {
    if (!this.isGenerationCurrent(generation, symbol)) return false
    const state = this.state
    state.bids.clear()
    state.asks.clear()
    this.copyDepthSide(update.bids, state.bids, 'bid')
    this.copyDepthSide(update.asks, state.asks, 'ask')
    state.lastUpdateId = update.lastUpdateId
    state.depthStatus = update.status
    state.depthSynced = update.status === 'live'
    state.lastDepthTs = update.updatedAt
    state.depthActivity = { kind: 'snapshot', updatedAt: update.updatedAt, lastUpdateId: update.lastUpdateId }
    this.refreshTopOfBook(state)
    this.changed()
    return true
  }

  ingestDepthDiff(symbol: string, generation: number, update: DepthBookDiffUpdate) {
    if (!this.isGenerationCurrent(generation, symbol) || !this.state.depthSynced) return false
    this.applyDepthSide(update.bids, this.state.bids, 'bid')
    this.applyDepthSide(update.asks, this.state.asks, 'ask')
    this.state.lastUpdateId = update.lastUpdateId
    this.state.depthStatus = 'live'
    this.state.depthSynced = true
    this.state.lastDepthTs = update.updatedAt
    this.state.depthActivity = {
      kind: 'diff',
      bids: update.bids.map(([price, quantity]) => [price, quantity] as const),
      asks: update.asks.map(([price, quantity]) => [price, quantity] as const),
      lastUpdateId: update.lastUpdateId,
      updatedAt: update.updatedAt,
    }
    this.refreshTopOfBook(this.state)
    this.changed()
    return true
  }

  ingestTrade(symbol: string, generation: number, trade: OrderflowTrade) {
    if (!this.isGenerationCurrent(generation, symbol) || this.state.mode === 'offline') return false
    if (!Number.isFinite(trade.ts) || !validPositive(trade.price) || !validPositive(trade.notional)) return false

    const item = { ...trade }
    this.state.trades.push(item)
    this.pruneTimedBuffers(this.clock.now())
    this.state.lastTrade = item
    this.state.lastTradeTs = Math.max(this.state.lastTradeTs ?? 0, item.ts)
    this.changed()
    return true
  }

  ingestLiquidation(symbol: string, generation: number, liquidation: LiquidationRecord) {
    if (!this.isGenerationCurrent(generation, symbol) || this.state.mode !== 'futures') return false
    if (!Number.isFinite(liquidation.ts) || !validPositive(liquidation.price) || !validPositive(liquidation.notional)) return false

    const item = { ...liquidation }
    this.state.liquidations.push(item)
    this.pruneTimedBuffers(this.clock.now())
    this.state.lastLiquidation = item
    this.changed()
    return true
  }

  ingestMark(symbol: string, generation: number, markPrice: number | null, funding: number | null, ts: number) {
    if (!this.isGenerationCurrent(generation, symbol) || this.state.mode !== 'futures') return false
    if (!Number.isFinite(ts)) return false
    this.state.markPrice = validPositive(markPrice ?? 0) ? markPrice : null
    this.state.funding = funding != null && Number.isFinite(funding) ? funding : null
    this.state.lastMarkTs = ts
    this.changed()
    return true
  }

  ingestOpenInterest(symbol: string, generation: number, oi: number, changePct: number | null, ts: number) {
    if (!this.isGenerationCurrent(generation, symbol) || this.state.mode !== 'futures') return false
    if (!validPositive(oi) || !Number.isFinite(ts)) return false
    this.state.oi = oi
    this.state.oiChangePct = changePct != null && Number.isFinite(changePct) ? changePct : null
    this.changed()
    return true
  }

  ingestWsMessage(symbol: string, generation: number, ts: number) {
    if (!this.isCurrentMarket(symbol, this.state.mode, generation) || !Number.isFinite(ts)) return false
    this.state.lastWsTs = ts
    this.scheduleSnapshot()
    return true
  }

  addFlowEvent(event: NewFlowEvent) {
    const ts = event.ts ?? this.clock.now()
    const id = event.id ?? `${this.state.generation}-${Math.trunc(ts)}-${++this.state.eventSequence}`
    const record: FlowEventRecord = { ...event, id, ts }
    this.state.events.push(record)
    if (record.type === 'SWEEP' || record.type === 'DOM SWEEP') {
      const direction = record.direction ?? (record.side === 'buy' ? 'LONG' : record.side === 'sell' ? 'SHORT' : null)
      if (direction) {
        this.state.lastSweepTs = ts
        this.state.lastSweepDirection = direction
      }
    }
    this.changed()
    for (const listener of Array.from(this.eventListeners)) {
      try {
        listener(record)
      } catch (error) {
        console.error('Orderflow event subscriber failed', error)
      }
    }
    return record
  }

  setCompass(compass: CompassState) {
    this.state.compass = {
      ...compass,
      components: { ...compass.components },
    }
    this.changed()
  }

  setComputedMetrics(cvd: CvdMomentum, obi: ObiSnapshot, compass?: CompassState, calibration?: OrderflowCalibration) {
    this.state.cvd = { ...cvd }
    this.state.obi = { ...obi }
    if (compass) {
      this.state.compass = { ...compass, components: { ...compass.components } }
    }
    if (calibration) this.state.calibration = { ...calibration }
    this.changed()
  }

  replaceWalls(walls: readonly WallRecord[]) {
    this.state.walls.clear()
    for (const wall of walls.slice(0, MAX_WALLS)) this.state.walls.set(wall.key, copyWall(wall))
    this.changed()
  }

  upsertWall(wall: WallRecord) {
    this.state.walls.set(wall.key, copyWall(wall))
    while (this.state.walls.size > MAX_WALLS) {
      const firstKey = this.state.walls.keys().next().value as string | undefined
      if (firstKey == null) break
      this.state.walls.delete(firstKey)
    }
    this.changed()
  }

  removeWall(key: string) {
    if (this.state.walls.delete(key)) this.changed()
  }

  upsertWallAge(record: WallAgeRecord) {
    this.state.wallAges.set(record.key, { ...record })
    while (this.state.wallAges.size > MAX_WALL_AGES) {
      const firstKey = this.state.wallAges.keys().next().value as string | undefined
      if (firstKey == null) break
      this.state.wallAges.delete(firstKey)
    }
    this.changed()
  }

  replaceWallAges(records: readonly WallAgeRecord[]) {
    this.state.wallAges.clear()
    for (const record of records.slice(0, MAX_WALL_AGES)) this.state.wallAges.set(record.key, { ...record })
    this.changed()
  }

  updateWallAges(upserts: readonly WallAgeRecord[], removes: readonly string[]) {
    for (const key of removes) this.state.wallAges.delete(key)
    for (const record of upserts) this.state.wallAges.set(record.key, { ...record })
    while (this.state.wallAges.size > MAX_WALL_AGES) {
      const firstKey = this.state.wallAges.keys().next().value as string | undefined
      if (firstKey == null) break
      this.state.wallAges.delete(firstKey)
    }
    if (upserts.length > 0 || removes.length > 0) this.changed()
  }

  removeWallAge(key: string) {
    if (this.state.wallAges.delete(key)) this.changed()
  }

  pushHeatFrame(frame: HeatFrame) {
    if (!Number.isFinite(frame.t) || !Number.isFinite(frame.max) || frame.max < 0) return
    const validBins = frame.bins
      .filter((bin) => validPositive(bin.price) && validPositive(bin.notional))
      .slice(0, 220)
      .map((bin) => ({ ...bin }))
    this.state.heatFrames.push({ t: frame.t, bins: validBins, max: frame.max })
    while (this.state.heatFrames.first() && frame.t - this.state.heatFrames.first()!.t > HEAT_RETENTION_SEC) {
      this.state.heatFrames.dropFirst()
    }
    this.changed()
  }

  clearHeatFrames() {
    this.state.heatFrames.clear()
    this.changed()
  }

  clearFlowEvents() {
    this.state.events.clear()
    this.changed()
  }

  private copyDepthSide(source: ReadonlyMap<number, number>, target: Map<number, number>, side: 'bid' | 'ask') {
    for (const [price, quantity] of source) {
      if (validPositive(price) && validPositive(quantity)) target.set(price, quantity)
    }
    this.trimDepthSide(target, side)
  }

  private applyDepthSide(updates: readonly [number, number][], target: Map<number, number>, side: 'bid' | 'ask') {
    for (const [price, quantity] of updates) {
      if (!validPositive(price) || !Number.isFinite(quantity) || quantity < 0) continue
      if (quantity === 0) target.delete(price)
      else target.set(price, quantity)
    }
    this.trimDepthSide(target, side)
  }

  private trimDepthSide(book: Map<number, number>, side: 'bid' | 'ask') {
    if (book.size <= MAX_BOOK_LEVELS) return
    const keep = Array.from(book.entries())
      .sort(([left], [right]) => side === 'bid' ? right - left : left - right)
      .slice(0, BOOK_LEVELS_AFTER_TRIM)
    book.clear()
    for (const [price, quantity] of keep) book.set(price, quantity)
  }

  private refreshTopOfBook(state: MutableOrderflowState) {
    let bestBid = Number.NEGATIVE_INFINITY
    let bestAsk = Number.POSITIVE_INFINITY
    for (const [price, quantity] of state.bids) {
      if (quantity > 0 && price > bestBid) bestBid = price
    }
    for (const [price, quantity] of state.asks) {
      if (quantity > 0 && price < bestAsk) bestAsk = price
    }
    state.bestBid = Number.isFinite(bestBid) ? bestBid : null
    state.bestAsk = Number.isFinite(bestAsk) ? bestAsk : null
    state.spread = state.bestBid != null && state.bestAsk != null
      ? state.bestAsk - state.bestBid
      : null
    state.depthReady = state.bestBid != null && state.bestAsk != null
    if (!state.depthReady) state.depthSynced = false
  }

  private clearBook(state: MutableOrderflowState) {
    state.bids.clear()
    state.asks.clear()
    state.bestBid = null
    state.bestAsk = null
    state.spread = null
    state.depthReady = false
    state.depthSynced = false
    state.lastUpdateId = null
  }

  private pruneTimedBuffers(now: number) {
    const tradeCutoff = now - TRADE_RETENTION_MS
    while (this.state.trades.first() && this.state.trades.first()!.ts < tradeCutoff) this.state.trades.dropFirst()
    const liquidationCutoff = now - LIQUIDATION_RETENTION_MS
    while (this.state.liquidations.first() && this.state.liquidations.first()!.ts < liquidationCutoff) {
      this.state.liquidations.dropFirst()
    }
  }

  private changed() {
    this.notifyRawListeners()
    this.scheduleSnapshot()
  }

  private notifyRawListeners() {
    for (const listener of Array.from(this.rawListeners)) {
      try {
        listener()
      } catch (error) {
        console.error('Orderflow raw subscriber failed', error)
      }
    }
  }

  private scheduleSnapshot() {
    if (this.snapshotTimer != null) return
    const elapsed = this.clock.now() - this.lastSnapshotAt
    const delay = Math.max(0, UI_SNAPSHOT_INTERVAL_MS - Math.max(0, elapsed))
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = null
      this.publishSnapshot()
    }, delay)
  }

  private publishSnapshot() {
    const state = this.state
    const events = state.events.toArray().map((event) => ({ ...event }))
    const walls = Array.from(state.walls.values(), copyWall)
    const compass: CompassState = {
      ...state.compass,
      components: { ...state.compass.components },
    }
    this.snapshot = {
      symbol: state.symbol,
      mode: state.mode,
      timeframe: state.timeframe,
      generation: state.generation,
      tickSize: state.tickSize,
      depthTickSize: state.depthTickSize,
      bestBid: state.bestBid,
      bestAsk: state.bestAsk,
      spread: state.spread,
      depthReady: state.depthReady,
      depthSynced: state.depthSynced,
      depthStatus: state.depthStatus,
      tradeCount: state.trades.length,
      liquidationCount: state.liquidations.length,
      lastTrade: state.lastTrade ? { ...state.lastTrade } : null,
      lastLiquidation: state.lastLiquidation ? { ...state.lastLiquidation } : null,
      lastTradeTs: state.lastTradeTs,
      lastDepthTs: state.lastDepthTs,
      lastMarkTs: state.lastMarkTs,
      lastWsTs: state.lastWsTs,
      markPrice: state.markPrice,
      funding: state.funding,
      oi: state.oi,
      oiChangePct: state.oiChangePct,
      lastSweepTs: state.lastSweepTs,
      lastSweepDirection: state.lastSweepDirection,
      cvd: { ...state.cvd },
      obi: { ...state.obi },
      events,
      walls,
      compass,
      calibration: { ...state.calibration },
      heatFrameCount: state.heatFrames.length,
    }
    this.lastSnapshotAt = this.clock.now()
    for (const listener of Array.from(this.listeners)) {
      try {
        listener()
      } catch (error) {
        console.error('Orderflow snapshot subscriber failed', error)
      }
    }
  }
}

export const orderflowStore = new OrderflowStore()
export type StoredFlowEventType = FlowEventType
export type StoredFlowSeverity = FlowSeverity
export type StoredOrderflowSide = OrderflowSide
