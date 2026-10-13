import { describe, expect, it } from 'vitest'
import type { Candle } from '@/features/market/types'
import type { FlowEventRecord } from '../types'
import { flowEventsToMarkers } from './flowMarkers'

const firstCandleTime = 1_800_000_000
const candles: Candle[] = Array.from({ length: 4 }, (_, index) => ({
  time: firstCandleTime + index * 60,
  open: 100 + index,
  high: 103 + index,
  low: 99 + index,
  close: 102 + index,
  volume: 20,
}))

function event(overrides: Partial<FlowEventRecord> = {}): FlowEventRecord {
  return {
    id: 'evt-1',
    type: 'WHALE',
    sev: 'high',
    text: 'Whale buy',
    ts: (firstCandleTime + 60) * 1_000 + 40_000,
    side: 'buy',
    source: 'trade',
    ...overrides,
  }
}

describe('flowEventsToMarkers', () => {
  it('aligns millisecond event timestamps to the corresponding candle open', () => {
    const [marker] = flowEventsToMarkers([event()], candles, '1m')

    expect(marker).toMatchObject({
      id: 'evt-1',
      time: firstCandleTime + 60,
      position: 'belowBar',
      shape: 'arrowUp',
      color: '#2db697',
      text: 'W',
      size: 1.8,
    })
  })

  it('maps liquidations to their forced-close direction', () => {
    const markers = flowEventsToMarkers([
      event({ id: 'short-liq', type: 'LIQUIDATION', side: 'short' }),
      event({ id: 'long-liq', type: 'LIQUIDATION', side: 'long', ts: (firstCandleTime + 61) * 1_000 }),
    ], candles, '1m')
    const shortLiquidation = markers.find((marker) => marker.id === 'short-liq')
    const longLiquidation = markers.find((marker) => marker.id === 'long-liq')

    expect(shortLiquidation).toMatchObject({ position: 'belowBar', shape: 'arrowUp', color: '#69f0ae', text: 'LQ' })
    expect(longLiquidation).toMatchObject({ position: 'aboveBar', shape: 'arrowDown', color: '#ff8a80', text: 'LQ' })
  })

  it('uses the requested candle interval and skips events outside available chart data', () => {
    const fiveMinuteCandles = candles.map((candle, index) => ({ ...candle, time: firstCandleTime + index * 300 }))
    const inside = event({ ts: (firstCandleTime + 300 + 260) * 1_000 })
    const outside = event({ id: 'stale', ts: (firstCandleTime - 900) * 1_000 })
    const markers = flowEventsToMarkers([inside, outside], fiveMinuteCandles, '5m')

    expect(markers).toHaveLength(1)
    expect(markers[0].time).toBe(firstCandleTime + 300)
  })

  it('returns an empty marker list without candle data', () => {
    expect(flowEventsToMarkers([event()], [], '1m')).toEqual([])
    expect(flowEventsToMarkers([], candles, '1m')).toEqual([])
  })
})
