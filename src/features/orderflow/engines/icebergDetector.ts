import { systemClock, type Clock } from '../clock'
import type { FlowEventDraft, OrderflowTrade } from '../types'
import { compactNotional, formatPrice } from './format'
import { BoundedQueue } from './queue'

const MIN_REFILLS = 3
const REFILL_TTL_MS = 30_000
const EVENT_COOLDOWN_MS = 20_000
const MAX_TICK_DISTANCE = 20
const TRADE_MATCH_WINDOW_MS = 500
const MAX_TRACKED_LEVELS = 2_000
const MAX_CONFIRMED = 20

interface RemovedLevel {
  ts: number
  notional: number
}

interface RefillRecord {
  key: string
  side: 'bid' | 'ask'
  price: number
  notional: number
  refills: number
  domCount: number
  tradeCount: number
  firstTs: number
  lastTs: number
}

interface TradeHit {
  ts: number
  side: 'bid' | 'ask'
  price: number
  beforeQuantity: number
  tradeNotional: number
}

export interface ConfirmedIceberg {
  ts: number
  price: number
  side: 'bid' | 'ask'
  notional: number
  refills: number
  domCount: number
  tradeCount: number
}

export interface IcebergContext {
  bestBid: number | null
  bestAsk: number | null
  tickSize: number
  depthTickSize: number
  whaleThreshold: number
}

export class IcebergDetector {
  private bids = new Map<number, number>()
  private asks = new Map<number, number>()
  private removed = new Map<string, RemovedLevel>()
  private levels = new Map<string, RefillRecord>()
  private lastEventAt = new Map<string, number>()
  private pendingHits = new BoundedQueue<TradeHit>(300)
  private confirmed = new BoundedQueue<ConfirmedIceberg>(MAX_CONFIRMED)

  constructor(private readonly clock: Clock = systemClock) {}

  onSnapshot(bids: ReadonlyMap<number, number>, asks: ReadonlyMap<number, number>) {
    this.bids = new Map(bids)
    this.asks = new Map(asks)
    this.removed.clear()
    this.levels.clear()
    this.pendingHits.clear()
  }

  onTrade(trade: OrderflowTrade, context: IcebergContext, now = this.clock.now()) {
    const mid = midpoint(context.bestBid, context.bestAsk)
    if (mid == null || !validContext(context) || trade.notional <= 0) return
    this.prunePendingHits(now)

    const side = trade.side === 'sell' ? 'bid' : 'ask'
    const book = side === 'bid' ? this.bids : this.asks
    const maxMatchDistance = context.depthTickSize * 2
    let match: { price: number; quantity: number } | null = null
    let matchDistance = Number.POSITIVE_INFINITY

    for (const [price, quantity] of book) {
      const distance = Math.abs(price - trade.price)
      if (distance > maxMatchDistance || distance >= matchDistance) continue
      if (price * quantity < context.whaleThreshold * 0.4) continue
      if (Math.abs(price - mid) / context.tickSize > MAX_TICK_DISTANCE) continue
      match = { price, quantity }
      matchDistance = distance
    }

    if (match) {
      this.pendingHits.push({
        ts: now,
        side,
        price: match.price,
        beforeQuantity: match.quantity,
        tradeNotional: trade.notional,
      })
    }
  }

  onDepthDiff(
    bidUpdates: readonly [number, number][],
    askUpdates: readonly [number, number][],
    context: IcebergContext,
    now = this.clock.now(),
  ): FlowEventDraft[] {
    const mid = midpoint(context.bestBid, context.bestAsk)
    if (mid == null || !validContext(context)) return []
    this.pruneRemoved(now)
    this.prunePendingHits(now)
    const changed = new Set<string>()
    const domRefilled = new Set<string>()
    const events: FlowEventDraft[] = []

    this.applySide(bidUpdates, 'bid', context, mid, now, changed, domRefilled, events)
    this.applySide(askUpdates, 'ask', context, mid, now, changed, domRefilled, events)
    this.checkTradeRefills(changed, domRefilled, context, mid, now, events)
    this.trimMaps(now)
    return events
  }

  confirmedIcebergs() {
    return this.confirmed.toArray()
  }

  reset() {
    this.bids.clear()
    this.asks.clear()
    this.removed.clear()
    this.levels.clear()
    this.lastEventAt.clear()
    this.pendingHits.clear()
    this.confirmed.clear()
  }

