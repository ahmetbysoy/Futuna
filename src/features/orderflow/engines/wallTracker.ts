import { systemClock, type Clock } from '../clock'
import type { FlowEventDraft, OrderflowTrade, WallHistoryPoint, WallRecord, WallTrend } from '../types'
import { compactNotional, formatPrice } from './format'

const UPDATE_INTERVAL_MS = 200
const HISTORY_LENGTH = 30
const FLASH_DURATION_MS = 2_000
const ABSORB_WINDOW_MS = 4_000
const WALL_GONE_TRADE_WINDOW_MS = 2_000
const WALL_LOG_SUPPRESSION_MS = 30_000
const MAX_WALLS = 20
const MAX_WALL_LOGS = 2_000

interface Candidate {
  side: 'bid' | 'ask'
  price: number
  notional: number
  score: number
}

interface WallLogRecord {
  side: 'bid' | 'ask'
  price: number
  notional: number
  ts: number
}

export interface WallTrackerInput {
  bids: ReadonlyMap<number, number>
  asks: ReadonlyMap<number, number>
  bestBid: number | null
  bestAsk: number | null
  tickSize: number
  depthTickSize: number
  wallMin: number
  liveWallCount: number
  liveWallRange: number
  trades: Iterable<OrderflowTrade>
  now?: number
}

export interface WallTrackerUpdate {
  walls: WallRecord[]
  events: FlowEventDraft[]
  updated: boolean
}

export class WallTracker {
  private walls = new Map<string, WallRecord>()
  private wallLog = new Map<string, WallLogRecord>()
  private lastUpdateAt = Number.NEGATIVE_INFINITY

  constructor(private readonly clock: Clock = systemClock) {}

  seed(input: WallTrackerInput) {
    const result = this.update(input)
    return result.walls
  }

  update(input: WallTrackerInput): WallTrackerUpdate {
    const now = input.now ?? this.clock.now()
    if (now - this.lastUpdateAt < UPDATE_INTERVAL_MS) return { walls: [], events: [], updated: false }
    this.lastUpdateAt = now

    const mid = midpoint(input.bestBid, input.bestAsk)
    if (mid == null || input.depthTickSize <= 0 || input.tickSize <= 0 || input.wallMin <= 0) {
      return { walls: this.snapshot(), events: [], updated: true }
    }

    const rangePct = clamp(input.liveWallRange, 0.1, 2) / 100
    const range = mid * rangePct
    const step = Math.max(Number.EPSILON, input.depthTickSize)
    const candidates = [
      ...this.groupCandidates(input.bids, 'bid', mid, range, step, input.wallMin),
      ...this.groupCandidates(input.asks, 'ask', mid, range, step, input.wallMin),
    ]
    for (const candidate of candidates) {
      const distPct = Math.abs(candidate.price - mid) / mid
      candidate.score = candidate.notional / (distPct + 0.0001)
    }
    candidates.sort((left, right) => right.score - left.score)

    const count = Math.max(2, Math.min(MAX_WALLS, Math.floor(input.liveWallCount) || 5))
    const selected = candidates.slice(0, count)
    const selectedKeys = new Set(selected.map((candidate) => this.key(candidate, step)))
    const events: FlowEventDraft[] = []
    this.pruneWallLog(now)

    for (const [key, wall] of this.walls) {
      if (selectedKeys.has(key)) continue
      const eaten = this.wasEaten(wall, input.trades, input.tickSize, now)
      events.push(this.wallDisappearanceEvent(wall, eaten, mid, now))
      this.walls.delete(key)
    }

    for (const candidate of selected) {
      const key = this.key(candidate, step)
      const current = this.walls.get(key)
      if (!current) {
        const wall: WallRecord = {
          key,
          side: candidate.side,
          price: candidate.price,
          notional: candidate.notional,
          history: [{ ts: now, notional: candidate.notional }],
          absorbedNotional: 0,
          absorbTs: 0,
          flashTs: now,
          bornTs: now,
          trend: 'STABLE',
        }
        this.walls.set(key, wall)
        if (!this.shouldSuppressLog(candidate, input.tickSize, now)) {
          events.push(this.wallNewEvent(candidate, mid, now))
          this.wallLog.set(`${candidate.side}|${candidate.price}`, {
            side: candidate.side,
            price: candidate.price,
            notional: candidate.notional,
            ts: now,
          })
        }
        continue
      }

      const previousNotional = current.notional
      current.price = candidate.price
      current.notional = candidate.notional
      current.history = appendHistory(current.history, { ts: now, notional: candidate.notional }, HISTORY_LENGTH)
      current.trend = calculateTrend(current.history)
      if (previousNotional > 0 && candidate.notional > previousNotional * 1.25) {
        current.flashTs = now
        events.push({
          type: 'WALL_GROW',
          sev: 'medium',
          text: `Duvar büyüdü · ${candidate.side === 'bid' ? 'BID' : 'ASK'} ${compactNotional(candidate.notional)} USDT @ ${formatPrice(candidate.price)}`,
          ts: now,
          side: candidate.side,
          price: candidate.price,
          notional: candidate.notional,
          source: 'depth',
          data: {
            side: candidate.side,
            price: candidate.price,
            previousNotional: Math.round(previousNotional),
            notional: Math.round(candidate.notional),
            growthPct: Math.round((candidate.notional / previousNotional - 1) * 100),
            mid,
          },
        })
      }
    }

    return { walls: this.snapshot(), events, updated: true }
  }

