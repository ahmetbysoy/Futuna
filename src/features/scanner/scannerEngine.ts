import { calculateSignal } from '@/features/signals/signalEngine'
import type { AppSettings } from '@/app/AppContext'
import type { Candle, FlowSnapshot, Ticker24h } from '@/features/market/types'
import type { SignalDirection } from '@/features/signals/signalEngine'

const EMPTY_FLOW: FlowSnapshot = {
  cvd60: 0, buyNotional60: 0, sellNotional60: 0, liquidationNotional60: null,
  obi: null, spread: null, bidNotional: null, askNotional: null, bids: [], asks: [], events: [], lastTradeAt: null, depthUpdatedAt: null, depthStatus: 'offline',
}

export interface ScanCandidate {
  symbol: string
  price: number
  change24h: number
  quoteVolume: number
}

export interface ScanResult extends ScanCandidate {
  direction: SignalDirection
  score: number
  alignment: number
  rsi: number | null
  trend: 'Yukarı' | 'Aşağı' | 'Yatay'
  reason: string
}

export async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      output[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return output
}

export async function scanMarkets(
  candidates: ScanCandidate[],
  loadCandles: (symbol: string) => Promise<Candle[]>,
  settings: AppSettings,
  onProgress: (complete: number, total: number, current: string) => void,
): Promise<ScanResult[]> {
  let complete = 0
  const results = await mapWithConcurrency(candidates, 4, async (candidate) => {
    let history: Candle[] = []
    let candleError: string | null = null
    try {
      history = await loadCandles(candidate.symbol)
    } catch (reason) {
      candleError = reason instanceof Error ? reason.message : 'Mum verisi alınamadı.'
    } finally {
      complete += 1
      onProgress(complete, candidates.length, candidate.symbol)
    }
    const decision = calculateSignal(history, EMPTY_FLOW, settings)
    const trend: ScanResult['trend'] = decision.fastValue == null || decision.slowValue == null
      ? 'Yatay'
      : decision.fastValue > decision.slowValue ? 'Yukarı' : decision.fastValue < decision.slowValue ? 'Aşağı' : 'Yatay'
    return {
      ...candidate,
      direction: decision.direction,
      score: decision.score,
      alignment: decision.alignment,
      rsi: decision.rsiValue,
      trend,
      reason: candleError ?? decision.reasons[0] ?? 'Yeterli mum yok',
    }
  })
  return results.sort((a, b) => b.alignment - a.alignment || b.quoteVolume - a.quoteVolume)
}

export function pickCandidates(
  tickers: Ticker24h[],
  supportedSymbols: Set<string>,
  list: 'favorites' | 'top20' | 'top50',
  favorites: string[],
): ScanCandidate[] {
  const marketRows = tickers.filter((ticker) => supportedSymbols.has(ticker.symbol))
  if (list === 'favorites') {
    const favoriteSet = new Set(favorites)
    return marketRows.filter((ticker) => favoriteSet.has(ticker.symbol)).sort((a, b) => b.quoteVolume - a.quoteVolume).map((ticker) => ({
      symbol: ticker.symbol,
      price: ticker.lastPrice,
      change24h: ticker.priceChangePercent,
      quoteVolume: ticker.quoteVolume,
    }))
  }
  const limit = list === 'top50' ? 50 : 20
  return marketRows.sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, limit).map((ticker) => ({
    symbol: ticker.symbol,
    price: ticker.lastPrice,
    change24h: ticker.priceChangePercent,
    quoteVolume: ticker.quoteVolume,
  }))
}
