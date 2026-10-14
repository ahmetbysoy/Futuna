import type { FlowEventRecord } from '@/features/orderflow/types'

export const FLOW_OUTCOME_WINDOWS_SECONDS = [10, 30, 60] as const
export type FlowOutcomeDirection = 'LONG' | 'SHORT'

const FLOW_EVENT_TYPES: readonly FlowEventRecord['type'][] = [
  'WHALE', 'SWEEP', 'DOM SWEEP', 'ABSORPTION?', 'DELTA BURST', 'SPOOF?', 'FILLED',
  'ICEBERG', 'LIQUIDATION', 'WALL_NEW', 'WALL_GROW', 'WALL_EATEN', 'WALL_GONE',
]

export function isFlowEventType(value: unknown): value is FlowEventRecord['type'] {
  return typeof value === 'string' && FLOW_EVENT_TYPES.includes(value as FlowEventRecord['type'])
}

export function expectedFlowDirection(event: FlowEventRecord): FlowOutcomeDirection | null {
  if (event.direction) return event.direction
  if (event.type === 'ABSORPTION?') return null
  if (event.type === 'LIQUIDATION') {
    if (event.side === 'long') return 'SHORT'
    if (event.side === 'short') return 'LONG'
    return null
  }
  if (event.type === 'SPOOF?' || event.type === 'WALL_EATEN' || event.type === 'WALL_GONE') {
    if (event.side === 'bid') return 'SHORT'
    if (event.side === 'ask') return 'LONG'
  }
  if (event.side === 'buy' || event.side === 'bid' || event.side === 'long') return 'LONG'
  if (event.side === 'sell' || event.side === 'ask' || event.side === 'short') return 'SHORT'
  return null
}

export function measureFlowOutcome(
  referencePrice: number,
  observedPrice: number | null,
  expectedDirection: FlowOutcomeDirection | null,
) {
  if (!Number.isFinite(referencePrice) || referencePrice <= 0
    || observedPrice == null || !Number.isFinite(observedPrice) || observedPrice <= 0) {
    return { returnPct: null, directionCorrect: null }
  }

  const returnPct = ((observedPrice / referencePrice) - 1) * 100
  const directionCorrect = expectedDirection == null || Math.abs(returnPct) < 0.0001
    ? null
    : expectedDirection === 'LONG' ? returnPct > 0 : returnPct < 0
  return { returnPct: Number(returnPct.toFixed(4)), directionCorrect }
}
