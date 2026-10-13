import type { DepthSyncStatus, MarketMode, Timeframe } from '@/features/market/types'

export type OrderflowSide = 'buy' | 'sell' | 'bid' | 'ask' | 'long' | 'short'
export type FlowSeverity = 'low' | 'medium' | 'high'
export type WallTrend = 'GROWING' | 'SHRINKING' | 'STABLE'
export type CompassDirection = 'BULL' | 'BEAR' | 'FLAT'
export type ObiTrend = 'RISING' | 'FALLING' | 'FLAT'
export type ObiAlignment = 'BULL' | 'BEAR' | 'MIXED'

export type FlowEventType =
  | 'WHALE'
  | 'SWEEP'
  | 'DOM SWEEP'
  | 'ABSORPTION?'
  | 'DELTA BURST'
  | 'SPOOF?'
  | 'FILLED'
  | 'ICEBERG'
  | 'LIQUIDATION'
  | 'WALL_NEW'
  | 'WALL_GROW'
  | 'WALL_EATEN'
  | 'WALL_GONE'

export interface OrderflowTrade {
  ts: number
  price: number
  notional: number
  side: 'buy' | 'sell'
}

export interface LiquidationRecord {
  ts: number
  price: number
  notional: number
  side: 'long' | 'short'
}

export interface FlowEventRecord {
  id: string
  type: FlowEventType
  sev: FlowSeverity
  text: string
  ts: number
  side?: OrderflowSide
  price?: number | null
  notional?: number
  direction?: 'LONG' | 'SHORT'
  source?: 'trade' | 'depth' | 'market'
  data?: Record<string, string | number | boolean | null>
}

export type FlowEventDraft = Omit<FlowEventRecord, 'id'>

export interface WallHistoryPoint {
  ts: number
  notional: number
}

export interface WallRecord {
  key: string
  side: 'bid' | 'ask'
  price: number
  notional: number
  history: WallHistoryPoint[]
  absorbedNotional: number
  absorbTs: number
  flashTs: number
  bornTs: number
  trend: WallTrend
}

export interface WallAgeRecord {
  key: string
  side: 'bid' | 'ask'
  price: number
  bornTs: number
  peakNotional: number
  lastSeenTs: number
}

export interface HeatmapBin {
  side: 'bid' | 'ask'
  price: number
  notional: number
}

/** `t` is a Unix timestamp in seconds for Lightweight Charts time conversion. */
export interface HeatFrame {
  t: number
  bins: HeatmapBin[]
  max: number
}

export interface CompassComponents {
  ice: number
  drift: number
  flow: number
  pull: number
  wall: number
}

export interface CompassState {
  score: number
  components: CompassComponents
  direction: CompassDirection
  label: string
  color: string
  updatedAt: number | null
}

export interface CvdMomentum {
  s10: number
  s30: number
  s60: number
  s180: number
  direction: CompassDirection
  accelerating: boolean
  allAligned: boolean
  score: number
}

export interface ObiSnapshot {
  s5: number
  s15: number
  s30: number
  s60: number
  aligned: ObiAlignment
  strength: number
  trend: ObiTrend
}

export interface DetectorConfig {
  whaleMin: number
  whaleAlerts: boolean
  wallPct: number
  liveWallCount: number
  liveWallRange: number
  compassHalf: 5_000 | 10_000 | 20_000 | 30_000
  compassIceTick: number
  compassWallTick: number
}

export interface OrderflowCalibration {
  warm: boolean
  samples: number
  threshold: number
  wallMin: number
  bigWhale: number
  p50: number | null
  p80: number | null
  p95: number | null
}

export interface OrderflowSnapshot {
  readonly symbol: string
  readonly mode: MarketMode
  readonly timeframe: Timeframe
  readonly generation: number
  readonly tickSize: number
  readonly depthTickSize: number
  readonly bestBid: number | null
  readonly bestAsk: number | null
  readonly spread: number | null
  readonly depthReady: boolean
  readonly depthSynced: boolean
  readonly depthStatus: DepthSyncStatus
  readonly tradeCount: number
  readonly liquidationCount: number
  readonly lastTrade: OrderflowTrade | null
  readonly lastLiquidation: LiquidationRecord | null
  readonly lastTradeTs: number | null
  readonly lastDepthTs: number | null
  readonly lastMarkTs: number | null
  readonly lastWsTs: number | null
  readonly lastSweepTs: number | null
  readonly lastSweepDirection: 'LONG' | 'SHORT' | null
  readonly markPrice: number | null
  readonly funding: number | null
  readonly oi: number | null
  readonly oiChangePct: number | null
  readonly cvd: CvdMomentum
  readonly obi: ObiSnapshot
  readonly events: readonly FlowEventRecord[]
  readonly walls: readonly WallRecord[]
  readonly compass: CompassState
  readonly calibration: OrderflowCalibration
  readonly heatFrameCount: number
}
