import { systemClock, type Clock } from '../clock'
import type { FlowEventDraft, OrderflowTrade } from '../types'
import { compactNotional, formatPrice } from './format'
import { BoundedQueue } from './queue'

const TRADE_RETENTION_MS = 60_000
const MAX_TRADE_SAMPLES = 8_000

export class TradeDetectors {
  private trades = new BoundedQueue<OrderflowTrade>(MAX_TRADE_SAMPLES)
  private lastWhaleAt = Number.NEGATIVE_INFINITY
  private lastSweepAt = Number.NEGATIVE_INFINITY
  private lastAbsorptionAt = Number.NEGATIVE_INFINITY
  private lastDeltaBurstAt = Number.NEGATIVE_INFINITY

  constructor(private readonly clock: Clock = systemClock) {}

  onTrade(
    trade: OrderflowTrade,
    threshold: number,
    enabled = true,
    now = this.clock.now(),
  ): FlowEventDraft[] {
    if (!validTrade(trade) || !Number.isFinite(threshold) || threshold <= 0) return []
    this.prune(now - TRADE_RETENTION_MS)
    this.trades.push({ ...trade })
    if (!enabled) return []

    const events: FlowEventDraft[] = []
    if (trade.notional >= threshold && now - this.lastWhaleAt >= 2_500) {
      this.lastWhaleAt = now
      const sideLabel = trade.side === 'buy' ? 'ALIM' : 'SATIŞ'
      events.push({
        type: 'WHALE',
        sev: trade.notional >= threshold * 2 ? 'high' : 'medium',
        text: `Whale ${sideLabel} ${compactNotional(trade.notional)} USDT · ${formatPrice(trade.price)}`,
        ts: trade.ts,
        side: trade.side,
        price: trade.price,
        notional: trade.notional,
        source: 'trade',
      })
    }

    const sweep = this.detectTradeSweep(threshold, now)
    if (sweep) events.push(sweep)
    const absorption = this.detectAbsorption(threshold, now)
    if (absorption) events.push(absorption)
    const deltaBurst = this.detectDeltaBurst(threshold, now)
    if (deltaBurst) events.push(deltaBurst)
    return events
  }

  recent(windowMs: number, now = this.clock.now()) {
    this.prune(now - TRADE_RETENTION_MS)
    const result: OrderflowTrade[] = []
    for (const trade of this.trades) {
      const age = now - trade.ts
      if (age >= 0 && age <= windowMs) result.push(trade)
    }
    return result
  }

  reset() {
    this.trades.clear()
    this.lastWhaleAt = Number.NEGATIVE_INFINITY
    this.lastSweepAt = Number.NEGATIVE_INFINITY
    this.lastAbsorptionAt = Number.NEGATIVE_INFINITY
    this.lastDeltaBurstAt = Number.NEGATIVE_INFINITY
  }

  private detectTradeSweep(threshold: number, now: number): FlowEventDraft | null {
    if (now - this.lastSweepAt < 6_000) return null
    const recent = this.recent(1_800, now)
    for (const side of ['buy', 'sell'] as const) {
      const sameSide = recent.filter((trade) => trade.side === side)
      const total = sameSide.reduce((sum, trade) => sum + trade.notional, 0)
      if (sameSide.length < 4 || total <= threshold * 1.8) continue
      this.lastSweepAt = now
      return {
        type: 'SWEEP',
        sev: 'high',
        text: `Sweep ${side === 'buy' ? 'ALIM' : 'SATIŞ'} · ${compactNotional(total)} USDT / ${sameSide.length} işlem`,
        ts: now,
        side,
        price: sameSide.at(-1)?.price ?? null,
        notional: total,
        source: 'trade',
      }
    }
    return null
  }

  private detectAbsorption(threshold: number, now: number): FlowEventDraft | null {
    if (now - this.lastAbsorptionAt < 12_000) return null
    const recent = this.recent(10_000, now)
    if (recent.length < 6) return null
    const delta = recent.reduce((sum, trade) => sum + (trade.side === 'buy' ? trade.notional : -trade.notional), 0)
    const firstPrice = recent[0].price
    const lastPrice = recent.at(-1)?.price ?? firstPrice
    const movePct = firstPrice > 0 ? Math.abs(lastPrice - firstPrice) / firstPrice : 1
    if (Math.abs(delta) <= threshold * 2.2 || movePct >= 0.00035) return null

    this.lastAbsorptionAt = now
    return {
      type: 'ABSORPTION?',
      sev: 'medium',
      text: `Olası absorpsiyon · net delta ${compactNotional(Math.abs(delta))} USDT, fiyat hareketi ${(movePct * 100).toFixed(3)}%`,
      ts: now,
      side: delta > 0 ? 'buy' : 'sell',
      price: lastPrice,
      notional: Math.abs(delta),
      source: 'trade',
    }
  }

  private detectDeltaBurst(threshold: number, now: number): FlowEventDraft | null {
    if (now - this.lastDeltaBurstAt < 15_000) return null
    const recent = this.recent(60_000, now)
    if (recent.length < 2) return null
    const sumDelta = recent.reduce((sum, trade) => sum + (trade.side === 'buy' ? trade.notional : -trade.notional), 0)
    const perMinute = sumDelta / (60_000 / 60_000)
    if (Math.abs(perMinute) <= threshold * 2.5) return null

    this.lastDeltaBurstAt = now
    const side = perMinute > 0 ? 'buy' : 'sell'
    return {
      type: 'DELTA BURST',
      sev: 'high',
      text: `Delta ivmesi ${side === 'buy' ? 'ALIM' : 'SATIŞ'} · ${compactNotional(Math.abs(perMinute))} USDT/dk`,
      ts: now,
      side,
      price: recent.at(-1)?.price ?? null,
      notional: Math.abs(perMinute),
      source: 'trade',
    }
  }

  private prune(cutoff: number) {
    this.trades.pruneWhile((trade) => trade.ts < cutoff)
  }
}

function validTrade(trade: OrderflowTrade) {
  return Number.isFinite(trade.ts)
    && Number.isFinite(trade.price)
    && trade.price > 0
    && Number.isFinite(trade.notional)
    && trade.notional > 0
}
