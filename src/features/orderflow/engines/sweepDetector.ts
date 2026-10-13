import { systemClock, type Clock } from '../clock'
import type { FlowEventDraft, OrderflowTrade } from '../types'
import { compactNotional, formatPrice } from './format'
import { BoundedQueue } from './queue'

const LEVEL_TTL_MS = 15_000
const SWEEP_COOLDOWN_MS = 4_000
const TRADE_CONFIRM_WINDOW_MS = 3_000
const MAX_LEVELS = 1_000
const MAX_TRADES = 8_000

interface DeletedLevel {
  key: string
  side: 'bid' | 'ask'
  price: number
  notional: number
  ts: number
  priceAtDelete: number
}

export interface ConfirmedDomSweep {
  ts: number
  price: number
  direction: 'LONG' | 'SHORT'
  notional: number
  confidence: 'HIGH' | 'MEDIUM'
  hasVacuum: boolean
  tradeConfirm: boolean
}

export interface SweepDepthContext {
  bestBid: number | null
  bestAsk: number | null
  previousBestBid: number | null
  previousBestAsk: number | null
  whaleThreshold: number
}

export class DomSweepDetector {
  private bids = new Map<number, number>()
  private asks = new Map<number, number>()
  private deletedLevels = new Map<string, DeletedLevel>()
  private trades = new BoundedQueue<OrderflowTrade>(MAX_TRADES)
  private confirmed = new BoundedQueue<ConfirmedDomSweep>(20)
  private lastSweepAt = Number.NEGATIVE_INFINITY

  constructor(private readonly clock: Clock = systemClock) {}

  onSnapshot(bids: ReadonlyMap<number, number>, asks: ReadonlyMap<number, number>) {
    this.bids = new Map(bids)
    this.asks = new Map(asks)
    this.deletedLevels.clear()
  }

  onTrade(trade: OrderflowTrade, now = this.clock.now()) {
    if (!Number.isFinite(trade.ts) || trade.notional <= 0 || trade.price <= 0) return
    this.pruneTrades(now - TRADE_CONFIRM_WINDOW_MS)
    this.trades.push({ ...trade })
  }

  onDepthDiff(
    bids: readonly [number, number][],
    asks: readonly [number, number][],
    context: SweepDepthContext,
    now = this.clock.now(),
  ): FlowEventDraft[] {
    if (!Number.isFinite(context.whaleThreshold) || context.whaleThreshold <= 0) return []
    this.pruneTrades(now - TRADE_CONFIRM_WINDOW_MS)
    this.applySide(bids, 'bid', context, now)
    this.applySide(asks, 'ask', context, now)
    this.pruneDeletedLevels(now)
    if (now - this.lastSweepAt < SWEEP_COOLDOWN_MS) return []

    const bestBid = context.bestBid ?? findBest(this.bids, true)
    const bestAsk = context.bestAsk ?? findBest(this.asks, false)
    if (bestBid == null || bestAsk == null || bestBid <= 0 || bestAsk <= 0) return []
    const mid = (bestBid + bestAsk) / 2
    const events: FlowEventDraft[] = []

    for (const [key, level] of this.deletedLevels) {
      const sweptAsk = level.side === 'ask' && bestAsk > level.price
      const sweptBid = level.side === 'bid' && bestBid < level.price
      if (!sweptAsk && !sweptBid) continue

      const direction = sweptAsk ? 'LONG' : 'SHORT'
      const movePct = level.priceAtDelete > 0 ? Math.abs(mid - level.priceAtDelete) / level.priceAtDelete : 0
      const hasVacuum = this.hasVacuum(level.price, direction, mid)
      const tradeConfirm = this.hasTradeConfirm(direction, context.whaleThreshold, now)
      const score = confidenceScore(level.notional, context.whaleThreshold, now - level.ts, hasVacuum, tradeConfirm, movePct)
      if (score < 4) continue

      this.lastSweepAt = now
      this.deletedLevels.delete(key)
      const confidence = score >= 7 ? 'HIGH' : 'MEDIUM'
      const side = direction === 'LONG' ? 'buy' : 'sell'
      const record: ConfirmedDomSweep = {
        ts: now,
        price: level.price,
        direction,
        notional: level.notional,
        confidence,
        hasVacuum,
        tradeConfirm,
      }
      this.confirmed.push(record)
      events.push({
        type: 'DOM SWEEP',
        sev: confidence === 'HIGH' ? 'high' : 'medium',
        text: `DOM sweep ${direction === 'LONG' ? 'YUKARI' : 'AŞAĞI'} · ${compactNotional(level.notional)} USDT @ ${formatPrice(level.price)}${hasVacuum ? ' · vakum' : ''}${tradeConfirm ? ' · trade teyidi' : ''}`,
        ts: now,
        side,
        price: level.price,
        notional: level.notional,
        direction,
        source: 'depth',
        data: {
          confidence,
          hasVacuum,
          tradeConfirm,
          movePct,
          ageMs: now - level.ts,
        },
      })
      break
    }
    return events
  }

