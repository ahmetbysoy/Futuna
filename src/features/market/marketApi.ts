import type { Candle, DepthLevel, MarketMode, MarketSymbol, Timeframe, Ticker24h } from './types'

const FUTURES_REST = 'https://fapi.binance.com'
const PUBLIC_SPOT_REST = 'https://data-api.binance.vision'

export class MarketApiError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message)
    this.name = 'MarketApiError'
  }
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const requestController = new AbortController()
  const forwardAbort = () => requestController.abort()
  if (signal?.aborted) requestController.abort()
  else signal?.addEventListener('abort', forwardAbort, { once: true })
  const timeout = setTimeout(() => requestController.abort(), 12_000)

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: requestController.signal,
    })
    if (!response.ok) {
      const detail = response.status === 451
        ? 'Futures endpoint bu ağ/bölge için erişilebilir değil (HTTP 451).'
        : `Piyasa API yanıtı: HTTP ${response.status}.`
      throw new MarketApiError(detail, response.status)
    }

    try {
      return await response.json() as T
    } catch (error) {
      if (requestController.signal.aborted) throw error
      throw new MarketApiError('Piyasa API geçerli JSON döndürmedi.', response.status)
    }
  } catch (error) {
    if (error instanceof MarketApiError) throw error
    const message = requestController.signal.aborted && !signal?.aborted
      ? 'Piyasa API zaman aşımına uğradı (12 sn).'
      : error instanceof Error ? error.message : 'Ağ isteği tamamlanamadı.'
    throw new MarketApiError(message)
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', forwardAbort)
  }
}

interface ExchangeInfoResponse {
  symbols?: Array<{
    symbol: string
    baseAsset: string
    quoteAsset: string
    status: string
    contractType?: string
    filters?: Array<{ filterType: string; tickSize?: string }>
    isSpotTradingAllowed?: boolean
  }>
}

function parseSymbols(payload: ExchangeInfoResponse, mode: MarketMode): MarketSymbol[] {
  return (payload.symbols ?? [])
    .filter((item) => item.quoteAsset === 'USDT' && item.status === 'TRADING')
    .filter((item) => mode !== 'futures' || item.contractType === 'PERPETUAL')
    .filter((item) => mode !== 'spot-fallback' || item.isSpotTradingAllowed !== false)
    .map((item) => {
      const priceFilter = item.filters?.find((filter) => filter.filterType === 'PRICE_FILTER')
      return {
        symbol: item.symbol,
        baseAsset: item.baseAsset,
        quoteAsset: item.quoteAsset,
        tickSize: Number(priceFilter?.tickSize ?? 0.01),
      }
    })
    .sort((a, b) => a.baseAsset.localeCompare(b.baseAsset))
}

export interface ProviderDiscovery {
  mode: MarketMode
  symbols: MarketSymbol[]
  reason: string | null
}

/** Use Binance USDⓈ-M public market data when available; otherwise use Binance's
 * official public spot-only mirror. The fallback is explicitly labelled because
 * spot candles must never be represented as futures candles. */
export async function discoverSpotProvider(signal?: AbortSignal): Promise<ProviderDiscovery> {
  const exchangeInfo = await getJson<ExchangeInfoResponse>(`${PUBLIC_SPOT_REST}/api/v3/exchangeInfo`, signal)
  const symbols = parseSymbols(exchangeInfo, 'spot-fallback')
  if (!symbols.length) throw new MarketApiError('Spot sembol listesi boş döndü.')
  return {
    mode: 'spot-fallback',
    symbols,
    reason: 'Futures verisi şu anda erişilemedi. Binance’in herkese açık spot veri aynası kullanılıyor; funding/OI/likidasyon futures metrikleri bu modda sunulmaz.',
  }
}

export async function discoverProvider(signal?: AbortSignal): Promise<ProviderDiscovery> {
  try {
    const exchangeInfo = await getJson<ExchangeInfoResponse>(`${FUTURES_REST}/fapi/v1/exchangeInfo`, signal)
    const symbols = parseSymbols(exchangeInfo, 'futures')
    if (!symbols.length) throw new MarketApiError('Futures sembol listesi boş döndü.')
    return { mode: 'futures', symbols, reason: null }
  } catch (futuresError) {
    const reason = futuresError instanceof Error ? futuresError.message : 'Futures verisi erişilemedi.'
    try {
      const fallback = await discoverSpotProvider(signal)
      return { ...fallback, reason: `${reason} ${fallback.reason}` }
    } catch (spotError) {
      const spotMessage = spotError instanceof Error ? spotError.message : 'Spot veri aynası da yanıt vermedi.'
      throw new MarketApiError(`Piyasa verisine ulaşılamadı. Futures: ${reason} Spot: ${spotMessage}`)
    }
  }
}

export async function fetchKlines(
  symbol: string,
  timeframe: Timeframe,
  limit = 500,
  mode: MarketMode = 'futures',
  signal?: AbortSignal,
): Promise<Candle[]> {
  const endpoint = mode === 'spot-fallback'
    ? `${PUBLIC_SPOT_REST}/api/v3/klines`
    : `${FUTURES_REST}/fapi/v1/klines`
  const url = new URL(endpoint)
  url.search = new URLSearchParams({ symbol, interval: timeframe, limit: String(Math.min(limit, 1000)) }).toString()
  const rows = await getJson<unknown[][]>(url.toString(), signal)
  return rows.map((row) => ({
    time: Math.floor(Number(row[0]) / 1000),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
    quoteVolume: Number(row[7]),
  })).filter((candle) => Number.isFinite(candle.time) && Number.isFinite(candle.close))
}

