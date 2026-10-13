import type { Candle } from '@/features/market/types'
import { ema, rsi } from '@/lib/math'

export interface StrategyParams {
  fast: number
  slow: number
  rsiPeriod: number
}

export interface BacktestTrade {
  direction: 'AL' | 'SAT'
  entryTime: number
  exitTime: number
  entryPrice: number
  exitPrice: number
  netPnlPct: number
  barsHeld: number
}

export interface PerformanceMetrics {
  trades: number
  wins: number
  winRate: number
  netPnl: number
  profitFactor: number | null
  maxDrawdown: number
  avgR: number | null
  equity: number[]
}

export interface WalkForwardFold {
  index: number
  trainStart: number
  trainEnd: number
  testStart: number
  testEnd: number
  params: StrategyParams
  inSample: PerformanceMetrics
  outSample: PerformanceMetrics
  trades: BacktestTrade[]
}

export interface WalkForwardResult {
  candlesUsed: number
  timeframeLabel: string
  feeBps: number
  folds: WalkForwardFold[]
  oosTrades: BacktestTrade[]
  oosMetrics: PerformanceMetrics
}

function signalSeries(candles: Candle[], params: StrategyParams): number[] {
  const closes = candles.map((candle) => candle.close)
  const fast = ema(closes, params.fast)
  const slow = ema(closes, params.slow)
  const rsiValues = rsi(closes, params.rsiPeriod)
  return candles.map((_, index) => {
    if (index < params.slow + 1 || !Number.isFinite(rsiValues[index])) return 0
    if (fast[index] > slow[index] && rsiValues[index] >= 50) return 1
    if (fast[index] < slow[index] && rsiValues[index] <= 50) return -1
    return 0
  })
}

export function simulatePeriod(candles: Candle[], params: StrategyParams, start: number, end: number, feeBps: number): BacktestTrade[] {
  if (candles.length < params.slow + 5) return []
  const signals = signalSeries(candles, params)
  const stop = Math.min(end, candles.length - 1)
  let position = 0
  let entryIndex = -1
  let entryPrice = 0
  const trades: BacktestTrade[] = []
  const feePercent = (feeBps * 2) / 100

  const closeTrade = (exitIndex: number, exitPrice: number) => {
    if (!position || entryIndex < 0 || !(entryPrice > 0)) return
    const direction = position > 0 ? 'AL' : 'SAT'
    const raw = ((exitPrice / entryPrice) - 1) * position * 100
    trades.push({
      direction,
      entryTime: candles[entryIndex].time * 1000,
      exitTime: candles[exitIndex].time * 1000,
      entryPrice,
      exitPrice,
      netPnlPct: raw - feePercent,
      barsHeld: Math.max(1, exitIndex - entryIndex),
    })
    position = 0
    entryIndex = -1
  }

  for (let index = Math.max(start, params.slow + 2); index <= stop; index += 1) {
    // The previous candle's completed indicator state is acted on at this
    // candle's open to avoid using the close before it exists.
    const target = signals[index - 1] ?? 0
    const open = candles[index].open
    if (position && target !== position) closeTrade(index, open)
    if (!position && target !== 0 && index < stop) {
      position = target
      entryIndex = index
      entryPrice = open
    }
  }
  if (position && stop > entryIndex) closeTrade(stop, candles[stop].close)
  return trades
}

export function performanceMetrics(trades: BacktestTrade[]): PerformanceMetrics {
  const wins = trades.filter((trade) => trade.netPnlPct > 0)
  const losses = trades.filter((trade) => trade.netPnlPct < 0)
  const totalWin = wins.reduce((sum, trade) => sum + trade.netPnlPct, 0)
  const totalLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.netPnlPct, 0))
  let equityValue = 100
  let peak = 100
  let maxDrawdown = 0
  const equity = [100]
  for (const trade of trades) {
    equityValue *= 1 + trade.netPnlPct / 100
    peak = Math.max(peak, equityValue)
    maxDrawdown = Math.max(maxDrawdown, peak > 0 ? (peak - equityValue) / peak * 100 : 0)
    equity.push(equityValue)
  }
  const avgWin = wins.length ? totalWin / wins.length : 0
  const avgLoss = losses.length ? totalLoss / losses.length : 0
  return {
    trades: trades.length,
    wins: wins.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    netPnl: equityValue - 100,
    profitFactor: totalLoss > 0 ? totalWin / totalLoss : totalWin > 0 ? null : 0,
    maxDrawdown,
    avgR: avgLoss > 0 ? avgWin / avgLoss : null,
    equity,
  }
}

function selectBestParams(candles: Candle[], trainStart: number, trainEnd: number, feeBps: number, baseRsiPeriod: number): { params: StrategyParams; metrics: PerformanceMetrics } {
  const candidates: StrategyParams[] = []
  for (const fast of [7, 9, 12]) {
    for (const slow of [21, 26, 34]) {
      if (fast < slow) candidates.push({ fast, slow, rsiPeriod: baseRsiPeriod })
    }
  }
  let best: { params: StrategyParams; metrics: PerformanceMetrics; fitness: number } | null = null
  for (const params of candidates) {
    const trades = simulatePeriod(candles, params, trainStart, trainEnd, feeBps)
    const metrics = performanceMetrics(trades)
    if (metrics.trades < 2) continue
    const fitness = metrics.netPnl - metrics.maxDrawdown * 0.35
    if (!best || fitness > best.fitness) best = { params, metrics, fitness }
  }
  return best
    ? { params: best.params, metrics: best.metrics }
    : { params: { fast: 9, slow: 21, rsiPeriod: baseRsiPeriod }, metrics: performanceMetrics([]) }
}

export function runWalkForward(candles: Candle[], timeframeLabel: string, feeBps: number, rsiPeriod = 14): WalkForwardResult {
  const firstTestStart = Math.max(80, Math.floor(candles.length * 0.4))
  const foldSpan = Math.floor((candles.length - firstTestStart) / 3)
  const folds: WalkForwardFold[] = []
  const allOos: BacktestTrade[] = []

  for (let index = 0; index < 3; index += 1) {
    const testStart = firstTestStart + index * foldSpan
    const testEnd = index === 2 ? candles.length - 1 : Math.min(candles.length - 1, testStart + foldSpan - 1)
    if (testStart > testEnd) continue
    const trainEnd = testStart - 1
    const { params, metrics: inSample } = selectBestParams(candles, 0, trainEnd, feeBps, rsiPeriod)
    const trades = simulatePeriod(candles, params, testStart, testEnd, feeBps)
    const outSample = performanceMetrics(trades)
    folds.push({ index: index + 1, trainStart: 0, trainEnd, testStart, testEnd, params, inSample, outSample, trades })
    allOos.push(...trades)
  }

  return {
    candlesUsed: candles.length,
    timeframeLabel,
    feeBps,
    folds,
    oosTrades: allOos,
    oosMetrics: performanceMetrics(allOos),
  }
}
