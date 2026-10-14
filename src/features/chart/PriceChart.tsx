import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Time,
} from 'lightweight-charts'
import { Pause, Play, ArrowsOutSimple } from '@phosphor-icons/react'
import { Button } from '@/components/ui/Button'
import { formatPrice, formatTime } from '@/lib/format'
import { bollinger, ema, parabolicSar, vwap } from '@/lib/math'
import type { Candle, MarketMode, Timeframe } from '@/features/market/types'
import { orderflowStore } from '@/features/orderflow/orderflowStore'
import { DepthPrimitive, type DepthOverlayOptions } from '@/features/orderflow/chart/DepthPrimitive'
import { flowEventsToMarkers } from '@/features/orderflow/chart/flowMarkers'

export interface PriceChartLifecycle {
  chart: IChartApi
  candleSeries: ISeriesApi<'Candlestick'>
  volumeSeries: ISeriesApi<'Histogram'>
}

interface PriceChartProps {
  candles: Candle[]
  liveCandle: Candle | null
  symbol: string
  timeframe: Timeframe
  marketMode: MarketMode
  theme: 'dark' | 'light'
  showEma: boolean
  showVolume: boolean
  showBollinger: boolean
  showVwap: boolean
  showSar: boolean
  fastEma: number
  slowEma: number
  bbPeriod: number
  bbStd: number
  loading: boolean
  orderflowOverlay?: Partial<DepthOverlayOptions>
  onChartReady?: (lifecycle: PriceChartLifecycle | null) => void
}

const PALETTE = {
  dark: { bg: '#0d1312', panel: '#131b19', text: '#b4c1bb', muted: '#788a82', border: '#26342f', grid: 'rgba(145,164,154,.10)' },
  light: { bg: '#f6f8f7', panel: '#ffffff', text: '#475750', muted: '#75847d', border: '#dfe7e3', grid: 'rgba(49,79,64,.10)' },
}

function formatChartTime(time: Time): string {
  if (typeof time === 'number') return formatTime(time * 1000)
  if (typeof time === 'string') return time
  if (typeof time === 'object' && 'year' in time) {
    const date = new Date(Date.UTC(time.year, time.month - 1, time.day))
    return new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'short' }).format(date)
  }
  return '—'
}

function linePoints(values: number[], candles: Candle[]) {
  const points: Array<{ time: Time; value: number }> = []
  for (let index = 0; index < candles.length; index += 1) {
    if (Number.isFinite(values[index])) points.push({ time: candles[index].time as Time, value: values[index] })
  }
  return points
}

