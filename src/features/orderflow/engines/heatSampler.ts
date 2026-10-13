import type { HeatFrame, HeatmapBin } from '../types'

const SAMPLE_INTERVAL_MS = 1_000
const FRAME_WINDOW_MS = 15 * 60_000
const FRAME_WINDOW_SECONDS = 15 * 60
const MAX_BINS = 220
const MIN_RELATIVE_NOTIONAL = 0.035

export interface HeatSampleInput {
  bids: ReadonlyMap<number, number>
  asks: ReadonlyMap<number, number>
  bestBid: number | null
  bestAsk: number | null
  depthTickSize: number
  rangePct?: number
}

export class HeatSampler {
  private lastSampleAt = Number.NEGATIVE_INFINITY

  sample(input: HeatSampleInput, now = Date.now(), force = false): HeatFrame | null {
    if (!Number.isFinite(now) || !Number.isFinite(input.depthTickSize) || input.depthTickSize <= 0) return null
    if (!force && now - this.lastSampleAt < SAMPLE_INTERVAL_MS) return null
    const mid = midpoint(input.bestBid, input.bestAsk)
    if (mid == null) return null

    const rangePct = clamp(input.rangePct ?? 0.01, 0.001, 0.05)
    const range = mid * rangePct
    const step = input.depthTickSize
    const groups = new Map<string, { side: 'bid' | 'ask'; bin: number; sumPriceQuantity: number; sumQuantity: number }>()
    addSide(input.bids, 'bid', mid, range, step, groups)
    addSide(input.asks, 'ask', mid, range, step, groups)

    let bins: HeatmapBin[] = []
    for (const group of groups.values()) {
      if (group.sumQuantity <= 0) continue
      bins.push({
        side: group.side,
        price: group.sumPriceQuantity / group.sumQuantity,
        notional: group.sumPriceQuantity,
      })
    }
    if (bins.length === 0) return null

    bins.sort((left, right) => right.notional - left.notional)
    const max = bins[0].notional
    bins = bins.filter((bin) => bin.notional >= max * MIN_RELATIVE_NOTIONAL).slice(0, MAX_BINS)
    bins.sort((left, right) => left.price - right.price || (left.side === 'bid' ? -1 : 1))
    this.lastSampleAt = now

    return {
      t: Math.floor(now / 1_000),
      bins,
      max,
    }
  }

  reset() {
    this.lastSampleAt = Number.NEGATIVE_INFINITY
  }

  get retentionSeconds() {
    return FRAME_WINDOW_SECONDS
  }

  shouldRetain(frame: HeatFrame, now = Date.now()) {
    return now - frame.t * 1_000 <= FRAME_WINDOW_MS
  }
}

function addSide(
  book: ReadonlyMap<number, number>,
  side: 'bid' | 'ask',
  mid: number,
  range: number,
  step: number,
  groups: Map<string, { side: 'bid' | 'ask'; bin: number; sumPriceQuantity: number; sumQuantity: number }>,
) {
  for (const [price, quantity] of book) {
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(quantity) || quantity <= 0) continue
    if (Math.abs(price - mid) > range) continue
    const bin = Math.round(price / step)
    const key = `${side}|${bin}`
    const group = groups.get(key) ?? { side, bin, sumPriceQuantity: 0, sumQuantity: 0 }
    group.sumPriceQuantity += price * quantity
    group.sumQuantity += quantity
    groups.set(key, group)
  }
}

function midpoint(bestBid: number | null, bestAsk: number | null) {
  if (bestBid == null || bestAsk == null || bestBid <= 0 || bestAsk <= 0 || bestAsk < bestBid) return null
  return (bestBid + bestAsk) / 2
}

function clamp(value: number, min: number, max: number) {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min
}
