import { beforeEach, describe, expect, it } from 'vitest'
import { FlowCalibrator, type StorageLike } from './flowCalibrator'
import { HeatSampler } from './heatSampler'
import { IcebergDetector, type IcebergContext } from './icebergDetector'
import { MultiCvdEngine } from './multiCvd'
import { computeBookObi, MultiObiEngine } from './multiObi'
import { BoundedQueue } from './queue'
import { SpoofDetector, type SpoofDepthContext } from './spoofDetector'
import { DomSweepDetector, type SweepDepthContext } from './sweepDetector'
import { TradeDetectors } from './tradeDetectors'
import { calculateTrend, WallTracker, type WallTrackerInput } from './wallTracker'
import { CompassEngine } from './compassEngine'
import type { CvdMomentum, OrderflowTrade, WallRecord } from '../types'

let now = 100_000
const clock = { now: () => now }

function trade(ts: number, notional: number, side: OrderflowTrade['side'] = 'buy', price = 100): OrderflowTrade {
  return { ts, price, notional, side }
}

function memoryStorage(): StorageLike & { values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
  }
}

function icebergContext(): IcebergContext {
  return { bestBid: 100, bestAsk: 102, tickSize: 1, depthTickSize: 1, whaleThreshold: 50_000 }
}

function spoofContext(): SpoofDepthContext {
  return {
    bestBid: 99,
    bestAsk: 101,
    previousBestBid: 99,
    previousBestAsk: 101,
    tickSize: 1,
    whaleThreshold: 50_000,
  }
}

function wallInput(nowAt: number, bids: ReadonlyMap<number, number>, asks: ReadonlyMap<number, number>): WallTrackerInput {
  return {
    bids,
    asks,
    bestBid: 100,
    bestAsk: 102,
    tickSize: 1,
    depthTickSize: 1,
    wallMin: 100_000,
    liveWallCount: 5,
    liveWallRange: 2,
    trades: [],
    now: nowAt,
  }
}

const emptyCvd: CvdMomentum = {
  s10: 0,
  s30: 0,
  s60: 0,
  s180: 0,
  direction: 'FLAT',
  accelerating: false,
  allAligned: false,
  score: 0,
}

beforeEach(() => {
  now = 100_000
})

describe('bounded queue', () => {
  it('evicts the oldest item and prunes in insertion order', () => {
    const queue = new BoundedQueue<number>(3)
    queue.push(1)
    queue.push(2)
    queue.push(3)
    expect(queue.push(4)).toBe(1)
    expect(queue.toArray()).toEqual([2, 3, 4])
    expect(queue.pruneWhile((value) => value < 4)).toBe(2)
    expect(queue.toArray()).toEqual([4])
  })
})

describe('flow calibration', () => {
  it('uses a safe cold fallback, then live percentiles and persisted median', () => {
    const storage = memoryStorage()
    const calibrator = new FlowCalibrator(clock, storage)
    calibrator.reset('BTCUSDT', 300_000, now)
    expect(calibrator.threshold()).toBe(300_000)
    expect(calibrator.wallThreshold()).toBe(24_000)
    expect(calibrator.bigThreshold()).toBe(600_000)

    for (let index = 1; index <= 30; index += 1) calibrator.add(index * 1_000, now + index)
    expect(calibrator.isWarm()).toBe(true)
    expect(calibrator.percentile(0.8)).toBe(25_000)
    expect(calibrator.threshold()).toBe(25_000)
    expect(calibrator.wallThreshold()).toBe(16_000)
    expect(calibrator.bigThreshold()).toBe(29_000)
    expect(JSON.parse(storage.values.get('fs_cal_BTCUSDT') ?? '{}').med).toBe(16_000)
  })

  it('loads a recent median seed but ignores stale or malformed storage', () => {
    const storage = memoryStorage()
    storage.setItem('fs_cal_ETHUSDT', JSON.stringify({ med: 12_000, p90: 30_000, ts: now - 1_000 }))
    const calibrator = new FlowCalibrator(clock, storage)
    calibrator.reset('ETHUSDT', 100_000, now)
    expect(calibrator.sampleCount()).toBe(20)
    expect(calibrator.isWarm()).toBe(false)

    storage.setItem('fs_cal_XRPUSDT', '{bad json')
    calibrator.reset('XRPUSDT', 50_000, now)
    expect(calibrator.sampleCount()).toBe(0)
  })

  it('keeps calibrating when browser storage throws on reads and writes', () => {
    const storage: StorageLike = {
      getItem: () => { throw new Error('storage unavailable') },
      setItem: () => { throw new Error('storage quota exceeded') },
    }
    const calibrator = new FlowCalibrator(clock, storage)
    calibrator.reset('BTCUSDT', 50_000, now)
    for (let index = 0; index < 35; index += 1) calibrator.add(10_000 + index * 1_000, now + 60_001 + index)

    expect(calibrator.isWarm()).toBe(true)
    expect(calibrator.sampleCount()).toBe(35)
    expect(calibrator.status().threshold).toBeGreaterThan(0)
  })
})

