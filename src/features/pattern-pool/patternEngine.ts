import type { Candle } from '@/features/market/types'
import { ema, median, rsi, wilsonLowerBound } from '@/lib/math'

export interface PatternSample {
  timestamp: number
  direction: 'AL' | 'SAT'
  entry: number
  exit: number
  netReturnPct: number
  mfePct: number
  maePct: number
}

export interface PatternRow {
  id: string
  name: string
  description: string
  samples: number
  wins: number
  winRate: number
  wilson: number
  avgReturn: number
  medianReturn: number
  avgMfe: number
  avgMae: number
  grade: 'Yeterli örnek' | 'İzle' | 'Sınırlı veri'
  events: PatternSample[]
}

type SignalIndex = { index: number; direction: 'AL' | 'SAT' }

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function collectSamples(candles: Candle[], signals: SignalIndex[], horizon: number, feeBps: number): PatternSample[] {
  const samples: PatternSample[] = []
  const feePercent = (feeBps * 2) / 100
  for (const signal of signals) {
    const entryIndex = signal.index + 1
    const exitIndex = signal.index + horizon
    if (entryIndex >= candles.length || exitIndex >= candles.length) continue
    const entry = candles[entryIndex].open
    const exit = candles[exitIndex].close
    if (!(entry > 0) || !(exit > 0)) continue
    const direction = signal.direction === 'AL' ? 1 : -1
    const rawReturn = ((exit / entry) - 1) * direction * 100
    const window = candles.slice(entryIndex, exitIndex + 1)
    const maxHigh = Math.max(...window.map((candle) => candle.high))
    const minLow = Math.min(...window.map((candle) => candle.low))
    const mfePct = direction > 0 ? ((maxHigh / entry) - 1) * 100 : ((entry / minLow) - 1) * 100
    const maePct = direction > 0 ? ((minLow / entry) - 1) * 100 : ((entry / maxHigh) - 1) * 100
    samples.push({
      timestamp: candles[signal.index].time * 1000,
      direction: signal.direction,
      entry,
      exit,
      netReturnPct: rawReturn - feePercent,
      mfePct,
      maePct,
    })
  }
  return samples
}

function buildRow(id: string, name: string, description: string, events: PatternSample[]): PatternRow {
  const wins = events.filter((event) => event.netReturnPct > 0).length
  const winRate = events.length ? wins / events.length : 0
  const wilson = wilsonLowerBound(wins, events.length)
  const avgReturn = average(events.map((event) => event.netReturnPct))
  const avgMfe = average(events.map((event) => event.mfePct))
  const avgMae = average(events.map((event) => event.maePct))
  const grade = events.length >= 30 ? 'Yeterli örnek' : events.length >= 10 ? 'İzle' : 'Sınırlı veri'
  return {
    id, name, description,
    samples: events.length,
    wins,
    winRate,
    wilson,
    avgReturn,
    medianReturn: median(events.map((event) => event.netReturnPct)),
    avgMfe,
    avgMae,
    grade,
    events: events.slice(-80).reverse(),
  }
}

export function calculatePatternRows(candles: Candle[], feeBps: number, horizon = 10): PatternRow[] {
  if (candles.length < 35) return []
  const closes = candles.map((candle) => candle.close)
  const fast = ema(closes, 9)
  const slow = ema(closes, 21)
  const rsiValues = rsi(closes, 14)
  const emaCross: SignalIndex[] = []
  const rsiReclaim: SignalIndex[] = []
  const rangeBreak: SignalIndex[] = []

  for (let index = 21; index < candles.length - horizon; index += 1) {
    if (fast[index - 1] <= slow[index - 1] && fast[index] > slow[index]) emaCross.push({ index, direction: 'AL' })
    else if (fast[index - 1] >= slow[index - 1] && fast[index] < slow[index]) emaCross.push({ index, direction: 'SAT' })

    if (rsiValues[index - 1] < 50 && rsiValues[index] >= 50) rsiReclaim.push({ index, direction: 'AL' })
    else if (rsiValues[index - 1] > 50 && rsiValues[index] <= 50) rsiReclaim.push({ index, direction: 'SAT' })

    const lookback = candles.slice(index - 20, index)
    const priorHigh = Math.max(...lookback.map((candle) => candle.high))
    const priorLow = Math.min(...lookback.map((candle) => candle.low))
    if (candles[index].close > priorHigh) rangeBreak.push({ index, direction: 'AL' })
    else if (candles[index].close < priorLow) rangeBreak.push({ index, direction: 'SAT' })
  }

  return [
    buildRow('ema-cross', 'EMA 9 / 21 kesişimi', 'Hızlı ve yavaş EMA yön değiştirdiğinde, 10 mumluk ileri pencere.', collectSamples(candles, emaCross, horizon, feeBps)),
    buildRow('rsi-reclaim', 'RSI 50 geri kazanımı', 'RSI orta çizgisini geçtiğinde, 10 mumluk ileri pencere.', collectSamples(candles, rsiReclaim, horizon, feeBps)),
    buildRow('range-break', '20 mum aralık kırılımı', 'Önceki 20 mumun tepe/dip aralığı dışına kapanış.', collectSamples(candles, rangeBreak, horizon, feeBps)),
  ]
}
