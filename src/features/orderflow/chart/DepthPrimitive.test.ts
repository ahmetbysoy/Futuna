import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrderflowStore } from '../orderflowStore'
import type { WallRecord } from '../types'
import { DepthPrimitive } from './DepthPrimitive'

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('DepthPrimitive visibility lifecycle', () => {
  it('pauses live-wall pulse updates while hidden and resumes when visible', () => {
    vi.useFakeTimers()
    let visibilityState: DocumentVisibilityState = 'visible'
    const visibilityListeners = new Set<() => void>()
    const requestUpdate = vi.fn()
    const fakeDocument = {
      get visibilityState() { return visibilityState },
      addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
        if (typeof listener === 'function') visibilityListeners.add(listener as () => void)
      },
      removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
        if (typeof listener === 'function') visibilityListeners.delete(listener as () => void)
      },
    }
    vi.stubGlobal('document', fakeDocument)
    vi.stubGlobal('window', {
      requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 16) as unknown as number,
      cancelAnimationFrame: (timer: number) => clearTimeout(timer),
      setTimeout,
      clearTimeout,
      matchMedia: () => ({ matches: false }),
    })

    const now = Date.now()
    const store = new OrderflowStore({ now: () => now })
    const generation = store.reset('BTCUSDT', 'futures', '1m')
    store.ingestDepthSnapshot('BTCUSDT', generation, {
      bids: new Map([[99, 10]]),
      asks: new Map([[101, 10]]),
      lastUpdateId: 1,
      status: 'live',
      updatedAt: now,
    })
    const wall: WallRecord = {
      key: 'bid|99',
      side: 'bid',
      price: 99,
      notional: 99_000,
      history: [{ ts: now, notional: 99_000 }],
      absorbedNotional: 0,
      absorbTs: 0,
      flashTs: now,
      bornTs: now,
      trend: 'STABLE',
    }
    store.upsertWall(wall)

    const primitive = new DepthPrimitive()
    primitive.attached({ chart: {}, series: {}, requestUpdate } as never)
    primitive.setRawState(store.getRawState())
    vi.advanceTimersByTime(16)
    expect(requestUpdate).toHaveBeenCalledTimes(1)

    visibilityState = 'hidden'
    for (const listener of visibilityListeners) listener()
    vi.advanceTimersByTime(1_000)
    expect(requestUpdate).toHaveBeenCalledTimes(1)

    visibilityState = 'visible'
    for (const listener of visibilityListeners) listener()
    vi.advanceTimersByTime(16)
    expect(requestUpdate).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(300)
    expect(requestUpdate).toHaveBeenCalledTimes(3)

    primitive.detached()
  })
})
