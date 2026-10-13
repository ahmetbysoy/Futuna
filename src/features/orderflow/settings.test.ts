import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ORDERFLOW_SETTINGS,
  ORDERFLOW_PRESETS,
  normalizeOrderflowSettings,
} from './settings'

describe('orderflow settings', () => {
  it('normalizes persisted settings and bounds user-controlled values', () => {
    const settings = normalizeOrderflowSettings({
      presetId: 'unknown',
      showHeatmap: 'false',
      ladderSide: 'diagonal',
      ladderWidth: 500,
      wallOpacity: -4,
      wallPct: 1000,
      whaleMin: 1,
      whaleMinBySymbol: {
        btcusdt: 450_000,
        INVALID_SYMBOL_WITH_DASH: 800_000,
        ETHUSDT: 10,
      },
      compassHalf: 7_000,
    })

    expect(settings.presetId).toBe('balanced')
    expect(settings.showHeatmap).toBe(true)
    expect(settings.ladderSide).toBe('right')
    expect(settings.ladderWidth).toBe(96)
    expect(settings.wallOpacity).toBe(0.1)
    expect(settings.wallPct).toBe(99)
    expect(settings.whaleMin).toBe(5_000)
    expect(settings.whaleMinBySymbol).toEqual({ BTCUSDT: 450_000 })
    expect(settings.compassHalf).toBe(10_000)
  })

  it('provides independent balanced, scalping, and minimal presets', () => {
    expect(ORDERFLOW_PRESETS.balanced.showHeatmap).toBe(true)
    expect(ORDERFLOW_PRESETS.scalping.ladderSide).toBe('both')
    expect(ORDERFLOW_PRESETS.scalping.compassHalf).toBe(5_000)
    expect(ORDERFLOW_PRESETS.minimal.showHeatmap).toBe(false)
    expect(ORDERFLOW_PRESETS.minimal.liveWallPulse).toBe(false)
    expect(DEFAULT_ORDERFLOW_SETTINGS.presetId).toBe('balanced')
  })
})