  recentSweep(windowMs = 15_000, now = this.clock.now()) {
    const recent = this.confirmed.toArray().reverse()
    return recent.find((sweep) => now - sweep.ts <= windowMs) ?? null
  }

  confirmedSweeps() {
    return this.confirmed.toArray().reverse()
  }

  reset() {
    this.bids.clear()
    this.asks.clear()
    this.deletedLevels.clear()
    this.trades.clear()
    this.confirmed.clear()
    this.lastSweepAt = Number.NEGATIVE_INFINITY
  }

  private applySide(
    updates: readonly [number, number][],
    side: 'bid' | 'ask',
    context: SweepDepthContext,
    now: number,
  ) {
    const book = side === 'bid' ? this.bids : this.asks
    const bestAtDelete = side === 'bid'
      ? context.previousBestBid ?? context.bestBid
      : context.previousBestAsk ?? context.bestAsk

    for (const [price, quantity] of updates) {
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(quantity) || quantity < 0) continue
      const previousQuantity = book.get(price) ?? 0
      if (quantity === 0) {
        const notional = price * previousQuantity
        if (previousQuantity > 0 && notional >= context.whaleThreshold * 0.5) {
          const key = `${side}|${price}`
          this.deletedLevels.set(key, {
            key,
            side,
            price,
            notional,
            ts: now,
            priceAtDelete: bestAtDelete ?? price,
          })
        }
        book.delete(price)
      } else {
        book.set(price, quantity)
      }
    }
    while (book.size > MAX_LEVELS) {
      const farthest = findFarthest(book, side === 'bid')
      if (farthest == null) break
      book.delete(farthest)
    }
  }

  private hasVacuum(sweepPrice: number, direction: 'LONG' | 'SHORT', mid: number) {
    const scanRange = mid * 0.005
    const book = direction === 'LONG' ? this.asks : this.bids
    let count = 0
    for (const price of book.keys()) {
      const inRange = direction === 'LONG'
        ? price > sweepPrice && price < sweepPrice + scanRange
        : price < sweepPrice && price > sweepPrice - scanRange
      if (inRange) count += 1
    }
    return count < 5
  }

  private hasTradeConfirm(direction: 'LONG' | 'SHORT', threshold: number, now: number) {
    const side = direction === 'LONG' ? 'buy' : 'sell'
    let total = 0
    for (const trade of this.trades) {
      const age = now - trade.ts
      if (trade.side === side && age >= 0 && age <= TRADE_CONFIRM_WINDOW_MS) total += trade.notional
    }
    return total > threshold * 0.8
  }

  private pruneTrades(cutoff: number) {
    this.trades.pruneWhile((trade) => trade.ts < cutoff)
  }

  private pruneDeletedLevels(now: number) {
    for (const [key, level] of this.deletedLevels) {
      if (now - level.ts > LEVEL_TTL_MS) this.deletedLevels.delete(key)
    }
    while (this.deletedLevels.size > MAX_LEVELS) {
      const oldestKey = this.deletedLevels.keys().next().value as string | undefined
      if (oldestKey == null) break
      this.deletedLevels.delete(oldestKey)
    }
  }
}

function confidenceScore(
  notional: number,
  threshold: number,
  age: number,
  hasVacuum: boolean,
  tradeConfirm: boolean,
  movePct: number,
) {
  let score = notional >= threshold * 2 ? 3 : notional >= threshold ? 2 : 1
  if (age < 5_000) score += 2
  if (age < 10_000) score += 1
  if (hasVacuum) score += 2
  if (tradeConfirm) score += 2
  if (movePct > 0.001) score += 1
  return score
}

function findBest(book: ReadonlyMap<number, number>, descending: boolean) {
  let best = descending ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY
  for (const [price, quantity] of book) {
    if (quantity <= 0) continue
    if (descending ? price > best : price < best) best = price
  }
  return Number.isFinite(best) ? best : null
}

function findFarthest(book: ReadonlyMap<number, number>, bidSide: boolean) {
  let farthest: number | null = null
  for (const price of book.keys()) {
    if (farthest == null || (bidSide ? price < farthest : price > farthest)) farthest = price
  }
  return farthest
}
