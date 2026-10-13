import { systemClock, type Clock } from '../clock'
import type { FlowEventDraft, OrderflowTrade } from '../types'
import { compactNotional, formatPrice } from './format'
import { BoundedQueue } from './queue'

const MAX_TRACKED_LEVELS = 3_000
const MAX_RECENT_TRADES = 8_000
const SPOOF_MAX_AGE_MS = 8_000
const TRADE_MATCH_WINDOW_MS = 300
const EVENT_COOLDOWN_MS = 2_000

interface TrackedLevel {
  side: 'bid' | 'ask'
  price: number
  quantity: number
  notional: number
  bornTs: number
  lastTouchedTs: number
  eligible: boolean
}

export interface SpoofDepthContext {
  bestBid: number | null
  bestAsk: number | null
  previousBestBid: number | null
  previousBestAsk: number | null
  tickSize: number
  whaleThreshold: number
}

export class SpoofDetector {
  private levels = new Map<string, TrackedLevel>()
  private trades = new BoundedQueue<OrderflowTrade>(MAX_RECENT_TRADES)
  private lastEventAt = new Map<string, number>()

  constructor(private readonly clock: Clock = systemClock) {}

  onSnapshot(bids: ReadonlyMap<number, number>, asks: ReadonlyMap<number, number>, now = this.clock.now()) {
    this.levels.clear()
    this.lastEventAt.clear()
    this.seedBook(bids, 'bid', now)
    this.seedBook(asks, 'ask', now)
    this.trades.clear()
  }

  onTrade(trade: OrderflowTrade, now = this.clock.now()) {
    if (!Number.isFinite(trade.ts) || !Number.isFinite(trade.price) || trade.price <= 0 || trade.notional <= 0) return
    this.pruneTrades(now - 10_000)
    this.trades.push({ ...trade })
  }

  onDepthDiff(
    bids: readonly [number, number][],
    asks: readonly [number, number][],
    context: SpoofDepthContext,
    now = this.clock.now(),
  ): FlowEventDraft[] {
    if (!Number.isFinite(context.tickSize) || context.tickSize <= 0
      || !Number.isFinite(context.whaleThreshold) || context.whaleThreshold <= 0) return []

    this.pruneTrades(now - 10_000)
    this.pruneCooldowns(now)
    const events: FlowEventDraft[] = []
    this.applySide(bids, 'bid', context, now, events)
    this.applySide(asks, 'ask', context, now, events)
    this.trimLevels()
    return events
  }

  reset() {
    this.levels.clear()
    this.trades.clear()
    this.lastEventAt.clear()
  }

  private seedBook(book: ReadonlyMap<number, number>, side: 'bid' | 'ask', now: number) {
    for (const [price, quantity] of book) {
      if (!validLevel(price, quantity)) continue
      this.levels.set(this.key(side, price), {
        side,
        price,
        quantity,
        notional: price * quantity,
        bornTs: now,
        lastTouchedTs: now,
        eligible: false,
      })
    }
  }

  private applySide(
    updates: readonly [number, number][],
    side: 'bid' | 'ask',
    context: SpoofDepthContext,
    now: number,
    events: FlowEventDraft[],
  ) {
    for (const [price, quantity] of updates) {
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(quantity) || quantity < 0) continue
      const key = this.key(side, price)
      const tracked = this.levels.get(key)

      if (quantity === 0) {
        if (tracked) {
          const event = this.classifyRemoval(tracked, context, now)
          if (event) events.push(event)
          this.levels.delete(key)
        }
        continue
      }

      if (!tracked) {
        this.levels.set(key, {
          side,
          price,
          quantity,
          notional: price * quantity,
          bornTs: now,
          lastTouchedTs: now,
          eligible: true,
        })
      } else {
        if (!tracked.eligible) {
          tracked.bornTs = now
          tracked.eligible = true
        }
        tracked.quantity = quantity
        tracked.notional = price * quantity
        tracked.lastTouchedTs = now
      }
    }
  }

  private classifyRemoval(level: TrackedLevel, context: SpoofDepthContext, now: number): FlowEventDraft | null {
    const age = now - level.bornTs
    const best = level.side === 'bid'
      ? context.previousBestBid ?? context.bestBid
      : context.previousBestAsk ?? context.bestAsk
    if (!level.eligible || age < 0 || age >= SPOOF_MAX_AGE_MS || level.notional < context.whaleThreshold || best == null || best <= 0) return null
    if (Math.abs(level.price - best) / best > 0.003) return null

    const key = this.key(level.side, level.price)
    if (now - (this.lastEventAt.get(key) ?? Number.NEGATIVE_INFINITY) < EVENT_COOLDOWN_MS) return null
    this.lastEventAt.set(key, now)

    const aggressorSide = level.side === 'ask' ? 'buy' : 'sell'
    const matchedNotional = this.matchingTradeNotional(level, aggressorSide, context.tickSize, now)
    const filled = matchedNotional / Math.max(level.notional, 1) >= 0.70
    const type = filled ? 'FILLED' : 'SPOOF?'
    const side = filled ? aggressorSide : level.side
    const label = filled ? 'Seviye işlemle doldu' : 'Şüpheli duvar çekilmesi'
    const data = {
      side: level.side,
      price: level.price,
      notional: Math.round(level.notional),
      ageMs: Math.round(age),
      matchedNotional: Math.round(matchedNotional),
    }

    return {
      type,
      sev: level.notional >= context.whaleThreshold * 2 ? 'high' : 'medium',
      text: `${label} · ${level.side === 'bid' ? 'BID' : 'ASK'} ${compactNotional(level.notional)} USDT @ ${formatPrice(level.price)}`,
      ts: now,
      side,
      price: level.price,
      notional: level.notional,
      source: 'depth',
      data,
    }
  }

  private matchingTradeNotional(level: TrackedLevel, side: 'buy' | 'sell', tickSize: number, now: number) {
    let total = 0
    for (const trade of this.trades) {
      if (trade.side !== side || now - trade.ts < 0 || now - trade.ts > TRADE_MATCH_WINDOW_MS) continue
      if (Math.abs(trade.price - level.price) <= tickSize * 3) total += trade.notional
    }
    return total
  }

  private pruneTrades(cutoff: number) {
    this.trades.pruneWhile((trade) => trade.ts < cutoff)
  }

  private pruneCooldowns(now: number) {
    for (const [key, ts] of this.lastEventAt) {
      if (now - ts > 30_000) this.lastEventAt.delete(key)
    }
    while (this.lastEventAt.size > MAX_TRACKED_LEVELS) {
      const firstKey = this.lastEventAt.keys().next().value as string | undefined
      if (firstKey == null) break
      this.lastEventAt.delete(firstKey)
    }
  }

  private trimLevels() {
    while (this.levels.size > MAX_TRACKED_LEVELS) {
      const key = this.levels.keys().next().value as string | undefined
      if (key == null) break
      this.levels.delete(key)
    }
  }

  private key(side: 'bid' | 'ask', price: number) {
    return `${side}|${price}`
  }
}

function validLevel(price: number, quantity: number) {
  return Number.isFinite(price) && price > 0 && Number.isFinite(quantity) && quantity > 0
}
