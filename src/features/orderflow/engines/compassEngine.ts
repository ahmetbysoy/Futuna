import type { CvdMomentum, FlowEventRecord, CompassComponents, CompassState, WallRecord } from '../types'
import type { ConfirmedIceberg } from './icebergDetector'

const CALC_INTERVAL_MS = 250
const RECENT_EVENT_MS = 30_000
const DEFAULT_HALF_LIFE_MS = 10_000

export interface CompassInput {
  now: number
  depthReady: boolean
  bestBid: number | null
  bestAsk: number | null
  tickSize: number
  normalizationNotional: number
  cvd: CvdMomentum
  events: readonly FlowEventRecord[]
  walls: readonly WallRecord[]
  icebergs: readonly ConfirmedIceberg[]
  lastSweepTs: number | null
  config: {
    compassHalf: 5_000 | 10_000 | 20_000 | 30_000
    compassIceTick: number
    compassWallTick: number
  }
}

const ZERO_COMPONENTS: CompassComponents = { ice: 0, drift: 0, flow: 0, pull: 0, wall: 0 }

export class CompassEngine {
  private lastCalcAt = Number.NEGATIVE_INFINITY
  private state: CompassState = {
    score: 0,
    components: { ...ZERO_COMPONENTS },
    direction: 'FLAT',
    label: 'Nötr / sıkışma',
    color: '#93a59a',
    updatedAt: null,
  }

  compute(input: CompassInput, force = false): CompassState {
    const { now } = input
    if (!Number.isFinite(now)) return this.state
    if (!force && now - this.lastCalcAt < CALC_INTERVAL_MS) return this.state
    this.lastCalcAt = now

    const mid = midpoint(input.bestBid, input.bestAsk)
    if (!input.depthReady || mid == null || !Number.isFinite(input.tickSize) || input.tickSize <= 0) {
      this.state = neutralState(now)
      return this.state
    }

    const norm = Math.max(1, Number.isFinite(input.normalizationNotional) ? input.normalizationNotional : 1)
    const halfLife = Number.isFinite(input.config.compassHalf) && input.config.compassHalf > 0
      ? input.config.compassHalf
      : DEFAULT_HALF_LIFE_MS
    const decay = (ageMs: number) => Math.pow(0.5, Math.max(0, ageMs) / halfLife)
    const tanh = (value: number) => Math.tanh(value / norm)
    const iceTick = positiveOr(input.config.compassIceTick, 15)
    const wallTick = positiveOr(input.config.compassWallTick, 10)

    let ice = 0
    let pull = 0
    for (const event of input.events) {
      const age = now - event.ts
      if (age < 0 || age > RECENT_EVENT_MS) continue
      const weight = decay(age)
      const direction = sideSign(event.side)
      const eventPrice = event.price ?? mid
      if (event.type === 'ICEBERG') {
        if (Math.abs(eventPrice - mid) / input.tickSize <= iceTick) {
          const notional = event.notional ?? input.normalizationNotional * 0.5
          ice += direction * notional * weight
        }
      } else if (event.type === 'FILLED') {
        pull += direction * weight * norm * 0.5
      } else if (event.type === 'SPOOF?' || event.type === 'WALL_GONE') {
        pull -= direction * weight * norm * 0.3
      }
    }

    const sweepAge = input.lastSweepTs == null ? Number.POSITIVE_INFINITY : now - input.lastSweepTs
    const sweepWeight = sweepAge >= 0 && sweepAge <= RECENT_EVENT_MS ? decay(sweepAge) : 0
    const cvdDirection = Math.sign(input.cvd.s10)
    const flow = cvdDirection * Math.abs(input.cvd.s10) * sweepWeight

    let bidWall = 0
    let askWall = 0
    for (const wall of input.walls) {
      const distance = Math.abs(wall.price - mid) / input.tickSize
      if (distance > wallTick) continue
      if (wall.side === 'bid') bidWall += wall.notional
      else askWall += wall.notional
    }
    const wall = bidWall - askWall

    const drift = icebergDrift(input.icebergs, input.tickSize, now)
    const components: CompassComponents = {
      ice: 0.30 * tanh(ice),
      drift: 0.20 * Math.tanh(drift / 10),
      flow: 0.20 * tanh(flow),
      pull: 0.15 * tanh(pull),
      wall: 0.15 * tanh(wall),
    }
    const score = Math.max(-100, Math.min(100, Math.round(100 * Object.values(components).reduce((sum, value) => sum + value, 0))))
    const direction = score >= 15 ? 'BULL' : score <= -15 ? 'BEAR' : 'FLAT'
    this.state = {
      score,
      components,
      direction,
      label: compassLabel(score),
      color: compassColor(score),
      updatedAt: now,
    }
    return this.state
  }

  snapshot() {
    return { ...this.state, components: { ...this.state.components } }
  }

  reset() {
    this.lastCalcAt = Number.NEGATIVE_INFINITY
    this.state = neutralState(null)
  }
}

function icebergDrift(icebergs: readonly ConfirmedIceberg[], tickSize: number, now: number) {
  const recent = icebergs.filter((event) => now - event.ts >= 0 && now - event.ts <= RECENT_EVENT_MS)
  let drift = 0
  for (const side of ['bid', 'ask'] as const) {
    const prices = recent.filter((event) => event.side === side).map((event) => event.price)
    if (prices.length < 2) continue
    const split = Math.floor(prices.length / 2)
    const older = median(prices.slice(0, split))
    const newer = median(prices.slice(split))
    if (older == null || newer == null) continue
    // Rising bid support and rising offer levels (seller retreat) both contribute upward drift.
    drift += (newer - older) / tickSize
  }
  return drift
}

function median(values: readonly number[]) {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]
}

function sideSign(side: FlowEventRecord['side']) {
  if (side === 'buy' || side === 'bid' || side === 'long') return 1
  if (side === 'sell' || side === 'ask' || side === 'short') return -1
  return 0
}

function midpoint(bestBid: number | null, bestAsk: number | null) {
  if (bestBid == null || bestAsk == null || bestBid <= 0 || bestAsk <= 0 || bestAsk < bestBid) return null
  return (bestBid + bestAsk) / 2
}

function positiveOr(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function compassLabel(score: number) {
  if (score >= 70) return 'Güçlü alım baskısı'
  if (score >= 40) return 'Alım baskısı var'
  if (score >= 15) return 'Hafif yukarı eğilim'
  if (score > -15) return 'Nötr / sıkışma'
  if (score > -40) return 'Hafif aşağı eğilim'
  if (score > -70) return 'Satış baskısı var'
  return 'Güçlü satış baskısı'
}

function compassColor(score: number) {
  if (score >= 40) return '#26a69a'
  if (score <= -40) return '#ef5350'
  return '#8b949e'
}

function neutralState(updatedAt: number | null): CompassState {
  return {
    score: 0,
    components: { ...ZERO_COMPONENTS },
    direction: 'FLAT',
    label: 'Nötr / sıkışma',
    color: '#93a59a',
    updatedAt,
  }
}
