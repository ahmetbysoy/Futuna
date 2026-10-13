export type OrderflowPresetId = 'balanced' | 'scalping' | 'minimal'
export type OrderflowPresetState = OrderflowPresetId | 'custom'
export type LadderSide = 'left' | 'right' | 'both'
export type WallRayLength = 'short' | 'medium' | 'long'
export type CompassHalfLife = 5_000 | 10_000 | 20_000 | 30_000

export interface OrderflowSettings {
  presetId: OrderflowPresetState
  showHeatmap: boolean
  showLadder: boolean
  showWallRays: boolean
  showLiveWalls: boolean
  ladderSide: LadderSide
  ladderWidth: number
  wallRayLen: WallRayLength
  wallOpacity: number
  wallLabels: boolean
  wallEstOnly: boolean
  wallPct: number
  liveWallPulse: boolean
  liveWallFlash: boolean
  liveWallLabels: boolean
  whaleMin: number
  whaleMinBySymbol: Record<string, number>
  whaleAlerts: boolean
  liveWallCount: number
  liveWallRange: number
  compassHalf: CompassHalfLife
  compassIceTick: number
  compassWallTick: number
}

export const DEFAULT_ORDERFLOW_SETTINGS: OrderflowSettings = {
  presetId: 'balanced',
  showHeatmap: true,
  showLadder: true,
  showWallRays: true,
  showLiveWalls: true,
  ladderSide: 'right',
  ladderWidth: 48,
  wallRayLen: 'medium',
  wallOpacity: 0.8,
  wallLabels: true,
  wallEstOnly: false,
  wallPct: 90,
  liveWallPulse: true,
  liveWallFlash: true,
  liveWallLabels: true,
  whaleMin: 300_000,
  whaleMinBySymbol: {},
  whaleAlerts: true,
  liveWallCount: 5,
  liveWallRange: 0.5,
  compassHalf: 10_000,
  compassIceTick: 15,
  compassWallTick: 10,
}

export const ORDERFLOW_PRESET_LABELS: Record<OrderflowPresetId, string> = {
  balanced: 'Dengeli',
  scalping: 'Scalping',
  minimal: 'Sade',
}

export const ORDERFLOW_PRESETS: Record<OrderflowPresetId, Partial<OrderflowSettings>> = {
  balanced: {
    presetId: 'balanced',
    showHeatmap: true,
    showLadder: true,
    showWallRays: true,
    showLiveWalls: true,
    ladderSide: 'right',
    ladderWidth: 48,
    wallRayLen: 'medium',
    wallOpacity: 0.8,
    wallLabels: true,
    wallEstOnly: false,
    wallPct: 90,
    liveWallPulse: true,
    liveWallFlash: true,
    liveWallLabels: true,
    liveWallCount: 5,
    liveWallRange: 0.5,
    compassHalf: 10_000,
    compassIceTick: 15,
    compassWallTick: 10,
  },
  scalping: {
    presetId: 'scalping',
    showHeatmap: true,
    showLadder: true,
    showWallRays: true,
    showLiveWalls: true,
    ladderSide: 'both',
    ladderWidth: 60,
    wallRayLen: 'long',
    wallOpacity: 0.9,
    wallLabels: true,
    wallEstOnly: false,
    wallPct: 82,
    liveWallPulse: true,
    liveWallFlash: true,
    liveWallLabels: true,
    liveWallCount: 8,
    liveWallRange: 0.8,
    compassHalf: 5_000,
    compassIceTick: 10,
    compassWallTick: 15,
  },
  minimal: {
    presetId: 'minimal',
    showHeatmap: false,
    showLadder: true,
    showWallRays: true,
    showLiveWalls: true,
    ladderSide: 'right',
    ladderWidth: 38,
    wallRayLen: 'short',
    wallOpacity: 0.58,
    wallLabels: false,
    wallEstOnly: true,
    wallPct: 95,
    liveWallPulse: false,
    liveWallFlash: false,
    liveWallLabels: false,
    liveWallCount: 3,
    liveWallRange: 0.25,
    compassHalf: 30_000,
    compassIceTick: 25,
    compassWallTick: 8,
  },
}

const COMPASS_HALF_LIVES: CompassHalfLife[] = [5_000, 10_000, 20_000, 30_000]
const PRESET_IDS: OrderflowPresetState[] = ['balanced', 'scalping', 'minimal', 'custom']