export function PriceChart({ candles, liveCandle, symbol, timeframe, marketMode, theme, showEma, showVolume, showBollinger, showVwap, showSar, fastEma, slowEma, bbPeriod, bbStd, loading, orderflowOverlay, onChartReady }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const depthPrimitiveRef = useRef<DepthPrimitive | null>(null)
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const orderflowRefreshRef = useRef<() => void>(() => undefined)
  const chartCandlesRef = useRef<readonly Candle[]>(candles)
  const symbolRef = useRef(symbol)
  const timeframeRef = useRef(timeframe)
  const marketModeRef = useRef(marketMode)
  const overlayOptionsRef = useRef(orderflowOverlay)
  const onChartReadyRef = useRef(onChartReady)
  const fastSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const slowSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const bbUpperRef = useRef<ISeriesApi<'Line'> | null>(null)
  const bbMiddleRef = useRef<ISeriesApi<'Line'> | null>(null)
  const bbLowerRef = useRef<ISeriesApi<'Line'> | null>(null)
  const vwapSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const sarSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const fittedKeyRef = useRef('')
  const [paused, setPaused] = useState(false)
  const chartCandles = useMemo(() => {
    if (!liveCandle) return candles
    const lastCandle = candles.at(-1)
    return lastCandle?.time === liveCandle.time
      ? [...candles.slice(0, -1), liveCandle]
      : [...candles, liveCandle]
  }, [candles, liveCandle])

  chartCandlesRef.current = chartCandles
  symbolRef.current = symbol
  timeframeRef.current = timeframe
  marketModeRef.current = marketMode
  overlayOptionsRef.current = orderflowOverlay
  onChartReadyRef.current = onChartReady

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const colors = PALETTE[theme]
    const chart = createChart(element, {
      width: Math.max(element.clientWidth, 280),
      height: Math.max(element.clientHeight, 260),
      layout: {
        background: { type: ColorType.Solid, color: colors.bg },
        textColor: colors.text,
        fontFamily: 'Geist Mono, ui-monospace, SFMono-Regular, Consolas, monospace',
        fontSize: 11,
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: colors.grid },
        horzLines: { color: colors.grid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: theme === 'dark' ? '#6b8076' : '#8b9c94', width: 1, style: 3, labelBackgroundColor: '#243b33' },
        horzLine: { color: theme === 'dark' ? '#6b8076' : '#8b9c94', width: 1, style: 3, labelBackgroundColor: '#243b33' },
      },
      rightPriceScale: { borderColor: colors.border, scaleMargins: { top: 0.08, bottom: 0.21 } },
      timeScale: { borderColor: colors.border, timeVisible: true, secondsVisible: false, rightOffset: 5, barSpacing: 7 },
      localization: {
        locale: 'tr-TR',
        priceFormatter: (price: number) => formatPrice(price, 5),
        timeFormatter: (time: Time) => formatChartTime(time),
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    })

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#2db697',
      downColor: '#e76d70',
      borderVisible: false,
      wickUpColor: '#2db697',
      wickDownColor: '#e76d70',
      priceLineVisible: true,
      lastValueVisible: true,
    })
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: 'volume',
      priceFormat: { type: 'volume' },
      lastValueVisible: false,
      priceLineVisible: false,
      base: 0,
    })
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
    const fastSeries = chart.addSeries(LineSeries, { color: '#d7b861', lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false })
    const slowSeries = chart.addSeries(LineSeries, { color: '#6fa7d8', lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false })
    const bbUpper = chart.addSeries(LineSeries, { color: 'rgba(147,164,183,.72)', lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false })
    const bbMiddle = chart.addSeries(LineSeries, { color: 'rgba(147,164,183,.48)', lineWidth: 1, lineStyle: 2, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false })
    const bbLower = chart.addSeries(LineSeries, { color: 'rgba(147,164,183,.72)', lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false })
    const vwapIndicator = chart.addSeries(LineSeries, { color: '#c188d6', lineWidth: 2, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false })
    const sarIndicator = chart.addSeries(LineSeries, { color: '#f3a65b', lineWidth: 1, lineStyle: 2, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false })

    chartRef.current = chart
    candleSeriesRef.current = candleSeries
    volumeSeriesRef.current = volumeSeries
    fastSeriesRef.current = fastSeries
    slowSeriesRef.current = slowSeries
    bbUpperRef.current = bbUpper
    bbMiddleRef.current = bbMiddle
    bbLowerRef.current = bbLower
    vwapSeriesRef.current = vwapIndicator
    sarSeriesRef.current = sarIndicator

    const depthPrimitive = new DepthPrimitive({ ...overlayOptionsRef.current, theme })
    candleSeries.attachPrimitive(depthPrimitive)
    const markersPlugin = createSeriesMarkers(candleSeries, [], { autoScale: false, zOrder: 'aboveSeries' })
    depthPrimitiveRef.current = depthPrimitive
    markersPluginRef.current = markersPlugin
    depthPrimitive.setCandles(chartCandlesRef.current)

    let markerSignature = ''
    const refreshOrderflow = () => {
      const rawState = orderflowStore.getRawState()
      const matchesMarket = rawState.symbol === symbolRef.current
        && rawState.timeframe === timeframeRef.current
        && rawState.mode === marketModeRef.current
      const visibleState = matchesMarket ? rawState : null
      depthPrimitive.setRawState(visibleState)
      const events = visibleState?.events.toArray() ?? []
      const markers = flowEventsToMarkers(
        marketModeRef.current === 'futures' ? events : events.filter((event) => event.type !== 'LIQUIDATION'),
        chartCandlesRef.current,
        timeframeRef.current,
      )
      const nextSignature = markers.map((marker) => `${marker.id}:${marker.time}`).join('|')
      if (nextSignature !== markerSignature) {
        markersPlugin.setMarkers(markers)
        markerSignature = nextSignature
      }
    }
    orderflowRefreshRef.current = refreshOrderflow
    const unsubscribeOrderflow = orderflowStore.subscribeRaw(refreshOrderflow)
    refreshOrderflow()

    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect && rect.width > 0 && rect.height > 0) chart.applyOptions({ width: Math.floor(rect.width), height: Math.floor(rect.height) })
    })
    observer.observe(element)
    onChartReadyRef.current?.({ chart, candleSeries, volumeSeries })

    return () => {
      observer.disconnect()
      unsubscribeOrderflow()
      orderflowRefreshRef.current = () => undefined
      candleSeries.detachPrimitive(depthPrimitive)
      markersPlugin.detach()
      if (depthPrimitiveRef.current === depthPrimitive) depthPrimitiveRef.current = null
      if (markersPluginRef.current === markersPlugin) markersPluginRef.current = null
      onChartReadyRef.current?.(null)
      chart.remove()
      chartRef.current = null
      candleSeriesRef.current = null
      volumeSeriesRef.current = null
      fastSeriesRef.current = null
      slowSeriesRef.current = null
      bbUpperRef.current = null
      bbMiddleRef.current = null
      bbLowerRef.current = null
      vwapSeriesRef.current = null
      sarSeriesRef.current = null
    }
  }, [])

  useEffect(() => {
    const colors = PALETTE[theme]
    chartRef.current?.applyOptions({
      layout: { background: { type: ColorType.Solid, color: colors.bg }, textColor: colors.text },
      grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
      rightPriceScale: { borderColor: colors.border },
      timeScale: { borderColor: colors.border },
    })
    depthPrimitiveRef.current?.setOptions({ theme })
  }, [theme])

  useEffect(() => {
    if (orderflowOverlay) depthPrimitiveRef.current?.setOptions({ ...orderflowOverlay, theme })
  }, [orderflowOverlay, theme])

  useEffect(() => {
    const candleSeries = candleSeriesRef.current
    const volumeSeries = volumeSeriesRef.current
    if (!candleSeries || !volumeSeries || candles.length === 0) return
    candleSeries.setData(candles.map((candle) => ({
      time: candle.time as Time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    })))
    volumeSeries.setData(candles.map((candle) => ({
      time: candle.time as Time,
      value: candle.volume,
      color: candle.close >= candle.open ? 'rgba(45,182,151,.36)' : 'rgba(231,109,112,.36)',
    })))
    const closes = candles.map((candle) => candle.close)
    fastSeriesRef.current?.setData(linePoints(ema(closes, fastEma), candles))
    slowSeriesRef.current?.setData(linePoints(ema(closes, slowEma), candles))
    const bands = bollinger(closes, bbPeriod, bbStd)
    bbUpperRef.current?.setData(linePoints(bands.upper, candles))
    bbMiddleRef.current?.setData(linePoints(bands.middle, candles))
    bbLowerRef.current?.setData(linePoints(bands.lower, candles))
    vwapSeriesRef.current?.setData(linePoints(vwap(candles), candles))
    sarSeriesRef.current?.setData(linePoints(parabolicSar(candles), candles))
    const key = `${symbol}:${timeframe}`
    if (fittedKeyRef.current !== key) {
      chartRef.current?.timeScale().fitContent()
      fittedKeyRef.current = key
    }
  }, [candles, symbol, timeframe, fastEma, slowEma, bbPeriod, bbStd])

  useEffect(() => {
    if (paused || !liveCandle) return
    candleSeriesRef.current?.update({
      time: liveCandle.time as Time,
      open: liveCandle.open,
      high: liveCandle.high,
      low: liveCandle.low,
      close: liveCandle.close,
    })
    volumeSeriesRef.current?.update({
      time: liveCandle.time as Time,
      value: liveCandle.volume,
      color: liveCandle.close >= liveCandle.open ? 'rgba(45,182,151,.36)' : 'rgba(231,109,112,.36)',
    })
    const lastCandle = candles.at(-1)
    const combined = lastCandle?.time === liveCandle.time
      ? [...candles.slice(0, -1), liveCandle]
      : [...candles, liveCandle]
    const closes = combined.map((candle) => candle.close)
    const updateLine = (series: ISeriesApi<'Line'> | null, value: number | undefined) => {
      if (series && value != null && Number.isFinite(value)) series.update({ time: liveCandle.time as Time, value })
    }
    updateLine(fastSeriesRef.current, ema(closes, fastEma).at(-1))
    updateLine(slowSeriesRef.current, ema(closes, slowEma).at(-1))
    const bands = bollinger(closes, bbPeriod, bbStd)
    updateLine(bbUpperRef.current, bands.upper.at(-1))
    updateLine(bbMiddleRef.current, bands.middle.at(-1))
    updateLine(bbLowerRef.current, bands.lower.at(-1))
    updateLine(vwapSeriesRef.current, vwap(combined).at(-1))
    updateLine(sarSeriesRef.current, parabolicSar(combined).at(-1))
  }, [liveCandle, paused, candles, fastEma, slowEma, bbPeriod, bbStd])

  useEffect(() => {
    depthPrimitiveRef.current?.setCandles(chartCandles)
    orderflowRefreshRef.current()
  }, [chartCandles, symbol, timeframe, marketMode])

  useEffect(() => {
    const visible = showEma && candles.length > 0
    fastSeriesRef.current?.applyOptions({ visible })
    slowSeriesRef.current?.applyOptions({ visible })
    bbUpperRef.current?.applyOptions({ visible: showBollinger })
    bbMiddleRef.current?.applyOptions({ visible: showBollinger })
    bbLowerRef.current?.applyOptions({ visible: showBollinger })
    vwapSeriesRef.current?.applyOptions({ visible: showVwap })
    sarSeriesRef.current?.applyOptions({ visible: showSar })
    volumeSeriesRef.current?.applyOptions({ visible: showVolume })
    // Restore vertical room to candles when volume bars are hidden.
    chartRef.current?.priceScale('right').applyOptions({ scaleMargins: { top: 0.08, bottom: showVolume ? 0.21 : 0.07 } })
  }, [showEma, showVolume, showBollinger, showVwap, showSar, candles.length])

  const resetView = () => chartRef.current?.timeScale().fitContent()
  const latest = liveCandle ?? candles.at(-1) ?? null

  return (
    <div className="chart-shell">
      <div className="chart-toolbar">
        <div className="chart-legend" aria-label="Grafik göstergeleri">
          <span className="legend-item"><i className="legend-dot legend-dot--up" aria-hidden="true" />Yükseliş</span>
          <span className="legend-item"><i className="legend-dot legend-dot--down" aria-hidden="true" />Düşüş</span>
          {showEma && <span className="legend-item"><i className="legend-line legend-line--fast" aria-hidden="true" />EMA {fastEma}</span>}
          {showEma && <span className="legend-item"><i className="legend-line legend-line--slow" aria-hidden="true" />EMA {slowEma}</span>}
          {showBollinger && <span className="legend-item"><i className="legend-line legend-line--bb" aria-hidden="true" />BB {bbPeriod}</span>}
          {showVwap && <span className="legend-item"><i className="legend-line legend-line--vwap" aria-hidden="true" />VWAP</span>}
          {showSar && <span className="legend-item"><i className="legend-line legend-line--sar" aria-hidden="true" />SAR</span>}
          {loading && <span className="chart-loading-label" role="status">Mumlar yükleniyor…</span>}
        </div>
        <div className="chart-actions">
          <Button variant="ghost" size="icon" aria-label={paused ? 'Canlı grafiği sürdür' : 'Canlı grafiği duraklat'} aria-pressed={paused} onClick={() => setPaused((value) => !value)}>
            {paused ? <Play size={16} weight="fill" aria-hidden="true" /> : <Pause size={16} weight="fill" aria-hidden="true" />}
          </Button>
          <Button variant="ghost" size="icon" aria-label="Grafiğin tamamını göster" onClick={resetView}>
            <ArrowsOutSimple size={16} aria-hidden="true" />
          </Button>
        </div>
      </div>
      <div className="chart-visual" ref={containerRef} aria-label={`${symbol} ${timeframe} mum grafiği`} role="img" aria-describedby="chart-accessible-summary" />
      <p id="chart-accessible-summary" className="sr-only" aria-live="polite" aria-atomic="true">
        {latest
          ? `${symbol}, ${timeframe}. Son kapanış ${formatPrice(latest.close)}. Açılış ${formatPrice(latest.open)}, en yüksek ${formatPrice(latest.high)}, en düşük ${formatPrice(latest.low)}. ${paused ? 'Grafik akışı duraklatıldı.' : 'Canlı grafik akışı açık.'}`
          : 'Grafik için mum verisi bekleniyor.'}
      </p>
      <details className="chart-data-details">
        <summary>Son mum verisini tablo olarak görüntüle</summary>
        <div className="table-scroll">
          <table className="data-table chart-data-table">
            <caption className="sr-only">{symbol} son mumların OHLCV verisi</caption>
            <thead><tr><th scope="col">Saat</th><th scope="col">Açılış</th><th scope="col">Yüksek</th><th scope="col">Düşük</th><th scope="col">Kapanış</th><th scope="col">Hacim</th></tr></thead>
            <tbody>
              {[...candles.slice(-5)].reverse().map((candle) => (
                <tr key={candle.time}>
                  <th scope="row">{formatTime(candle.time * 1000)}</th>
                  <td>{formatPrice(candle.open)}</td><td>{formatPrice(candle.high)}</td><td>{formatPrice(candle.low)}</td><td>{formatPrice(candle.close)}</td><td>{formatPrice(candle.volume)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <div className="chart-attribution">Grafik altyapısı: <a href="https://www.tradingview.com/lightweight-charts/" target="_blank" rel="noreferrer">TradingView Lightweight Charts</a></div>
    </div>
  )
}
