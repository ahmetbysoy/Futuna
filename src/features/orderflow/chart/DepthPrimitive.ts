import type { CanvasRenderingTarget2D } from 'fancy-canvas'
import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  PrimitivePaneViewZOrder,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts'
import { formatCompact } from '@/lib/format'
import type { Candle } from '@/features/market/types'
import type { OrderflowRawState } from '../orderflowStore'
import type { HeatmapBin } from '../types'
import { interpolateTimeCoordinate, type TimeCoordinatePoint } from './timeProjection'

const DEPTH_BIN_PX = 3
const HEATMAP_BIN_PX = 4
const WALL_MIN_AGE_MS = 25_000
const MAX_RAY_WALLS = 10
const MAX_LADDER_WIDTH = 96
// Keep the per-chart heatmap raster below roughly 1.5 MB.
const MAX_HEATMAP_RASTER_CELLS = 1_500_000
const PULSE_INTERVAL_MS = 300
const FLASH_DURATION_MS = 2_000
const ABSORB_WINDOW_MS = 4_000

export type LadderSide = 'left' | 'right' | 'both'
export type WallRayLength = 'short' | 'medium' | 'long'

export interface DepthOverlayOptions {
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
  theme: 'dark' | 'light'
}

export const DEFAULT_DEPTH_OVERLAY_OPTIONS: Readonly<DepthOverlayOptions> = Object.freeze({
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
  theme: 'dark',
})

interface DepthRow {
  bid: number
  ask: number
  matureBid: number
  matureAsk: number
}

interface HeatmapRaster {
  key: string
  width: number
  rows: number
  strengths: Uint8Array
}

interface WallRun {
  side: 'bid' | 'ask'
  start: number
  end: number
  y: number
  price: number
  notional: number
  establishedFraction: number
}

interface ActiveRay {
  left: number
  right: number
  side: 'left' | 'right'
}

type PrimitiveLayer = 'heatmap' | 'depth' | 'live-walls'

const PALETTE = {
  dark: {
    bid: '45,182,151',
    ask: '231,109,112',
    mid: 'rgba(228,238,232,.42)',
    spread: 'rgba(76,140,224,.08)',
    text: 'rgba(239,245,241,.94)',
    labelBackground: 'rgba(13,19,18,.88)',
    lastBid: 'rgba(45,182,151,.58)',
    lastAsk: 'rgba(231,109,112,.58)',
  },
  light: {
    bid: '18,130,105',
    ask: '190,54,65',
    mid: 'rgba(36,58,49,.48)',
    spread: 'rgba(49,112,192,.10)',
    text: 'rgba(27,43,35,.94)',
    labelBackground: 'rgba(248,250,249,.92)',
    lastBid: 'rgba(18,130,105,.62)',
    lastAsk: 'rgba(190,54,65,.62)',
  },
} as const

type PrimitivePalette = typeof PALETTE[keyof typeof PALETTE]

