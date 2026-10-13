import { describe, expect, it } from 'vitest'
import { interpolateTimeCoordinate } from './timeProjection'

describe('interpolateTimeCoordinate', () => {
  it('projects timestamps between neighboring chart points', () => {
    const points = [
      { time: 1_800_000_000, x: 20 },
      { time: 1_800_000_060, x: 50 },
      { time: 1_800_000_120, x: 80 },
    ]

    expect(interpolateTimeCoordinate(points, 1_800_000_030)).toBe(35)
    expect(interpolateTimeCoordinate(points, 1_800_000_060)).toBe(50)
  })

  it('reprojects against fresh coordinates after pan, zoom, or resize', () => {
    const time = 1_800_000_030
    const before = interpolateTimeCoordinate([
      { time: 1_800_000_000, x: 20 },
      { time: 1_800_000_060, x: 50 },
    ], time)
    const after = interpolateTimeCoordinate([
      { time: 1_800_000_000, x: 110 },
      { time: 1_800_000_060, x: 170 },
    ], time)

    expect(before).toBe(35)
    expect(after).toBe(140)
  })

  it('extrapolates only from the nearest chart edge and handles empty input', () => {
    const points = [
      { time: 100, x: 30 },
      { time: 200, x: 50 },
    ]

    expect(interpolateTimeCoordinate(points, 50)).toBe(20)
    expect(interpolateTimeCoordinate(points, 250)).toBe(60)
    expect(interpolateTimeCoordinate([], 100)).toBeNull()
    expect(interpolateTimeCoordinate(points, Number.NaN)).toBeNull()
  })
})