  onTrade(trade: OrderflowTrade, depthTickSize: number, now = this.clock.now()) {
    if (!Number.isFinite(trade.price) || trade.price <= 0 || !Number.isFinite(trade.notional) || trade.notional <= 0) return
    for (const wall of this.walls.values()) {
      if (Math.abs(wall.price - trade.price) > depthTickSize * 3) continue
      if (now - wall.absorbTs > ABSORB_WINDOW_MS) wall.absorbedNotional = 0
      wall.absorbedNotional += trade.notional
      wall.absorbTs = now
    }
  }

  recentAbsorb(wall: WallRecord, now = this.clock.now()) {
    return now - wall.absorbTs < ABSORB_WINDOW_MS ? wall.absorbedNotional : 0
  }

  isFlashing(wall: WallRecord, now = this.clock.now()) {
    return now - wall.flashTs < FLASH_DURATION_MS
  }

  trend(wall: WallRecord) {
    return calculateTrend(wall.history)
  }

  snapshot() {
    return Array.from(this.walls.values(), (wall) => ({
      ...wall,
      history: wall.history.map((point) => ({ ...point })),
    }))
  }

  reset() {
    this.walls.clear()
    this.wallLog.clear()
    this.lastUpdateAt = Number.NEGATIVE_INFINITY
  }

  private groupCandidates(
    book: ReadonlyMap<number, number>,
    side: 'bid' | 'ask',
    mid: number,
    range: number,
    step: number,
    wallMin: number,
  ) {
    const groups = new Map<number, { sumPriceQuantity: number; sumQuantity: number }>()
    for (const [price, quantity] of book) {
      if (!Number.isFinite(price) || !Number.isFinite(quantity) || price <= 0 || quantity <= 0) continue
      if (Math.abs(price - mid) > range) continue
      const bin = Math.round(price / step)
      const group = groups.get(bin) ?? { sumPriceQuantity: 0, sumQuantity: 0 }
      group.sumPriceQuantity += price * quantity
      group.sumQuantity += quantity
      groups.set(bin, group)
    }
    const candidates: Candidate[] = []
    for (const group of groups.values()) {
      if (group.sumQuantity <= 0) continue
      const price = group.sumPriceQuantity / group.sumQuantity
      const notional = group.sumPriceQuantity
      if (notional >= wallMin) candidates.push({ side, price, notional, score: 0 })
    }
    return candidates
  }