/** Lightweight Charts v5 primitive for order-flow layers on the candle pane. */
export class DepthPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null
  private series: ISeriesApi<'Candlestick'> | null = null
  private requestUpdate: (() => void) | null = null
  private rawState: OrderflowRawState | null = null
  private candles: readonly Candle[] = []
  private options: DepthOverlayOptions
  private heatmapRaster: HeatmapRaster | null = null
  private pendingRefresh: number | null = null
  private pulseTimer: ReturnType<typeof setTimeout> | null = null
  private readonly visibilityHandler = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      this.clearPulseTimer()
      return
    }
    this.refreshPulseTimer()
    this.requestChartUpdate()
  }

  private readonly views: readonly IPrimitivePaneView[]

  constructor(options: Partial<DepthOverlayOptions> = {}) {
    this.options = normalizeOptions({ ...DEFAULT_DEPTH_OVERLAY_OPTIONS, ...options })
    this.views = [
      new DepthPaneView(this, 'heatmap', 'bottom'),
      new DepthPaneView(this, 'depth', 'normal'),
      new DepthPaneView(this, 'live-walls', 'top'),
    ]
  }

  paneViews() {
    return this.views
  }

  attached(parameter: SeriesAttachedParameter<Time, 'Candlestick'>) {
    this.chart = parameter.chart as IChartApi
    this.series = parameter.series
    this.requestUpdate = parameter.requestUpdate
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.visibilityHandler)
    this.refreshPulseTimer()
  }

  detached() {
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.visibilityHandler)
    this.clearPulseTimer()
    if (this.pendingRefresh != null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(this.pendingRefresh)
    }
    this.pendingRefresh = null
    this.chart = null
    this.series = null
    this.requestUpdate = null
    this.rawState = null
    this.candles = []
    this.heatmapRaster = null
  }

  updateAllViews() {
    // Coordinates are intentionally resolved from the chart during draw so pan,
    // zoom, price-scale changes, and resize always use the current transform.
  }

  setRawState(rawState: OrderflowRawState | null) {
    this.rawState = rawState
    this.refreshPulseTimer()
    this.scheduleRefresh()
  }

  setCandles(candles: readonly Candle[]) {
    this.candles = candles
    this.heatmapRaster = null
    this.scheduleRefresh()
  }

  setOptions(options: Partial<DepthOverlayOptions>) {
    this.options = normalizeOptions({ ...this.options, ...options })
    this.heatmapRaster = null
    this.refreshPulseTimer()
    this.scheduleRefresh()
  }

  renderLayer(target: CanvasRenderingTarget2D, layer: PrimitiveLayer) {
    const chart = this.chart
    const series = this.series
    const raw = this.rawState
    if (!chart || !series || !raw) return

    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      if (mediaSize.width <= 0 || mediaSize.height <= 0) return
      context.save()
      if (layer === 'heatmap') this.drawHeatmap(context, chart, series, raw, mediaSize.width, mediaSize.height)
      else if (layer === 'depth') this.drawDepthOverlay(context, series, raw, mediaSize.width, mediaSize.height)
      else this.drawLiveWalls(context, series, raw, mediaSize.width, mediaSize.height)
      context.restore()
    })
  }

  private drawHeatmap(
    context: CanvasRenderingContext2D,
    chart: IChartApi,
    series: ISeriesApi<'Candlestick'>,
    raw: OrderflowRawState,
    width: number,
    height: number,
  ) {
    if (!this.options.showHeatmap || !raw.depthSynced || raw.heatFrames.length === 0) {
      if (raw.heatFrames.length === 0) this.heatmapRaster = null
      return
    }

    const rasterWidth = Math.max(1, Math.ceil(width))
    const rasterRows = Math.max(1, Math.ceil(height / HEATMAP_BIN_PX))
    if (rasterWidth * rasterRows * 2 > MAX_HEATMAP_RASTER_CELLS) return

    const lastFrame = raw.heatFrames.last()
    const logicalRange = chart.timeScale().getVisibleLogicalRange()
    const priceRange = series.priceScale().getVisibleRange()
    const rasterKey = [
      raw.generation,
      raw.depthSynced,
      raw.heatFrames.length,
      lastFrame?.t ?? '',
      rasterWidth,
      rasterRows,
      logicalRange?.from ?? '',
      logicalRange?.to ?? '',
      priceRange?.from ?? '',
      priceRange?.to ?? '',
    ].join('|')

    let raster = this.heatmapRaster
    if (!raster || raster.key !== rasterKey) {
      const points = this.timeCoordinatePoints(chart)
      if (points.length === 0) return
      const strengths = new Uint8Array(rasterWidth * rasterRows * 2)
      const yByPrice = new Map<number, number | null>()

      for (const frame of raw.heatFrames) {
        if (!Number.isFinite(frame.max) || frame.max <= 0) continue
        const x = interpolateTimeCoordinate(points, frame.t)
        if (x == null || x < 0 || x >= rasterWidth) continue
        const column = Math.floor(x)

        for (const bin of frame.bins) {
          if (!validHeatBin(bin)) continue
          let y: number | null
          if (yByPrice.has(bin.price)) y = yByPrice.get(bin.price) ?? null
          else {
            y = series.priceToCoordinate(bin.price)
            yByPrice.set(bin.price, y)
          }
          if (y == null || y < 0 || y >= height) continue
          const row = Math.floor(y / HEATMAP_BIN_PX)
          if (row >= rasterRows) continue
          const side = bin.side === 'ask' ? 1 : 0
          const index = (row * rasterWidth + column) * 2 + side
          const strength = Math.max(1, Math.round(clamp(Math.log1p(bin.notional) / Math.log1p(frame.max), 0, 1) * 255))
          if (strength > strengths[index]) strengths[index] = strength
        }
      }

      raster = { key: rasterKey, width: rasterWidth, rows: rasterRows, strengths }
      this.heatmapRaster = raster
    }

    const palette = PALETTE[this.options.theme]
    const baseOpacity = this.options.theme === 'dark' ? 0.045 : 0.055
    const rangeOpacity = this.options.theme === 'dark' ? 0.25 : 0.22
    for (let row = 0; row < raster.rows; row += 1) {
      for (let column = 0; column < raster.width; column += 1) {
        const index = (row * raster.width + column) * 2
        const bid = raster.strengths[index]
        const ask = raster.strengths[index + 1]
        if (bid > 0) {
          const alpha = baseOpacity + (bid / 255) * rangeOpacity
          context.fillStyle = `rgba(${palette.bid},${alpha.toFixed(3)})`
          context.fillRect(column, row * HEATMAP_BIN_PX, 1.15, HEATMAP_BIN_PX)
        }
        if (ask > 0) {
          const alpha = baseOpacity + (ask / 255) * rangeOpacity
          context.fillStyle = `rgba(${palette.ask},${alpha.toFixed(3)})`
          context.fillRect(column, row * HEATMAP_BIN_PX, 1.15, HEATMAP_BIN_PX)
        }
      }
    }
  }

  private drawDepthOverlay(
    context: CanvasRenderingContext2D,
    series: ISeriesApi<'Candlestick'>,
    raw: OrderflowRawState,
    width: number,
    height: number,
  ) {
    if (!raw.depthSynced || !raw.depthReady || width < 8 || height < 1) return
    const rows = this.depthRows(series, raw, height)
    const distribution = rows.map((row) => Math.max(row.bid, row.ask)).filter((value) => value > 0)
    if (distribution.length === 0) return

    const maxNotional = Math.max(...distribution)
    const sorted = [...distribution].sort((left, right) => left - right)
    const percentileIndex = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * this.options.wallPct / 100))
    const wallThreshold = sorted[percentileIndex] ?? maxNotional
    const logMax = Math.log1p(maxNotional)
    const ladderWidth = Math.min(this.options.ladderWidth, MAX_LADDER_WIDTH, width * 0.34)
    const spanRatio = this.options.wallRayLen === 'short' ? 0.12 : this.options.wallRayLen === 'long' ? 0.4 : 0.22
    const raySpan = Math.max(1, Math.round(width * spanRatio))
    const palette = PALETTE[this.options.theme]
    const walls = buildWallRuns(rows, wallThreshold, series)
    const selectedSides = this.options.ladderSide === 'both' ? ['left', 'right'] as const : [this.options.ladderSide] as const
    const activeRays: Partial<Record<'left' | 'right', ActiveRay>> = {}

    for (const side of selectedSides) {
      const geometry = this.rayGeometry(side, width, ladderWidth, raySpan)
      activeRays[side] = geometry
      if (this.options.showLadder && ladderWidth >= 16) {
        this.drawLadder(context, rows, geometry.side, width, ladderWidth, logMax, palette)
      }
      if (this.options.showWallRays) this.drawWallRays(context, walls, geometry, height, logMax, palette)
    }

    const activeRay = this.options.ladderSide === 'left' ? activeRays.left : activeRays.right
    if (activeRay) this.drawPriceGuides(context, series, raw, activeRay, height, palette)
  }

  private drawLadder(
    context: CanvasRenderingContext2D,
    rows: readonly DepthRow[],
    side: 'left' | 'right',
    width: number,
    ladderWidth: number,
    logMax: number,
    palette: PrimitivePalette,
  ) {
    const x = side === 'right' ? width - ladderWidth : 0
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]
      const bidDominates = row.bid >= row.ask
      const notional = bidDominates ? row.bid : row.ask
      if (notional <= 0) continue
      const intensity = clamp(Math.log1p(notional) / logMax, 0, 1)
      const alpha = (0.05 + intensity * 0.55) * this.options.wallOpacity
      const barWidth = Math.min(ladderWidth, ladderWidth * intensity)
      context.fillStyle = `rgba(${bidDominates ? palette.bid : palette.ask},${alpha.toFixed(3)})`
      context.fillRect(side === 'right' ? x : x + ladderWidth - barWidth, index * DEPTH_BIN_PX, barWidth, DEPTH_BIN_PX)
    }
  }

  private drawWallRays(
    context: CanvasRenderingContext2D,
    walls: readonly WallRun[],
    ray: ActiveRay,
    height: number,
    logMax: number,
    palette: PrimitivePalette,
  ) {
    const rayWidth = ray.right - ray.left
    if (rayWidth <= 1) return
    const placedLabels: number[] = []
    const selectedWalls = [...walls].sort((left, right) => right.notional - left.notional).slice(0, MAX_RAY_WALLS)

    for (const wall of selectedWalls) {
      const established = wall.establishedFraction >= 0.5
      if (this.options.wallEstOnly && !established) continue
      if (placedLabels.some((labelY) => Math.abs(labelY - wall.y) < 12)) continue

      const color = wall.side === 'bid' ? palette.bid : palette.ask
      const intensity = clamp(Math.log1p(wall.notional) / logMax, 0, 1)
      const baseAlpha = (established ? 0.38 : 0.18) + intensity * 0.34
      const alpha = clamp(baseAlpha * this.options.wallOpacity, 0, 1)
      const top = wall.start * DEPTH_BIN_PX
      const wallHeight = Math.max(DEPTH_BIN_PX, (wall.end - wall.start + 1) * DEPTH_BIN_PX)
      const gradient = context.createLinearGradient(
        ray.side === 'right' ? ray.left : ray.right,
        wall.y,
        ray.side === 'right' ? ray.right : ray.left,
        wall.y,
      )
      gradient.addColorStop(0, `rgba(${color},0)`)
      gradient.addColorStop(0.55, `rgba(${color},${(alpha * 0.3).toFixed(3)})`)
      gradient.addColorStop(1, `rgba(${color},${alpha.toFixed(3)})`)
      context.fillStyle = gradient
      context.fillRect(ray.left, top, rayWidth, wallHeight)

      if (!this.options.wallLabels || rayWidth < 28) continue
      const label = `${formatCompact(wall.notional)}${established ? ' ⏱' : ''}`
      const labelY = this.drawWallLabel(context, label, wall, ray, height, placedLabels, palette)
      if (labelY != null) placedLabels.push(labelY)
    }
  }

  private drawWallLabel(
    context: CanvasRenderingContext2D,
    label: string,
    wall: WallRun,
    ray: ActiveRay,
    height: number,
    placedLabels: readonly number[],
    palette: PrimitivePalette,
  ) {
    const rightAligned = ray.side === 'right'
    context.save()
    context.font = wall.establishedFraction >= 0.5 ? 'bold 9px ui-monospace, monospace' : '9px ui-monospace, monospace'
    context.textBaseline = 'alphabetic'
    context.textAlign = rightAligned ? 'right' : 'left'
    const textWidth = context.measureText(label).width
    const textX = rightAligned ? ray.right : ray.left
    let baseline = wall.y + 3
    let attempts = 0
    while (attempts < 7 && placedLabels.some((placed) => Math.abs(placed - baseline) < 12)) {
      baseline += 12
      attempts += 1
    }
    if (baseline < 11 || baseline > height - 4) {
      context.restore()
      return null
    }

    const backgroundWidth = Math.min(textWidth + 8, Math.max(0, ray.right - ray.left))
    const backgroundX = rightAligned ? Math.max(ray.left, textX - backgroundWidth) : ray.left
    context.fillStyle = palette.labelBackground
    context.fillRect(backgroundX, baseline - 9, backgroundWidth, 11)
    context.fillStyle = wall.side === 'bid'
      ? this.options.theme === 'dark' ? '#45b697' : '#128269'
      : this.options.theme === 'dark' ? '#e76d70' : '#be3641'
    context.fillText(label, textX, baseline)
    context.restore()
    return baseline
  }

  private drawPriceGuides(
    context: CanvasRenderingContext2D,
    series: ISeriesApi<'Candlestick'>,
    raw: OrderflowRawState,
    ray: ActiveRay,
    height: number,
    palette: PrimitivePalette,
  ) {
    if (raw.bestBid == null || raw.bestAsk == null || raw.bestBid <= 0 || raw.bestAsk <= 0 || raw.bestAsk < raw.bestBid) return
    const mid = (raw.bestBid + raw.bestAsk) / 2
    const bidY = series.priceToCoordinate(raw.bestBid)
    const askY = series.priceToCoordinate(raw.bestAsk)
    const midY = series.priceToCoordinate(mid)

    if (bidY != null && askY != null) {
      context.fillStyle = palette.spread
      context.fillRect(ray.left, Math.min(bidY, askY), Math.max(1, ray.right - ray.left), Math.max(1, Math.abs(bidY - askY)))
    }
    if (midY != null && midY >= 0 && midY <= height) {
      context.save()
      context.setLineDash([5, 5])
      context.strokeStyle = palette.mid
      context.lineWidth = 1
      context.beginPath()
      context.moveTo(ray.left, midY)
      context.lineTo(ray.right, midY)
      context.stroke()
      context.setLineDash([])
      context.font = 'bold 9px ui-monospace, monospace'
      context.textAlign = 'right'
      context.fillStyle = palette.text
      context.fillText('MID', ray.right - 2, clamp(midY - 3, 10, height - 3))
      context.restore()
    }

    const lastTradeIsFresh = raw.lastTrade != null && Date.now() - raw.lastTrade.ts <= 30_000
    const lastPrice = lastTradeIsFresh ? raw.lastTrade?.price : this.candles[this.candles.length - 1]?.close
    if (lastPrice == null || !Number.isFinite(lastPrice) || lastPrice <= 0) return
    const lastY = series.priceToCoordinate(lastPrice)
    if (lastY == null || lastY < 0 || lastY > height) return
    context.save()
    context.setLineDash([2, 4])
    context.strokeStyle = lastPrice >= mid ? palette.lastBid : palette.lastAsk
    context.lineWidth = 1
    context.beginPath()
    context.moveTo(Math.max(ray.left, ray.right - 28), lastY)
    context.lineTo(ray.right, lastY)
    context.stroke()
    context.restore()
  }

  private drawLiveWalls(
    context: CanvasRenderingContext2D,
    series: ISeriesApi<'Candlestick'>,
    raw: OrderflowRawState,
    width: number,
    height: number,
  ) {
    if (!this.options.showLiveWalls || !raw.depthSynced || raw.walls.size === 0) return
    const now = Date.now()
    const motionEnabled = !this.prefersReducedMotion()
    let maximum = 0
    for (const wall of raw.walls.values()) maximum = Math.max(maximum, wall.notional)
    if (maximum <= 0) return

    const placedLabels: number[] = []
    for (const wall of raw.walls.values()) {
      if (!Number.isFinite(wall.price) || wall.price <= 0 || !Number.isFinite(wall.notional) || wall.notional <= 0) continue
      const y = series.priceToCoordinate(wall.price)
      if (y == null || y < 0 || y > height) continue

      const sideColor = wall.side === 'bid'
        ? this.options.theme === 'dark' ? '#2db697' : '#128269'
        : this.options.theme === 'dark' ? '#e76d70' : '#be3641'
      const sideRgb = wall.side === 'bid' ? PALETTE[this.options.theme].bid : PALETTE[this.options.theme].ask
      const strength = clamp(Math.log1p(wall.notional) / Math.log1p(maximum), 0, 1)
      const pulse = this.options.liveWallPulse && motionEnabled ? 0.78 + Math.sin(now / 250) * 0.22 : 1
      const isFlashing = this.options.liveWallFlash && motionEnabled && now - wall.flashTs >= 0 && now - wall.flashTs < FLASH_DURATION_MS
      const flash = isFlashing ? 0.82 + Math.sin(now / 85) * 0.18 : 1
      const alpha = clamp((0.24 + strength * 0.54) * pulse * flash, 0.15, 0.9)
      const lineWidth = wall.trend === 'GROWING' ? 2.6 : wall.trend === 'SHRINKING' ? 1.1 : 1.8
      const gradient = context.createLinearGradient(0, y, width, y)
      gradient.addColorStop(0, 'rgba(0,0,0,0)')
      gradient.addColorStop(0.35, `rgba(${sideRgb},${(alpha * 0.55).toFixed(3)})`)
      gradient.addColorStop(1, `rgba(${sideRgb},${alpha.toFixed(3)})`)
      context.save()
      context.strokeStyle = gradient
      context.lineWidth = lineWidth
      if (wall.trend === 'SHRINKING') context.setLineDash([4, 4])
      context.beginPath()
      context.moveTo(0, y)
      context.lineTo(width, y)
      context.stroke()
      context.restore()

      if (wall.absorbedNotional > 0 && now - wall.absorbTs >= 0 && now - wall.absorbTs < ABSORB_WINDOW_MS) {
        context.save()
        context.fillStyle = sideColor
        context.globalAlpha = motionEnabled
          ? clamp(0.5 + (1 - (now - wall.absorbTs) / ABSORB_WINDOW_MS) * 0.5, 0.5, 1)
          : 0.9
        context.beginPath()
        context.arc(Math.max(8, width - 12), y, 3.4, 0, Math.PI * 2)
        context.fill()
        context.restore()
      }

      if (!this.options.liveWallLabels || width < 72) continue
      const ageSeconds = Math.max(0, Math.floor((now - wall.bornTs) / 1_000))
      const trendMark = wall.trend === 'GROWING' ? '↑' : wall.trend === 'SHRINKING' ? '↓' : '·'
      const label = `${trendMark} ${wall.side === 'bid' ? 'BID' : 'ASK'} ${formatCompact(wall.notional)} · ${ageSeconds}s`
      this.drawLiveWallLabel(context, label, sideColor, y, width, height, placedLabels)
    }
  }

  private drawLiveWallLabel(
    context: CanvasRenderingContext2D,
    label: string,
    color: string,
    y: number,
    width: number,
    height: number,
    placedLabels: number[],
  ) {
    let baseline = y - 5
    let attempts = 0
    while (attempts < 6 && placedLabels.some((placed) => Math.abs(placed - baseline) < 13)) {
      baseline -= 13
      attempts += 1
    }
    baseline = clamp(baseline, 12, height - 3)
    if (placedLabels.some((placed) => Math.abs(placed - baseline) < 11)) return

    context.save()
    context.font = '10px ui-monospace, monospace'
    context.textAlign = 'right'
    context.textBaseline = 'middle'
    const textWidth = context.measureText(label).width
    const right = Math.max(0, width - 7)
    context.fillStyle = PALETTE[this.options.theme].labelBackground
    context.fillRect(Math.max(0, right - textWidth - 7), baseline - 7, Math.min(width, textWidth + 10), 14)
    context.fillStyle = color
    context.fillText(label, right - 4, baseline)
    context.restore()
    placedLabels.push(baseline)
  }

  private depthRows(series: ISeriesApi<'Candlestick'>, raw: OrderflowRawState, height: number): DepthRow[] {
    const rows = Array.from({ length: Math.max(1, Math.ceil(height / DEPTH_BIN_PX)) }, () => ({
      bid: 0,
      ask: 0,
      matureBid: 0,
      matureAsk: 0,
    }))
    const now = Date.now()

    for (const side of ['bid', 'ask'] as const) {
      const book = side === 'bid' ? raw.bids : raw.asks
      for (const [price, quantity] of book) {
        if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(quantity) || quantity <= 0) continue
        const y = series.priceToCoordinate(price)
        if (y == null || y < 0 || y > height) continue
        const index = Math.min(rows.length - 1, Math.max(0, Math.floor(y / DEPTH_BIN_PX)))
        const notional = price * quantity
        const row = rows[index]
        const age = raw.wallAges.get(`${side}|${price}`)
        const mature = age != null && now - age.bornTs >= WALL_MIN_AGE_MS
        if (side === 'bid') {
          row.bid += notional
          if (mature) row.matureBid += notional
        } else {
          row.ask += notional
          if (mature) row.matureAsk += notional
        }
      }
    }
    return rows
  }

  private rayGeometry(side: 'left' | 'right', width: number, ladderWidth: number, raySpan: number): ActiveRay {
    if (side === 'right') {
      const ladderX = Math.max(0, width - ladderWidth)
      const rayRight = Math.max(0, ladderX - 8)
      const span = Math.min(raySpan, rayRight)
      return { left: Math.max(0, rayRight - span), right: rayRight, side }
    }
    const rayLeft = Math.min(width, ladderWidth + 8)
    const rayRight = Math.min(width, rayLeft + raySpan)
    return { left: rayLeft, right: rayRight, side }
  }

  private timeCoordinatePoints(chart: IChartApi): TimeCoordinatePoint[] {
    const timeScale = chart.timeScale()
    const points: TimeCoordinatePoint[] = []
    for (const candle of this.candles) {
      const x = timeScale.timeToCoordinate(candle.time as Time)
      if (x != null && Number.isFinite(x)) points.push({ time: candle.time, x })
    }
    return points
  }

  private scheduleRefresh() {
    if (!this.requestUpdate) return
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      this.requestUpdate()
      return
    }
    if (this.pendingRefresh != null) return
    this.pendingRefresh = window.requestAnimationFrame(() => {
      this.pendingRefresh = null
      this.requestUpdate?.()
    })
  }

  private requestChartUpdate() {
    this.scheduleRefresh()
  }

  private prefersReducedMotion() {
    return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  }

  private refreshPulseTimer() {
    if (this.pulseTimer != null || typeof window === 'undefined') return
    const raw = this.rawState
    if (!raw || !this.options.showLiveWalls || !raw.depthSynced || raw.walls.size === 0) return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return

    const reducedMotion = this.prefersReducedMotion()
    if (reducedMotion) return
    if (!this.options.liveWallPulse) {
      const now = Date.now()
      let hasTransientWall = false
      for (const wall of raw.walls.values()) {
        const flashing = this.options.liveWallFlash && now - wall.flashTs >= 0 && now - wall.flashTs < FLASH_DURATION_MS
        const absorbing = wall.absorbedNotional > 0 && now - wall.absorbTs >= 0 && now - wall.absorbTs < ABSORB_WINDOW_MS
        if (flashing || absorbing) {
          hasTransientWall = true
          break
        }
      }
      if (!hasTransientWall) return
    }

    this.pulseTimer = window.setTimeout(() => {
      this.pulseTimer = null
      this.requestUpdate?.()
      this.refreshPulseTimer()
    }, PULSE_INTERVAL_MS)
  }

  private clearPulseTimer() {
    if (this.pulseTimer != null) clearTimeout(this.pulseTimer)
    this.pulseTimer = null
  }
}