describe('multi-window CVD and OBI', () => {
  it('tracks signed notional and expires trades independently by window', () => {
    const cvd = new MultiCvdEngine(clock)
    cvd.add(trade(1_000, 10_000, 'buy'), 1_000)
    cvd.add(trade(1_500, 4_000, 'sell'), 1_500)
    expect(cvd.momentum(1_500).s10).toBe(6_000)
    expect(cvd.momentum(1_500).direction).toBe('BULL')
    expect(cvd.momentum(12_000).s10).toBe(0)
    expect(cvd.momentum(12_000).s30).toBe(6_000)
    cvd.reset()
    expect(cvd.momentum(12_000).s180).toBe(0)
  })

  it('computes top-book imbalance and time-windowed alignment', () => {
    const bids = new Map([[100, 10]])
    const asks = new Map([[101, 5]])
    expect(computeBookObi(bids, asks, 1)).toBeCloseTo((1_000 - 505) / 1_505)

    const obi = new MultiObiEngine(clock)
    for (let index = 0; index < 8; index += 1) obi.snapshot(0.5, 10_000 + index * 100)
    const alignment = obi.alignment(10_800)
    expect(alignment.aligned).toBe('BULL')
    expect(alignment.strength).toBeGreaterThan(0.4)
    obi.reset()
    expect(obi.alignment(11_000).aligned).toBe('MIXED')
  })
})

describe('trade flow detectors', () => {
  it('emits whale, sweep and delta-burst drafts and respects cooldowns', () => {
    const detector = new TradeDetectors(clock)
    let ts = 5_000
    const emitted = [] as string[]
    for (let index = 0; index < 4; index += 1) {
      emitted.push(...detector.onTrade(trade(ts, 100_000, 'buy'), 100_000, true, ts).map((event) => event.type))
      ts += 100
    }
    expect(emitted).toContain('WHALE')
    expect(emitted).toContain('SWEEP')
    expect(emitted).toContain('DELTA BURST')

    const followUp: string[] = []
    for (let index = 0; index < 4; index += 1) {
      followUp.push(...detector.onTrade(trade(ts, 100_000, 'buy'), 100_000, true, ts).map((event) => event.type))
      ts += 100
    }
    expect(followUp).not.toContain('SWEEP')
    expect(detector.recent(1_000, ts).length).toBeGreaterThan(0)
  })
})

describe('depth flow detectors', () => {
  it('distinguishes a traded fill from a suspicious near-touch removal', () => {
    const bids = new Map([[99, 1_000]])
    const asks = new Map([[101, 1_000]])
    const filledDetector = new SpoofDetector(clock)
    filledDetector.onSnapshot(bids, asks, 1_000)
    filledDetector.onDepthDiff([[99, 1_200]], [], spoofContext(), 2_000)
    filledDetector.onTrade(trade(2_700, 100_000, 'sell', 99), 2_700)
    const filled = filledDetector.onDepthDiff([[99, 0]], [], spoofContext(), 3_000)
    expect(filled.map((event) => event.type)).toContain('FILLED')

    const spoofDetector = new SpoofDetector(clock)
    spoofDetector.onSnapshot(bids, asks, 1_000)
    spoofDetector.onDepthDiff([[99, 1_200]], [], spoofContext(), 2_000)
    const spoof = spoofDetector.onDepthDiff([[99, 0]], [], spoofContext(), 3_000)
    expect(spoof.map((event) => event.type)).toContain('SPOOF?')
  })

  it('confirms a DOM sweep when a large ask is removed and price advances', () => {
    const detector = new DomSweepDetector(clock)
    const bids = new Map([[99, 10]])
    const asks = new Map([[100, 1_500], [101, 1_000], [102, 1_000]])
    detector.onSnapshot(bids, asks)
    const context: SweepDepthContext = {
      bestBid: 99,
      bestAsk: 101,
      previousBestBid: 99,
      previousBestAsk: 100,
      whaleThreshold: 50_000,
    }
    const events = detector.onDepthDiff([], [[100, 0]], context, 10_000)
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('DOM SWEEP')
    expect(events[0].direction).toBe('LONG')
    expect(detector.recentSweep(15_000, 10_000)?.confidence).toBe('HIGH')
  })

  it('requires repeated replenishment before confirming an iceberg', () => {
    const detector = new IcebergDetector(clock)
    detector.onSnapshot(new Map([[100, 1_000]]), new Map([[102, 1_000]]))
    const context = icebergContext()
    const events = []
    let ts = 1_000
    for (let refill = 0; refill < 3; refill += 1) {
      detector.onDepthDiff([[100, 0]], [], context, ts)
      ts += 100
      events.push(...detector.onDepthDiff([[100, 1_000 + refill * 100]], [], context, ts))
      ts += 100
    }
    expect(events.map((event) => event.type)).toContain('ICEBERG')
    expect(detector.confirmedIcebergs()[0]).toMatchObject({ refills: 3, domCount: 3, tradeCount: 0 })
  })
})

