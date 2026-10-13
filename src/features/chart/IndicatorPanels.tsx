import { useMemo } from 'react'
import { formatPrice } from '@/lib/format'
import { macd, rsi } from '@/lib/math'
import type { Candle } from '@/features/market/types'
import type { AppSettings } from '@/app/AppContext'

export function IndicatorPanels({ candles, settings }: { candles: Candle[]; settings: AppSettings }) {
  const closes = useMemo(() => candles.map((candle) => candle.close), [candles])
  const rsiValues = useMemo(() => settings.showRsi ? rsi(closes, settings.rsiPeriod) : [], [closes, settings.rsiPeriod, settings.showRsi])
  const macdValues = useMemo(() => settings.showMacd ? macd(closes, settings.macdFast, settings.macdSlow, settings.macdSignal) : null, [closes, settings.macdFast, settings.macdSlow, settings.macdSignal, settings.showMacd])

  if ((!settings.showRsi && !settings.showMacd) || !candles.length) return null
  const latestRsi = rsiValues.filter(Number.isFinite).at(-1)
  const latestMacd = macdValues?.line.at(-1)
  const latestSignal = macdValues?.signal.at(-1)
  const latestHist = macdValues?.histogram.at(-1)

  return (
    <div className="indicator-panels">
      {settings.showRsi && <section className="indicator-panel" aria-labelledby="rsi-panel-title">
        <div className="indicator-panel__heading"><div><h3 id="rsi-panel-title">RSI <span>{settings.rsiPeriod}</span></h3><small>30 / 70 referans bantları</small></div><strong className={`mono ${latestRsi != null && latestRsi >= 70 ? 'tone-warning' : latestRsi != null && latestRsi <= 30 ? 'tone-warning' : ''}`}>{latestRsi == null ? '—' : latestRsi.toFixed(1)}</strong></div>
        {latestRsi == null ? <p className="helper-text">RSI için daha fazla mum verisi gerekiyor.</p> : <RsiPlot values={rsiValues.slice(-90)} period={settings.rsiPeriod} latest={latestRsi} />}
      </section>}
      {settings.showMacd && <section className="indicator-panel" aria-labelledby="macd-panel-title">
        <div className="indicator-panel__heading"><div><h3 id="macd-panel-title">MACD <span>{settings.macdFast}/{settings.macdSlow}/{settings.macdSignal}</span></h3><small>MACD çizgisi · sinyal · histogram</small></div><div className="macd-values"><span><small>MACD</small><strong className="mono">{latestMacd == null ? '—' : formatPrice(latestMacd, 5)}</strong></span><span><small>Sinyal</small><strong className="mono">{latestSignal == null ? '—' : formatPrice(latestSignal, 5)}</strong></span><span><small>Hist.</small><strong className={`mono ${latestHist == null ? '' : latestHist >= 0 ? 'tone-positive' : 'tone-negative'}`}>{latestHist == null ? '—' : formatPrice(latestHist, 5)}</strong></span></div></div>
        {macdValues && <MacdPlot line={macdValues.line.slice(-90)} signal={macdValues.signal.slice(-90)} histogram={macdValues.histogram.slice(-90)} />}
      </section>}
    </div>
  )
}

function RsiPlot({ values, period, latest }: { values: number[]; period: number; latest: number }) {
  const finite = values.filter(Number.isFinite)
  if (finite.length < 2) return <p className="helper-text">RSI {period} hesaplanıyor.</p>
  const width = 500
  const height = 86
  const top = 10
  const bottom = 76
  const y = (value: number) => bottom - (value / 100) * (bottom - top)
  const path = finite.map((value, index) => `${index ? 'L' : 'M'}${(index / (finite.length - 1)) * width},${y(value)}`).join(' ')
  return <svg className="indicator-plot" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`RSI ${period} son değeri ${latest.toFixed(1)}; 30 ve 70 eşikleri gösteriliyor`}>
    {[30, 50, 70].map((level) => <g key={level}><line x1="30" x2={width} y1={y(level)} y2={y(level)} className={level === 50 ? 'indicator-guide indicator-guide--mid' : 'indicator-guide'} /><text x="3" y={y(level) + 3} className="indicator-label">{level}</text></g>)}
    <path d={path} className="rsi-path" />
  </svg>
}

function MacdPlot({ line, signal, histogram }: { line: number[]; signal: number[]; histogram: number[] }) {
  const width = 500
  const height = 86
  const baseline = 43
  const max = Math.max(1e-12, ...line.map(Math.abs), ...signal.map(Math.abs), ...histogram.map(Math.abs))
  const scale = 34 / max
  const linePath = (values: number[]) => values.map((value, index) => `${index ? 'L' : 'M'}${(index / Math.max(1, values.length - 1)) * width},${baseline - value * scale}`).join(' ')
  const barWidth = width / Math.max(1, histogram.length)
  return <svg className="indicator-plot" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="MACD çizgisi, sinyal çizgisi ve histogram; son değerler üstte yazılı">
    <line x1="0" x2={width} y1={baseline} y2={baseline} className="indicator-guide indicator-guide--mid" />
    {histogram.map((value, index) => {
      const barHeight = Math.max(1, Math.abs(value * scale))
      return <rect key={index} x={index * barWidth} y={value >= 0 ? baseline - barHeight : baseline} width={Math.max(1, barWidth - 1)} height={barHeight} className={value >= 0 ? 'macd-bar macd-bar--positive' : 'macd-bar macd-bar--negative'} />
    })}
    <path d={linePath(line)} className="macd-path" />
    <path d={linePath(signal)} className="macd-path macd-path--signal" />
  </svg>
}
