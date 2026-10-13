import type { Candle } from '@/features/market/types'

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function ema(values: number[], period: number): number[] {
  if (!values.length) return []
  const p = Math.max(1, Math.floor(period))
  const alpha = 2 / (p + 1)
  const result = new Array<number>(values.length)
  let current = values[0]
  result[0] = current
  for (let index = 1; index < values.length; index += 1) {
    current = values[index] * alpha + current * (1 - alpha)
    result[index] = current
  }
  return result
}

export function sma(values: number[], period: number): number[] {
  const p = Math.max(1, Math.floor(period))
  let sum = 0
  return values.map((value, index) => {
    sum += value
    if (index >= p) sum -= values[index - p]
    return index + 1 >= p ? sum / p : Number.NaN
  })
}

export function rsi(values: number[], period = 14): number[] {
  const p = Math.max(2, Math.floor(period))
  const result = new Array<number>(values.length).fill(Number.NaN)
  if (values.length <= p) return result
  let gain = 0
  let loss = 0
  for (let index = 1; index <= p; index += 1) {
    const delta = values[index] - values[index - 1]
    gain += Math.max(0, delta)
    loss += Math.max(0, -delta)
  }
  let averageGain = gain / p
  let averageLoss = loss / p
  result[p] = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss)
  for (let index = p + 1; index < values.length; index += 1) {
    const delta = values[index] - values[index - 1]
    averageGain = (averageGain * (p - 1) + Math.max(0, delta)) / p
    averageLoss = (averageLoss * (p - 1) + Math.max(0, -delta)) / p
    result[index] = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss)
  }
  return result
}

export interface BollingerValues { middle: number[]; upper: number[]; lower: number[] }
export function bollinger(values: number[], period = 20, deviations = 2): BollingerValues {
  const p = Math.max(2, Math.floor(period))
  const middle = sma(values, p)
  const upper = new Array<number>(values.length).fill(Number.NaN)
  const lower = new Array<number>(values.length).fill(Number.NaN)
  for (let index = p - 1; index < values.length; index += 1) {
    const window = values.slice(index - p + 1, index + 1)
    const mean = middle[index]
    const variance = window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / p
    const width = Math.sqrt(variance) * deviations
    upper[index] = mean + width
    lower[index] = mean - width
  }
  return { middle, upper, lower }
}

/** UTC-day anchored VWAP for 24/7 spot and futures markets. */
export function vwap(candles: Candle[]): number[] {
  const values = new Array<number>(candles.length).fill(Number.NaN)
  let currentDay = -1
  let cumulativePriceVolume = 0
  let cumulativeVolume = 0
  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index]
    const utcDay = Math.floor(candle.time / 86_400)
    if (utcDay !== currentDay) {
      currentDay = utcDay
      cumulativePriceVolume = 0
      cumulativeVolume = 0
    }
    const volume = Math.max(0, candle.volume)
    const typicalPrice = (candle.high + candle.low + candle.close) / 3
    cumulativePriceVolume += typicalPrice * volume
    cumulativeVolume += volume
    values[index] = cumulativeVolume > 0 ? cumulativePriceVolume / cumulativeVolume : candle.close
  }
  return values
}

export interface MacdValues { line: number[]; signal: number[]; histogram: number[] }
export function macd(values: number[], fastPeriod = 12, slowPeriod = 26, signalPeriod = 9): MacdValues {
  const fast = ema(values, fastPeriod)
  const slow = ema(values, slowPeriod)
  const line = values.map((_, index) => fast[index] - slow[index])
  const signal = ema(line, signalPeriod)
  return { line, signal, histogram: line.map((value, index) => value - signal[index]) }
}

export function parabolicSar(candles: Candle[], step = 0.02, maximum = 0.2): number[] {
  const result = new Array<number>(candles.length).fill(Number.NaN)
  if (candles.length < 3) return result
  let rising = candles[1].close >= candles[0].close
  let extreme = rising ? Math.max(candles[0].high, candles[1].high) : Math.min(candles[0].low, candles[1].low)
  let acceleration = step
  let sar = rising ? Math.min(candles[0].low, candles[1].low) : Math.max(candles[0].high, candles[1].high)
  result[1] = sar
  for (let index = 2; index < candles.length; index += 1) {
    let nextSar = sar + acceleration * (extreme - sar)
    if (rising) {
      nextSar = Math.min(nextSar, candles[index - 1].low, candles[index - 2].low)
      if (candles[index].low < nextSar) {
        rising = false
        nextSar = extreme
        extreme = candles[index].low
        acceleration = step
      } else if (candles[index].high > extreme) {
        extreme = candles[index].high
        acceleration = Math.min(maximum, acceleration + step)
      }
    } else {
      nextSar = Math.max(nextSar, candles[index - 1].high, candles[index - 2].high)
      if (candles[index].high > nextSar) {
        rising = true
        nextSar = extreme
        extreme = candles[index].high
        acceleration = step
      } else if (candles[index].low < extreme) {
        extreme = candles[index].low
        acceleration = Math.min(maximum, acceleration + step)
      }
    }
    sar = nextSar
    result[index] = sar
  }
  return result
}

export function candleCloses(candles: Candle[]): number[] {
  return candles.map((candle) => candle.close)
}

export function percentageReturn(start: number, end: number): number {
  return start > 0 ? ((end / start) - 1) * 100 : 0
}

export function wilsonLowerBound(wins: number, count: number, z = 1.96): number {
  if (count <= 0) return 0
  const p = wins / count
  const z2 = z * z
  const denominator = 1 + z2 / count
  const center = p + z2 / (2 * count)
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * count)) / count)
  return Math.max(0, (center - margin) / denominator)
}

export function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