describe('wall tracker and heat sampler', () => {
  it('tracks wall appearance, growth, absorption and trend without unbounded history', () => {
    const tracker = new WallTracker(clock)
    const first = tracker.update(wallInput(1_000, new Map([[100, 2_000]]), new Map([[102, 2_000]])))
    expect(first.walls).toHaveLength(2)
    expect(first.events.map((event) => event.type)).toEqual(['WALL_NEW', 'WALL_NEW'])

    const second = tracker.update(wallInput(1_250, new Map([[100, 3_000]]), new Map([[102, 2_000]])))
    expect(second.events.map((event) => event.type)).toContain('WALL_GROW')
    const bidWall = second.walls.find((wall) => wall.side === 'bid')
    expect(bidWall).toBeDefined()
    if (bidWall) tracker.onTrade(trade(1_300, 25_000, 'sell', 100), 1, 1_300)
    const updatedBidWall = tracker.snapshot().find((wall) => wall.side === 'bid')
    expect(updatedBidWall ? tracker.recentAbsorb(updatedBidWall, 1_300) : 0).toBeGreaterThan(0)

    expect(calculateTrend([
      { ts: 1, notional: 100 },
      { ts: 2, notional: 100 },
      { ts: 3, notional: 200 },
      { ts: 4, notional: 200 },
    ])).toBe('GROWING')
  })

  it('samples a capped, grouped heat frame once per second for a 15-minute horizon', () => {
    const sampler = new HeatSampler()
    const bids = new Map<number, number>()
    const asks = new Map<number, number>()
    for (let index = 1; index <= 400; index += 1) {
      bids.set(100 - index * 0.005, 2_000)
      asks.set(100 + index * 0.005, 2_000)
    }
    const input = { bids, asks, bestBid: 99.995, bestAsk: 100.005, depthTickSize: 0.005 }
    const frame = sampler.sample(input, 1_000)
    expect(frame).not.toBeNull()
    expect(frame?.bins.length).toBeLessThanOrEqual(220)
    expect(frame?.max).toBeGreaterThan(0)
    expect(sampler.sample(input, 1_500)).toBeNull()
    expect(sampler.sample(input, 2_000)).not.toBeNull()
    expect(frame ? sampler.shouldRetain(frame, 16 * 60_000) : true).toBe(false)
  })
})

describe('scalping compass', () => {
  it('keeps an empty book neutral and reads nearby bid-wall pressure independently', () => {
    const engine = new CompassEngine()
    const config = { compassHalf: 10_000 as const, compassIceTick: 15, compassWallTick: 10 }
    const empty = engine.compute({
      now: 10_000,
      depthReady: false,
      bestBid: null,
      bestAsk: null,
      tickSize: 1,
      normalizationNotional: 100_000,
      cvd: emptyCvd,
      events: [],
      walls: [],
      icebergs: [],
      lastSweepTs: null,
      config,
    })
    expect(empty.direction).toBe('FLAT')

    const wall: WallRecord = {
      key: 'bid|100',
      side: 'bid',
      price: 100,
      notional: 300_000,
      history: [{ ts: 9_000, notional: 300_000 }],
      absorbedNotional: 0,
      absorbTs: 0,
      flashTs: 0,
      bornTs: 9_000,
      trend: 'STABLE',
    }
    const scored = engine.compute({
      now: 10_500,
      depthReady: true,
      bestBid: 100,
      bestAsk: 102,
      tickSize: 1,
      normalizationNotional: 100_000,
      cvd: emptyCvd,
      events: [],
      walls: [wall],
      icebergs: [],
      lastSweepTs: null,
      config,
    })
    expect(scored.score).toBeGreaterThan(0)
    expect(scored.direction).toBe('BULL')
    expect(scored.color).toBe('#8b949e')
  })
})
