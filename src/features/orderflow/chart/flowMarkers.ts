import type { SeriesMarker, Time } from 'lightweight-charts'
import type { Candle, Timeframe } from '@/features/market/types'
import type { FlowEventRecord } from '../types'

export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  '1m': 60,
  '5m': 5 * 60,
  '15m': 15 * 60,
  '1h': 60 * 60,
  '4h': 4 * 60 * 60,
}

const EVENT_LABELS: Record<FlowEventRecord['type'], string> = {
  WHALE: 'W',
  SWEEP: 'S',
  'DOM SWEEP': 'DS',
  'ABSORPTION?': 'A?',
  'DELTA BURST': 'Δ',
  'SPOOF?': 'S?',
  FILLED: 'F',
  ICEBERG: 'I',
  LIQUIDATION: 'LQ',
  WALL_NEW: 'WN',
  WALL_GROW: 'WG',
  WALL_EATEN: 'WE',
  WALL_GONE: 'WX',
}

const WALL_EVENTS = new Set<FlowEventRecord['type']>(['WALL_NEW', 'WALL_GROW', 'WALL_EATEN', 'WALL_GONE'])

/** Map bounded detector history to native v5 series markers on actual candle times. */
export function flowEventsToMarkers(
  events: readonly FlowEventRecord[],
  candles: readonly Candle[],
  timeframe: Timeframe,
): SeriesMarker<Time>[] {
  if (events.length === 0 || candles.length === 0) return []
  const interval = TIMEFRAME_SECONDS[timeframe]
  const firstTime = candles[0].time
  const lastTime = candles[candles.length - 1].time
  const visibleEvents: Array<{ event: FlowEventRecord; time: number }> = []

  for (const event of events) {
    const eventTime = timestampSeconds(event.ts)
    if (!Number.isFinite(eventTime)) continue
    if (eventTime < firstTime - interval * 2 || eventTime > lastTime + interval * 2) continue
    const candleTime = candleTimeFor(eventTime, candles, interval)
    if (candleTime != null) visibleEvents.push({ event, time: candleTime })
  }

  visibleEvents.sort((left, right) => left.time - right.time || left.event.ts - right.event.ts)
  return visibleEvents.map(({ event, time }) => markerFor(event, time as Time))
}

function candleTimeFor(eventTime: number, candles: readonly Candle[], interval: number) {
  const bucket = Math.floor(eventTime / interval) * interval
  let low = 0
  let high = candles.length

  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (candles[middle].time < bucket) low = middle + 1
    else high = middle
  }

  if (low < candles.length && candles[low].time === bucket) return candles[low].time
  if (low === 0) return candles[0].time
  if (low === candles.length) return candles[candles.length - 1].time
  return candles[low - 1].time
}

function markerFor(event: FlowEventRecord, time: Time): SeriesMarker<Time> {
  const bullish = isBullish(event)
  const bearish = isBearish(event)
  const position = bullish ? 'belowBar' : 'aboveBar'
  const shape = markerShape(event, bullish, bearish)

  return {
    id: event.id,
    time,
    position,
    shape,
    color: markerColor(event, bullish, bearish),
    text: EVENT_LABELS[event.type],
    size: event.sev === 'high' ? 1.8 : event.sev === 'medium' ? 1.35 : 1,
  }
}

function markerShape(event: FlowEventRecord, bullish: boolean, bearish: boolean): 'circle' | 'square' | 'arrowUp' | 'arrowDown' {
  if (event.type === 'SWEEP' || event.type === 'DOM SWEEP') return bullish ? 'arrowUp' : 'arrowDown'
  if (event.type === 'WHALE' && (bullish || bearish)) return bullish ? 'arrowUp' : 'arrowDown'
  if (event.type === 'LIQUIDATION') return bullish ? 'arrowUp' : 'arrowDown'
  if (event.type === 'ICEBERG' || event.type === 'ABSORPTION?') return 'circle'
  if (event.type === 'DELTA BURST' && (bullish || bearish)) return bullish ? 'arrowUp' : 'arrowDown'
  return WALL_EVENTS.has(event.type) || event.type === 'SPOOF?' ? 'square' : 'circle'
}

function markerColor(event: FlowEventRecord, bullish: boolean, bearish: boolean) {
  if (event.type === 'LIQUIDATION') return bullish ? '#69f0ae' : '#ff8a80'
  if (event.type === 'ICEBERG') return '#c188d6'
  if (event.type === 'SPOOF?') return '#f3a65b'
  if (event.type === 'ABSORPTION?') return '#d7b861'
  if (WALL_EVENTS.has(event.type)) return event.side === 'bid' ? '#2db697' : '#e76d70'
  if (bullish) return '#2db697'
  if (bearish) return '#e76d70'
  return '#93a59a'
}

function isBullish(event: FlowEventRecord) {
  if (event.direction === 'LONG') return true
  if (event.direction === 'SHORT') return false
  if (event.type === 'LIQUIDATION') return event.side === 'short'
  return event.side === 'buy' || event.side === 'bid'
}

function isBearish(event: FlowEventRecord) {
  if (event.direction === 'SHORT') return true
  if (event.direction === 'LONG') return false
  if (event.type === 'LIQUIDATION') return event.side === 'long'
  return event.side === 'sell' || event.side === 'ask'
}

function timestampSeconds(timestamp: number) {
  if (!Number.isFinite(timestamp)) return Number.NaN
  return timestamp > 1_000_000_000_000 ? timestamp / 1_000 : timestamp
}
