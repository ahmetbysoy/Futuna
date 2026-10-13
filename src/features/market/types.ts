export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h'
export type MarketMode = 'futures' | 'spot-fallback' | 'offline'
export type ConnectionState = 'starting' | 'connecting' | 'live' | 'reconnecting' | 'offline'
export type DepthSyncStatus = 'offline' | 'connecting' | 'syncing' | 'live' | 'rest-fallback' | 'unavailable'

export interface MarketSymbol {
  symbol: string
  baseAsset: string
  quoteAsset: string
  tickSize: number
}

export interface Candle {
  /** Unix timestamp in seconds (Lightweight Charts business-day time). */
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  quoteVolume?: number
}

export interface QuoteSnapshot {
  lastPrice: number | null
  change24h: number | null
  high24h: number | null
  low24h: number | null
  quoteVolume24h: number | null
  markPrice: number | null
  fundingRate: number | null
  openInterest: number | null
  openInterestChange: number | null
  updatedAt: number | null
}

export interface FlowEvent {
  id: string
  kind: 'buy' | 'sell' | 'liquidation'
  symbol: string
  price: number
  notional: number
  timestamp: number
  label: string
}

export interface DepthLevel {
  price: number
  quantity: number
  notional: number
}

export interface FlowSnapshot {
  cvd60: number
  buyNotional60: number
  sellNotional60: number
  liquidationNotional60: number | null
  obi: number | null
  spread: number | null
  bidNotional: number | null
  askNotional: number | null
  bids: DepthLevel[]
  asks: DepthLevel[]
  events: FlowEvent[]
  lastTradeAt: number | null
  depthUpdatedAt: number | null
  depthStatus: DepthSyncStatus
}

export interface Ticker24h {
  symbol: string
  lastPrice: number
  priceChangePercent: number
  highPrice: number
  lowPrice: number
  quoteVolume: number
}

export interface MarketContextValue {
  symbols: MarketSymbol[]
  symbol: string
  timeframe: Timeframe
  mode: MarketMode
  modeReason: string | null
  connection: ConnectionState
  candles: Candle[]
  liveCandle: Candle | null
  quote: QuoteSnapshot
  flow: FlowSnapshot
  loadingSymbols: boolean
  loadingCandles: boolean
  error: string | null
  lastMessageAt: number | null
  setSymbol: (symbol: string) => void
  setTimeframe: (timeframe: Timeframe) => void
  refresh: () => void
  reconnect: () => void
  loadKlines: (symbol: string, timeframe: Timeframe, limit?: number) => Promise<Candle[]>
  loadTickers: () => Promise<Ticker24h[]>
}