  private applySide(
    updates: readonly [number, number][],
    side: 'bid' | 'ask',
    context: IcebergContext,
    mid: number,
    now: number,
    changed: Set<string>,
    domRefilled: Set<string>,
    events: FlowEventDraft[],
  ) {
    const book = side === 'bid' ? this.bids : this.asks
    for (const [price, quantity] of updates) {
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(quantity) || quantity < 0) continue
      const key = this.key(side, price)
      const previousQuantity = book.get(price) ?? 0
      changed.add(key)

      if (quantity === 0) {
        if (previousQuantity > 0) this.removed.set(key, { ts: now, notional: price * previousQuantity })
        book.delete(price)
        continue
      }

      const notional = price * quantity
      const removed = this.removed.get(key)
      book.set(price, quantity)
      if (removed && now - removed.ts >= 0 && now - removed.ts <= REFILL_TTL_MS
        && notional >= context.whaleThreshold * 0.4
        && this.isNearPrice(price, mid, context.tickSize)) {
        this.removed.delete(key)
        domRefilled.add(key)
        const event = this.increment(key, side, price, Math.max(removed.notional, notional), 'dom', context, now)
        if (event) events.push(event)
      } else if (removed && now - removed.ts > REFILL_TTL_MS) {
        this.removed.delete(key)
      }
    }
  }

  private checkTradeRefills(
    changed: Set<string>,
    domRefilled: Set<string>,
    context: IcebergContext,
    mid: number,
    now: number,
    events: FlowEventDraft[],
  ) {
    const grouped = new Map<string, TradeHit[]>()
    const remaining = new BoundedQueue<TradeHit>(300)
    for (const hit of this.pendingHits) {
      const age = now - hit.ts
      if (age < 0 || age > TRADE_MATCH_WINDOW_MS) continue
      const key = this.key(hit.side, hit.price)
      if (!changed.has(key)) {
        remaining.push(hit)
        continue
      }
      if (domRefilled.has(key)) continue
      const hits = grouped.get(key) ?? []
      hits.push(hit)
      grouped.set(key, hits)
    }
    this.pendingHits = remaining

    for (const [key, hits] of grouped) {
      const first = hits[0]
      const book = first.side === 'bid' ? this.bids : this.asks
      const quantity = book.get(first.price) ?? 0
      const currentNotional = first.price * quantity
      const tradeNotional = hits.reduce((sum, hit) => sum + hit.tradeNotional, 0)
      const persisted = quantity > 0 && quantity >= first.beforeQuantity * 0.9
      if (persisted
        && tradeNotional >= context.whaleThreshold * 0.4
        && currentNotional >= context.whaleThreshold * 0.4
        && this.isNearPrice(first.price, mid, context.tickSize)) {
        const event = this.increment(key, first.side, first.price, currentNotional, 'trade', context, now)
        if (event) events.push(event)
      }
    }
  }

  private increment(
    key: string,
    side: 'bid' | 'ask',
    price: number,
    notional: number,
    source: 'dom' | 'trade',
    context: IcebergContext,
    now: number,
  ): FlowEventDraft | null {
    let record = this.levels.get(key)
    if (record && now - record.firstTs > REFILL_TTL_MS) {
      this.levels.delete(key)
      record = undefined
    }
    if (!record) {
      record = { key, side, price, notional, refills: 0, domCount: 0, tradeCount: 0, firstTs: now, lastTs: now }
      this.levels.set(key, record)
    }
    record.refills += 1
    record.lastTs = now
    record.notional = Math.max(record.notional, notional)
    if (source === 'dom') record.domCount += 1
    else record.tradeCount += 1

    const lastEvent = this.lastEventAt.get(key) ?? Number.NEGATIVE_INFINITY
    if (record.refills < MIN_REFILLS || now - lastEvent < EVENT_COOLDOWN_MS) return null

    this.lastEventAt.set(key, now)
    const severity = record.notional >= context.whaleThreshold * 2 ? 'high' : 'medium'
    const direction = side === 'bid' ? 'buy' : 'sell'
    const elapsed = ((now - record.firstTs) / 1_000).toFixed(1)
    const confirmed: ConfirmedIceberg = {
      ts: now,
      price,
      side,
      notional: record.notional,
      refills: record.refills,
      domCount: record.domCount,
      tradeCount: record.tradeCount,
    }
    this.confirmed.push(confirmed)
    this.levels.delete(key)

    return {
      type: 'ICEBERG',
      sev: severity,
      text: `Iceberg ${side === 'bid' ? 'BID' : 'ASK'} ${compactNotional(record.notional)} USDT @ ${formatPrice(price)} · ${record.refills} yenileme/${elapsed}s`,
      ts: now,
      side: direction,
      price,
      notional: record.notional,
      source: 'depth',
      data: {
        refills: record.refills,
        domCount: record.domCount,
        tradeCount: record.tradeCount,
        elapsedSeconds: Number(elapsed),
      },
    }
  }

  private isNearPrice(price: number, mid: number, tickSize: number) {
    return Math.abs(price - mid) / tickSize <= MAX_TICK_DISTANCE
  }

  private pruneRemoved(now: number) {
    for (const [key, level] of this.removed) {
      if (now - level.ts > REFILL_TTL_MS) this.removed.delete(key)
    }
  }

  private prunePendingHits(now: number) {
    this.pendingHits.pruneWhile((hit) => now - hit.ts > TRADE_MATCH_WINDOW_MS)
  }

  private trimMaps(now: number) {
    for (const [key, ts] of this.lastEventAt) {
      if (now - ts > 60_000) this.lastEventAt.delete(key)
    }
    while (this.lastEventAt.size > MAX_TRACKED_LEVELS) {
      const firstKey = this.lastEventAt.keys().next().value as string | undefined
      if (firstKey == null) break
      this.lastEventAt.delete(firstKey)
    }
    while (this.removed.size > MAX_TRACKED_LEVELS) {
      const firstKey = this.removed.keys().next().value as string | undefined
      if (firstKey == null) break
      this.removed.delete(firstKey)
    }
    while (this.levels.size > MAX_TRACKED_LEVELS) {
      const firstKey = this.levels.keys().next().value as string | undefined
      if (firstKey == null) break
      this.levels.delete(firstKey)
    }
  }

  private key(side: 'bid' | 'ask', price: number) {
    return `${side}|${price}`
  }
}

function midpoint(bestBid: number | null, bestAsk: number | null) {
  if (bestBid == null || bestAsk == null || bestBid <= 0 || bestAsk <= 0) return null
  return (bestBid + bestAsk) / 2
}

function validContext(context: IcebergContext) {
  return Number.isFinite(context.tickSize) && context.tickSize > 0
    && Number.isFinite(context.depthTickSize) && context.depthTickSize > 0
    && Number.isFinite(context.whaleThreshold) && context.whaleThreshold > 0
}
