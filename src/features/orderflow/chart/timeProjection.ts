export interface TimeCoordinatePoint {
  time: number
  x: number
}

/** Project an exchange timestamp onto the chart's current, index-based time scale. */
export function interpolateTimeCoordinate(points: readonly TimeCoordinatePoint[], time: number): number | null {
  if (!Number.isFinite(time) || points.length === 0) return null
  if (points.length === 1) return Number.isFinite(points[0].x) ? points[0].x : null

  let low = 0
  let high = points.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (points[middle].time < time) low = middle + 1
    else high = middle
  }

  if (low < points.length && points[low].time === time) {
    return Number.isFinite(points[low].x) ? points[low].x : null
  }

  const leftIndex = Math.max(0, Math.min(points.length - 2, low - 1))
  const left = points[leftIndex]
  const right = points[leftIndex + 1]
  const span = right.time - left.time
  if (!Number.isFinite(left.x) || !Number.isFinite(right.x)) return null
  if (!Number.isFinite(span) || span <= 0) return left.x

  const progress = (time - left.time) / span
  return left.x + (right.x - left.x) * progress
}