interface TickerWire {
  symbol: string
  lastPrice: string
  priceChangePercent: string
  highPrice: string
  lowPrice: string
  quoteVolume: string
}

export async function fetchTicker24h(symbol: string, mode: MarketMode, signal?: AbortSignal) {
  const endpoint = mode === 'spot-fallback'
    ? `${PUBLIC_SPOT_REST}/api/v3/ticker/24hr`
    : `${FUTURES_REST}/fapi/v1/ticker/24hr`
  const url = new URL(endpoint)
  url.searchParams.set('symbol', symbol)
  const ticker = await getJson<TickerWire>(url.toString(), signal)
  return {
    lastPrice: Number(ticker.lastPrice),
    change24h: Number(ticker.priceChangePercent),
    high24h: Number(ticker.highPrice),
    low24h: Number(ticker.lowPrice),
    quoteVolume24h: Number(ticker.quoteVolume),
    updatedAt: Date.now(),
  }
}

export async function fetchFunding(symbol: string, signal?: AbortSignal) {
  const url = new URL(`${FUTURES_REST}/fapi/v1/premiumIndex`)
  url.searchParams.set('symbol', symbol)
  const result = await getJson<{ markPrice: string; lastFundingRate: string }>(url.toString(), signal)
  return { markPrice: Number(result.markPrice), fundingRate: Number(result.lastFundingRate) }
}

export async function fetchOpenInterest(symbol: string, signal?: AbortSignal) {
  const url = new URL(`${FUTURES_REST}/fapi/v1/openInterest`)
  url.searchParams.set('symbol', symbol)
  const result = await getJson<{ openInterest: string }>(url.toString(), signal)
  return Number(result.openInterest)
}

export interface DepthSnapshot {
  lastUpdateId: number
  bids: DepthLevel[]
  asks: DepthLevel[]
  updatedAt: number
}

export async function fetchDepthSnapshot(symbol: string, mode: MarketMode, signal?: AbortSignal, limit = 1000): Promise<DepthSnapshot> {
  const base = mode === 'spot-fallback' ? PUBLIC_SPOT_REST : FUTURES_REST
  const path = mode === 'spot-fallback' ? '/api/v3/depth' : '/fapi/v1/depth'
  const url = new URL(path, base)
  url.search = new URLSearchParams({ symbol, limit: String(Math.min(Math.max(limit, 5), 1000)) }).toString()
  const book = await getJson<{ lastUpdateId?: number; bids: [string, string][]; asks: [string, string][] }>(url.toString(), signal)
  const toLevels = (rows: [string, string][]): DepthLevel[] => rows.map(([price, quantity]) => {
    const numericPrice = Number(price)
    const numericQuantity = Number(quantity)
    return { price: numericPrice, quantity: numericQuantity, notional: numericPrice * numericQuantity }
  }).filter((level) => level.price > 0 && level.quantity >= 0)
  return {
    lastUpdateId: Number(book.lastUpdateId ?? 0),
    bids: toLevels(book.bids ?? []).sort((a, b) => b.price - a.price),
    asks: toLevels(book.asks ?? []).sort((a, b) => a.price - b.price),
    updatedAt: Date.now(),
  }
}

export function summarizeDepth(snapshot: DepthSnapshot) {
  const bids = snapshot.bids.slice(0, 20)
  const asks = snapshot.asks.slice(0, 20)
  const bidNotional = bids.reduce((sum, level) => sum + level.notional, 0)
  const askNotional = asks.reduce((sum, level) => sum + level.notional, 0)
  const total = bidNotional + askNotional
  const bestBid = bids[0]?.price ?? 0
  const bestAsk = asks[0]?.price ?? 0
  return {
    bids,
    asks,
    bidNotional,
    askNotional,
    obi: total > 0 ? (bidNotional - askNotional) / total : null,
    spread: bestBid > 0 && bestAsk > 0 ? ((bestAsk - bestBid) / ((bestAsk + bestBid) / 2)) * 100 : null,
    updatedAt: snapshot.updatedAt,
  }
}

export async function fetchDepthImbalance(symbol: string, mode: MarketMode, signal?: AbortSignal) {
  const snapshot = await fetchDepthSnapshot(symbol, mode, signal, 20)
  return summarizeDepth(snapshot)
}

export async function fetchAllTickers(mode: MarketMode, signal?: AbortSignal): Promise<Ticker24h[]> {
  const endpoint = mode === 'spot-fallback'
    ? `${PUBLIC_SPOT_REST}/api/v3/ticker/24hr`
    : `${FUTURES_REST}/fapi/v1/ticker/24hr`
  const rows = await getJson<TickerWire[]>(endpoint, signal)
  return rows
    .filter((row) => row.symbol.endsWith('USDT'))
    .map((row) => ({
      symbol: row.symbol,
      lastPrice: Number(row.lastPrice),
      priceChangePercent: Number(row.priceChangePercent),
      highPrice: Number(row.highPrice),
      lowPrice: Number(row.lowPrice),
      quoteVolume: Number(row.quoteVolume),
    }))
    .filter((row) => Number.isFinite(row.quoteVolume) && Number.isFinite(row.lastPrice))
}
