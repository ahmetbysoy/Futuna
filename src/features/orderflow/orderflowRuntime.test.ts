import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrderflowRuntime } from './orderflowRuntime'
import { OrderflowStore } from './orderflowStore'
import type { StorageLike } from './engines/flowCalibrator'
import type { OrderflowTrade } from './types'

let now = 10_000
const clock = { now: () => now }

function makeTrade(ts: number, notional = 500_000): OrderflowTrade {
  return { ts, price: 100, notional, side: 'buy' }
}

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('OrderflowRuntime', () => {
  it('connects store trades and depth snapshots to engines without changing the signal engine', () => {
    vi.useFakeTimers()
    const values = new Map<string, string>()
    const storage: StorageLike = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value) },
    }
    const store = new OrderflowStore(clock)
    const runtime = new OrderflowRuntime(store, clock, storage)
    const stop = runtime.start()
    const generation = store.reset('BTCUSDT', 'futures', '1m')

    store.ingestTrade('BTCUSDT', generation, makeTrade(now))
    expect(store.getRawState().events.toArray().map((event) => event.type)).toContain('WHALE')

    store.ingestDepthSnapshot('BTCUSDT', generation, {
      bids: new Map([[99.8, 2_000], [99.7, 1_000]]),
      asks: new Map([[100.2, 2_000], [100.3, 1_000]]),
      lastUpdateId: 20,
      status: 'live',
      updatedAt: now,
    })
    expect(store.getRawState().depthSynced).toBe(true)
    expect(store.getRawState().wallAges.size).toBe(4)
    expect(store.getRawState().walls.size).toBeGreaterThan(0)

    runtime.tick(now + 100)
    expect(store.getRawState().cvd.s10).toBe(500_000)
    expect(store.getRawState().compass.updatedAt).toBe(now + 100)

    const spotGeneration = store.reset('BTCUSDT', 'spot-fallback', '1m')
    expect(store.getRawState().cvd.s10).toBe(0)
    expect(store.ingestLiquidation('BTCUSDT', spotGeneration, {
      ts: now,
      price: 100,
      notional: 50_000,
      side: 'long',
    })).toBe(false)
    stop()
  })
})
