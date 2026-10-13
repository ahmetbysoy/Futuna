import { systemClock, type Clock } from '../clock'
import type { CvdMomentum, OrderflowTrade } from '../types'
import { BoundedQueue } from './queue'

interface DeltaSample {
  ts: number
  delta: number
}

interface WindowAccumulator {
  ms: number
  samples: BoundedQueue<DeltaSample>
  sum: number
}

const WINDOW_SPECS = [
  ['s10', 10_000],
  ['s30', 30_000],
  ['s60', 60_000],
  ['s180', 180_000],
] as const

function emptyMomentum(): CvdMomentum {
  return {
    s10: 0,
    s30: 0,
    s60: 0,
    s180: 0,
    direction: 'FLAT',
    accelerating: false,
    allAligned: false,
    score: 0,
  }
}

export class MultiCvdEngine {
  private windows: Record<(typeof WINDOW_SPECS)[number][0], WindowAccumulator>

  constructor(private readonly clock: Clock = systemClock) {
    this.windows = this.createWindows()
  }

  add(trade: OrderflowTrade, now = this.clock.now()) {
    if (!Number.isFinite(trade.ts) || !Number.isFinite(trade.notional) || trade.notional <= 0) return
    const delta = trade.side === 'buy' ? trade.notional : -trade.notional
    for (const [key, windowMs] of WINDOW_SPECS) {
      const window = this.windows[key]
      this.prune(window, now - windowMs)
      if (trade.ts < now - windowMs) continue
      const evicted = window.samples.push({ ts: trade.ts, delta })
      if (evicted) window.sum -= evicted.delta
      window.sum += delta
    }
  }

  momentum(now = this.clock.now()): CvdMomentum {
    for (const [key, windowMs] of WINDOW_SPECS) this.prune(this.windows[key], now - windowMs)

    const s10 = this.windows.s10.sum
    const s30 = this.windows.s30.sum
    const s60 = this.windows.s60.sum
    const s180 = this.windows.s180.sum
    const direction = s30 > 0 ? 'BULL' : s30 < 0 ? 'BEAR' : 'FLAT'
    const sameShortDirection = Math.sign(s10) !== 0 && Math.sign(s10) === Math.sign(s30)
    const sameWindowDirection = Math.sign(s10) !== 0
      && Math.sign(s10) === Math.sign(s30)
      && Math.sign(s30) === Math.sign(s60)

    return {
      s10,
      s30,
      s60,
      s180,
      direction,
      accelerating: sameShortDirection && Math.abs(s10) > Math.abs(s30) / 4,
      allAligned: sameWindowDirection,
      score: s60 / (Math.abs(s180) + 1),
    }
  }

  reset() {
    this.windows = this.createWindows()
  }

  private createWindows(): Record<(typeof WINDOW_SPECS)[number][0], WindowAccumulator> {
    return {
      s10: { ms: 10_000, samples: new BoundedQueue(8_000), sum: 0 },
      s30: { ms: 30_000, samples: new BoundedQueue(8_000), sum: 0 },
      s60: { ms: 60_000, samples: new BoundedQueue(8_000), sum: 0 },
      s180: { ms: 180_000, samples: new BoundedQueue(8_000), sum: 0 },
    }
  }

  private prune(window: WindowAccumulator, cutoff: number) {
    window.samples.pruneWhile((sample) => {
      if (sample.ts >= cutoff) return false
      window.sum -= sample.delta
      return true
    })
  }
}

export { emptyMomentum }
