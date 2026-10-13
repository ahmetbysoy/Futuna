import { systemClock, type Clock } from '../clock'
import type { ObiSnapshot, ObiTrend } from '../types'
import { BoundedQueue } from './queue'

interface ObiSample {
  ts: number
  value: number
}

const MAX_HISTORY_MS = 180_000
const MAX_SAMPLES = 3_600

export class MultiObiEngine {
  private samples = new BoundedQueue<ObiSample>(MAX_SAMPLES)

  constructor(private readonly clock: Clock = systemClock) {}

  snapshot(value: number | null, ts = this.clock.now()) {
    if (value == null || !Number.isFinite(value) || !Number.isFinite(ts)) return
    this.prune(ts - MAX_HISTORY_MS)
    this.samples.push({ ts, value: Math.max(-1, Math.min(1, value)) })
  }

  avg(windowMs: number, now = this.clock.now()) {
    if (!Number.isFinite(windowMs) || windowMs <= 0) return 0
    this.prune(now - MAX_HISTORY_MS)
    let sum = 0
    let count = 0
    for (const sample of this.samples) {
      if (sample.ts >= now - windowMs) {
        sum += sample.value
        count += 1
      }
    }
    return count > 0 ? sum / count : 0
  }

  trend(windowMs = 30_000, now = this.clock.now()): ObiTrend {
    const recent = Array.from(this.samples).filter((sample) => sample.ts >= now - windowMs)
    if (recent.length < 6) return 'FLAT'
    const half = Math.floor(recent.length / 2)
    const first = average(recent.slice(0, half).map((sample) => sample.value))
    const second = average(recent.slice(half).map((sample) => sample.value))
    const change = second - first
    if (change > 0.04) return 'RISING'
    if (change < -0.04) return 'FALLING'
    return 'FLAT'
  }

  alignment(now = this.clock.now()): ObiSnapshot {
    const s5 = this.avg(5_000, now)
    const s15 = this.avg(15_000, now)
    const s30 = this.avg(30_000, now)
    const s60 = this.avg(60_000, now)
    const bull = s5 > 0.06 && s15 > 0.03 && s30 > 0.01
    const bear = s5 < -0.06 && s15 < -0.03 && s30 < -0.01
    return {
      s5,
      s15,
      s30,
      s60,
      aligned: bull ? 'BULL' : bear ? 'BEAR' : 'MIXED',
      strength: Math.abs(s5 + s15 + s30) / 3,
      trend: this.trend(30_000, now),
    }
  }

  reset() {
    this.samples.clear()
  }

  private prune(cutoff: number) {
    this.samples.pruneWhile((sample) => sample.ts < cutoff)
  }
}

export function computeBookObi(
  bids: ReadonlyMap<number, number>,
  asks: ReadonlyMap<number, number>,
  levels = 20,
): number | null {
  if (!Number.isInteger(levels) || levels < 1) return null
  const bidNotional = topNotional(bids, true, levels)
  const askNotional = topNotional(asks, false, levels)
  const total = bidNotional + askNotional
  return total > 0 ? (bidNotional - askNotional) / total : null
}

function topNotional(book: ReadonlyMap<number, number>, descending: boolean, count: number) {
  return [...book]
    .filter(([price, quantity]) => Number.isFinite(price) && price > 0 && Number.isFinite(quantity) && quantity > 0)
    .sort(([left], [right]) => descending ? right - left : left - right)
    .slice(0, count)
    .reduce((sum, [price, quantity]) => sum + price * quantity, 0)
}

function average(values: readonly number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}