class DepthPaneView implements IPrimitivePaneView {
  private readonly paneRenderer: DepthPaneRenderer

  constructor(
    primitive: DepthPrimitive,
    layer: PrimitiveLayer,
    private readonly order: PrimitivePaneViewZOrder,
  ) {
    this.paneRenderer = new DepthPaneRenderer(primitive, layer)
  }

  zOrder() {
    return this.order
  }

  renderer() {
    return this.paneRenderer
  }
}

class DepthPaneRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly primitive: DepthPrimitive, private readonly layer: PrimitiveLayer) {}

  draw(target: CanvasRenderingTarget2D) {
    this.primitive.renderLayer(target, this.layer)
  }
}

function buildWallRuns(rows: readonly DepthRow[], threshold: number, series: ISeriesApi<'Candlestick'>): WallRun[] {
  const walls: WallRun[] = []
  let index = 0

  while (index < rows.length) {
    const row = rows[index]
    const side = row.bid >= row.ask ? 'bid' : 'ask'
    const value = side === 'bid' ? row.bid : row.ask
    if (value < threshold || value <= 0) {
      index += 1
      continue
    }

    const start = index
    let sum = 0
    let weightedY = 0
    let matureNotional = 0
    while (index < rows.length) {
      const next = rows[index]
      const nextSide = next.bid >= next.ask ? 'bid' : 'ask'
      const notional = nextSide === 'bid' ? next.bid : next.ask
      if (nextSide !== side || notional < threshold || notional <= 0) break
      const y = index * DEPTH_BIN_PX + DEPTH_BIN_PX / 2
      sum += notional
      weightedY += y * notional
      matureNotional += nextSide === 'bid' ? next.matureBid : next.matureAsk
      index += 1
    }

    const y = sum > 0 ? weightedY / sum : start * DEPTH_BIN_PX + DEPTH_BIN_PX / 2
    const price = series.coordinateToPrice(y)
    if (price != null && Number.isFinite(price) && price > 0) {
      walls.push({
        side,
        start,
        end: index - 1,
        y,
        price,
        notional: sum,
        establishedFraction: sum > 0 ? matureNotional / sum : 0,
      })
    }
  }
  return walls
}