export function normalizeOrderflowSettings(value: unknown): OrderflowSettings {
  const source = asRecord(value)
  const presetId = PRESET_IDS.includes(source.presetId as OrderflowPresetState)
    ? source.presetId as OrderflowPresetState
    : DEFAULT_ORDERFLOW_SETTINGS.presetId
  const compassHalf = COMPASS_HALF_LIVES.includes(source.compassHalf as CompassHalfLife)
    ? source.compassHalf as CompassHalfLife
    : DEFAULT_ORDERFLOW_SETTINGS.compassHalf
  return {
    presetId,
    showHeatmap: readBoolean(source.showHeatmap, DEFAULT_ORDERFLOW_SETTINGS.showHeatmap),
    showLadder: readBoolean(source.showLadder, DEFAULT_ORDERFLOW_SETTINGS.showLadder),
    showWallRays: readBoolean(source.showWallRays, DEFAULT_ORDERFLOW_SETTINGS.showWallRays),
    showLiveWalls: readBoolean(source.showLiveWalls, DEFAULT_ORDERFLOW_SETTINGS.showLiveWalls),
    ladderSide: source.ladderSide === 'left' || source.ladderSide === 'both' ? source.ladderSide : 'right',
    ladderWidth: clampNumber(source.ladderWidth, DEFAULT_ORDERFLOW_SETTINGS.ladderWidth, 24, 96, true),
    wallRayLen: source.wallRayLen === 'short' || source.wallRayLen === 'long' ? source.wallRayLen : 'medium',
    wallOpacity: clampNumber(source.wallOpacity, DEFAULT_ORDERFLOW_SETTINGS.wallOpacity, 0.1, 1),
    wallLabels: readBoolean(source.wallLabels, DEFAULT_ORDERFLOW_SETTINGS.wallLabels),
    wallEstOnly: readBoolean(source.wallEstOnly, DEFAULT_ORDERFLOW_SETTINGS.wallEstOnly),
    wallPct: clampNumber(source.wallPct, DEFAULT_ORDERFLOW_SETTINGS.wallPct, 60, 99, true),
    liveWallPulse: readBoolean(source.liveWallPulse, DEFAULT_ORDERFLOW_SETTINGS.liveWallPulse),
    liveWallFlash: readBoolean(source.liveWallFlash, DEFAULT_ORDERFLOW_SETTINGS.liveWallFlash),
    liveWallLabels: readBoolean(source.liveWallLabels, DEFAULT_ORDERFLOW_SETTINGS.liveWallLabels),
    whaleMin: clampNumber(source.whaleMin, DEFAULT_ORDERFLOW_SETTINGS.whaleMin, 5_000, 50_000_000, true),
    whaleMinBySymbol: normalizeSymbolThresholds(source.whaleMinBySymbol),
    whaleAlerts: readBoolean(source.whaleAlerts, DEFAULT_ORDERFLOW_SETTINGS.whaleAlerts),
    liveWallCount: clampNumber(source.liveWallCount, DEFAULT_ORDERFLOW_SETTINGS.liveWallCount, 2, 20, true),
    liveWallRange: clampNumber(source.liveWallRange, DEFAULT_ORDERFLOW_SETTINGS.liveWallRange, 0.1, 2),
    compassHalf,
    compassIceTick: clampNumber(source.compassIceTick, DEFAULT_ORDERFLOW_SETTINGS.compassIceTick, 1, 100, true),
    compassWallTick: clampNumber(source.compassWallTick, DEFAULT_ORDERFLOW_SETTINGS.compassWallTick, 1, 100, true),
  }
}

function normalizeSymbolThresholds(value: unknown) {
  const source = asRecord(value)
  const result: Record<string, number> = {}
  for (const [rawSymbol, rawThreshold] of Object.entries(source).slice(0, 250)) {
    const symbol = rawSymbol.trim().toUpperCase()
    if (!/^[A-Z0-9]{2,20}$/.test(symbol)) continue
    const threshold = Number(rawThreshold)
    if (Number.isFinite(threshold) && threshold >= 5_000 && threshold <= 50_000_000) result[symbol] = Math.round(threshold)
  }
  return result
}

function clampNumber(value: unknown, fallback: number, min: number, max: number, integer = false) {
  const number = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : Number.NaN
  if (!Number.isFinite(number)) return fallback
  const clamped = Math.max(min, Math.min(max, number))
  return integer ? Math.round(clamped) : clamped
}

function readBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
