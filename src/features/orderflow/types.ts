import type { DepthSyncStatus, MarketMode, Timeframe } from '@/features/market/types'

export type OrderflowSide = 'buy' | 'sell' | 'bid' | 'ask' | 'long' | 'short'
export type FlowSeverity = 'low' | 'medium' | 'high'
export type WallTrend = 'GROWING' | 'SHRINKING' | 'STABLE'
export type CompassDirection = 'BULL' | 'BEAR' | 'FLAT'

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
}

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

export interface OrderflowSnapshot {
  symbol: string
  mode: MarketMode
  timeframe: Timeframe
  generation: number
  tickSize: number
  depthTickSize: number
  bestBid: number | null
  bestAsk: number | null
  spread: number | null
  depthReady: boolean
  depthSynced: boolean
  depthStatus: DepthSyncStatus
  tradeCount: number
  liquidationCount: number
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
  events: readonly FlowEventRecord[]
  walls: readonly WallRecord[]
  compass: CompassState
  heatFrameCount: number
}