  private wasEaten(wall: WallRecord, trades: Iterable<OrderflowTrade>, tickSize: number, now: number) {
    for (const trade of trades) {
      if (now - trade.ts < 0 || now - trade.ts > WALL_GONE_TRADE_WINDOW_MS) continue
      if (Math.abs(trade.price - wall.price) > tickSize * 3) continue
      if (trade.notional >= wall.notional * 0.3) return true
    }
    return false
  }

  private wallDisappearanceEvent(wall: WallRecord, eaten: boolean, mid: number, now: number): FlowEventDraft {
    const ageSeconds = Math.round((now - wall.bornTs) / 1_000)
    return {
      type: eaten ? 'WALL_EATEN' : 'WALL_GONE',
      sev: eaten ? 'medium' : 'low',
      text: `${eaten ? 'Duvar tüketildi' : 'Duvar çekildi'} · ${wall.side === 'bid' ? 'BID' : 'ASK'} ${compactNotional(wall.notional)} USDT @ ${formatPrice(wall.price)}`,
      ts: now,
      side: wall.side,
      price: wall.price,
      notional: wall.notional,
      source: 'depth',
      data: {
        side: wall.side,
        price: wall.price,
        notional: Math.round(wall.notional),
        ageSec: ageSeconds,
        mid,
      },
    }
  }

  private wallNewEvent(candidate: Candidate, mid: number, now: number): FlowEventDraft {
    return {
      type: 'WALL_NEW',
      sev: 'medium',
      text: `Yeni duvar · ${candidate.side === 'bid' ? 'BID' : 'ASK'} ${compactNotional(candidate.notional)} USDT @ ${formatPrice(candidate.price)}`,
      ts: now,
      side: candidate.side,
      price: candidate.price,
      notional: candidate.notional,
      source: 'depth',
      data: {
        side: candidate.side,
        price: candidate.price,
        notional: Math.round(candidate.notional),
        mid,
      },
    }
  }

  private shouldSuppressLog(candidate: Candidate, tickSize: number, now: number) {
    for (const record of this.wallLog.values()) {
      if (now - record.ts > WALL_LOG_SUPPRESSION_MS || record.side !== candidate.side) continue
      if (Math.abs(record.price - candidate.price) > tickSize) continue
      const difference = Math.abs(record.notional - candidate.notional) / Math.max(record.notional, 1)
      if (difference <= 0.05) return true
    }
    return false
  }

  private pruneWallLog(now: number) {
    for (const [key, record] of this.wallLog) {
      if (now - record.ts > WALL_LOG_SUPPRESSION_MS) this.wallLog.delete(key)
    }
    while (this.wallLog.size > MAX_WALL_LOGS) {
      const firstKey = this.wallLog.keys().next().value as string | undefined
      if (firstKey == null) break
      this.wallLog.delete(firstKey)
    }
  }

  private key(candidate: Candidate, step: number) {
    return `${candidate.side}|${Math.round(candidate.price / step)}`
  }
}

export function calculateTrend(history: readonly WallHistoryPoint[]): WallTrend {
  if (history.length < 4) return 'STABLE'
  const half = Math.floor(history.length / 2)
  const older = average(history.slice(0, half).map((point) => point.notional))
  const newer = average(history.slice(half).map((point) => point.notional))
  const ratio = older > 0 ? newer / older : 1
  if (ratio > 1.12) return 'GROWING'
  if (ratio < 0.88) return 'SHRINKING'
  return 'STABLE'
}

function appendHistory(history: readonly WallHistoryPoint[], point: WallHistoryPoint, limit: number) {
  return [...history, point].slice(-limit)
}

function midpoint(bestBid: number | null, bestAsk: number | null) {
  if (bestBid == null || bestAsk == null || bestBid <= 0 || bestAsk <= 0) return null
  return (bestBid + bestAsk) / 2
}

function average(values: readonly number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}
