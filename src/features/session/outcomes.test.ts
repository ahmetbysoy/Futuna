import { describe, expect, it } from 'vitest'
import { expectedFlowDirection, measureFlowOutcome } from './outcomes'
import type { FlowEventRecord } from '@/features/orderflow/types'

function event(overrides: Partial<FlowEventRecord> = {}): FlowEventRecord {
  return {
    id: 'flow-1',
    type: 'WHALE',
    sev: 'high',
    text: 'Large trade',
    ts: 1_000,
    side: 'buy',
    price: 100,
    source: 'trade',
    ...overrides,
  }
}

describe('order-flow session outcome measurements', () => {
  it('maps trade, sweep, and liquidation sides to their expected price direction', () => {
    expect(expectedFlowDirection(event({ side: 'buy' }))).toBe('LONG')
    expect(expectedFlowDirection(event({ type: 'SWEEP', side: 'sell' }))).toBe('SHORT')
    expect(expectedFlowDirection(event({ type: 'LIQUIDATION', side: 'long' }))).toBe('SHORT')
    expect(expectedFlowDirection(event({ type: 'LIQUIDATION', side: 'short' }))).toBe('LONG')
    expect(expectedFlowDirection(event({ type: 'WALL_NEW', side: 'bid' }))).toBe('LONG')
    expect(expectedFlowDirection(event({ type: 'WALL_EATEN', side: 'bid' }))).toBe('SHORT')
    expect(expectedFlowDirection(event({ type: 'SPOOF?', side: 'ask' }))).toBe('LONG')
    expect(expectedFlowDirection(event({ type: 'ABSORPTION?', side: 'buy' }))).toBeNull()
  })

  it('reports signed return and direction agreement without inventing missing prices', () => {
    expect(measureFlowOutcome(100, 101.25, 'LONG')).toEqual({ returnPct: 1.25, directionCorrect: true })
    expect(measureFlowOutcome(100, 99, 'LONG')).toEqual({ returnPct: -1, directionCorrect: false })
    expect(measureFlowOutcome(100, 100, 'SHORT')).toEqual({ returnPct: 0, directionCorrect: null })
    expect(measureFlowOutcome(100, null, 'SHORT')).toEqual({ returnPct: null, directionCorrect: null })
  })
})