function normalizeOptions(options: DepthOverlayOptions): DepthOverlayOptions {
  return {
    showHeatmap: Boolean(options.showHeatmap),
    showLadder: Boolean(options.showLadder),
    showWallRays: Boolean(options.showWallRays),
    showLiveWalls: Boolean(options.showLiveWalls),
    ladderSide: options.ladderSide === 'left' || options.ladderSide === 'both' ? options.ladderSide : 'right',
    ladderWidth: clamp(options.ladderWidth, 16, MAX_LADDER_WIDTH),
    wallRayLen: options.wallRayLen === 'short' || options.wallRayLen === 'long' ? options.wallRayLen : 'medium',
    wallOpacity: clamp(options.wallOpacity, 0.1, 1),
    wallLabels: Boolean(options.wallLabels),
    wallEstOnly: Boolean(options.wallEstOnly),
    wallPct: clamp(options.wallPct, 10, 100),
    liveWallPulse: Boolean(options.liveWallPulse),
    liveWallFlash: Boolean(options.liveWallFlash),
    liveWallLabels: Boolean(options.liveWallLabels),
    theme: options.theme === 'light' ? 'light' : 'dark',
  }
}

function validHeatBin(bin: HeatmapBin): boolean {
  return Number.isFinite(bin.price) && bin.price > 0 && Number.isFinite(bin.notional) && bin.notional > 0
}

function clamp(value: number, min: number, max: number) {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min
}

