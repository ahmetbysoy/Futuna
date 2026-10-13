import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrderflowStore } from './orderflowStore'
import type { FlowEventDraft, HeatFrame, OrderflowTrade, WallAgeRecord, WallRecord } from './types'

let now = 1_000_000
const clock = { now: () => now }

function makeTrade(ts: number): OrderflowTrade {
  return { ts, price: 100, notional: 10_000, side: 'buy' }
}

function makeEvent(index: number): FlowEventDraft {
  return {
    type: 'WHALE',
    sev: 'medium',
    text: `event ${index}`,
    ts: now + index,
    side: 'buy',
    price: 100 + index,
    source: 'trade',
  }
}

function makeHeatFrame(t: number): HeatFrame {
  return { t, max: 10_000, bins: [{ side: 'bid', price: 100, notional: 10_000 }] }
}

function makeWall(index: number): WallRecord {
  return {
    key: `bid|${index}`,
    side: 'bid',
    price: 100 + index,
    notional: 100_000,
    history: [{ ts: now, notional: 100_000 }],
    absorbedNotional: 0,
    absorbTs: 0,
    flashTs: now,
    bornTs: now,
    trend: 'STABLE',
  }
}

function makeWallAge(index: number): WallAgeRecord {
  return {
    key: `ask|${index}`,
    side: 'ask',
    price: 100 + index,
    bornTs: now,
    peakNotional: 100_000,
    lastSeenTs: now,
  }
}

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('OrderflowStore', () => {
  it('accepts full depth and checked diffs while rejecting stale generations', () => {
    vi.useFakeTimers()
    const store = new OrderflowStore(clock)
    const generation = store.reset('BTCUSDT', 'futures', '1m')
    store.setTickSize('BTCUSDT', generation, 0.1)
    expect(store.ingestDepthSnapshot('BTCUSDT', generation, {
      bids: new Map([[99.9, 2], [99.8, 3]]),
      asks: new Map([[100.1, 4], [100.2, 5]]),
      lastUpdateId: 10,
      status: 'live',
      updatedAt: now,
    })).toBe(true)
    expect(store.getRawState().bestBid).toBe(99.9)
    expect(store.getRawState().depthActivity?.kind).toBe('snapshot')

    expect(store.ingestDepthDiff('BTCUSDT', generation, {
      bids: [[99.9, 0], [99.7, 1]],
      asks: [[100.1, 6]],
      lastUpdateId: 11,
      updatedAt: now + 10,
    })).toBe(true)
    expect(store.getRawState().bestBid).toBe(99.8)
    expect(store.getRawState().bids.get(99.7)).toBe(1)
    expect(store.getRawState().depthActivity?.kind).toBe('diff')

    const nextGeneration = store.reset('ETHUSDT', 'futures', '5m')
    expect(store.ingestTrade('BTCUSDT', generation, makeTrade(now))).toBe(false)
    expect(store.ingestDepthSnapshot('BTCUSDT', generation, {
      bids: new Map(),
      asks: new Map(),
      lastUpdateId: 1,
      status: 'live',
      updatedAt: now,
    })).toBe(false)
    expect(store.isGenerationCurrent(nextGeneration, 'ETHUSDT')).toBe(true)
  })

  it('bounds trades, liquidations, events, walls, wall ages and heat frames', () => {
    vi.useFakeTimers()
    const store = new OrderflowStore(clock)
    const generation = store.reset('BTCUSDT', 'futures', '1m')
    for (let index = 0; index < 8_050; index += 1) store.ingestTrade('BTCUSDT', generation, makeTrade(now + index))
    for (let index = 0; index < 510; index += 1) {
      store.ingestLiquidation('BTCUSDT', generation, {
        ts: now + index,
        price: 100,
        notional: 50_000,
        side: 'long',
      })
    }
    for (let index = 0; index < 60; index += 1) store.addFlowEvent(makeEvent(index))
    for (let index = 0; index < 950; index += 1) store.pushHeatFrame(makeHeatFrame(2_000 + index))
    store.replaceWalls(Array.from({ length: 25 }, (_, index) => makeWall(index)))
    store.replaceWallAges(Array.from({ length: 2_005 }, (_, index) => makeWallAge(index)))

    const raw = store.getRawState()
    expect(raw.trades.length).toBe(8_000)
    expect(raw.liquidations.length).toBe(500)
    expect(raw.events.length).toBe(40)
    expect(raw.heatFrames.length).toBe(900)
    expect(raw.walls.size).toBe(20)
    expect(raw.wallAges.size).toBe(2_000)

    now += 100
    vi.advanceTimersByTime(100)
    expect(store.getSnapshot().tradeCount).toBe(8_000)
    expect(store.getSnapshot().liquidationCount).toBe(500)
    expect(store.getSnapshot().heatFrameCount).toBe(900)
  })

  it('keeps futures-only fields unavailable in spot fallback', () => {
    vi.useFakeTimers()
    const store = new OrderflowStore(clock)
    const generation = store.reset('BTCUSDT', 'spot-fallback', '1m')
    expect(store.ingestLiquidation('BTCUSDT', generation, {
      ts: now,
      price: 100,
      notional: 10_000,
      side: 'long',
    })).toBe(false)
    expect(store.ingestMark('BTCUSDT', generation, 100, 0.0001, now)).toBe(false)
    expect(store.ingestOpenInterest('BTCUSDT', generation, 1_000_000, 1, now)).toBe(false)
    expect(store.getSnapshot().mode).toBe('spot-fallback')
    expect(store.getSnapshot().funding).toBeNull()
    expect(store.getSnapshot().oi).toBeNull()
  })
})
