import { useState } from 'react'
import { Play, WarningCircle } from '@phosphor-icons/react'
import { useApp } from '@/app/AppContext'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { useMarket } from '@/features/market/MarketContext'
import { formatDateTime, formatPrice, formatSigned } from '@/lib/format'
import { runWalkForward, type WalkForwardResult } from './walkForwardEngine'

export function BacktestPage() {
  const { symbol, mode, loadKlines } = useMarket()
  const { settings, showToast } = useApp()
  const [timeframe, setTimeframe] = useState<'1m' | '5m'>('5m')
  const [windowSize, setWindowSize] = useState(500)
  const [result, setResult] = useState<WalkForwardResult | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setRunning(true)
    setError(null)
    try {
      const candles = await loadKlines(symbol, timeframe, windowSize)
      if (candles.length < 150) throw new Error('Walk-forward için en az 150 mum gerekiyor. Daha uzun bir zaman aralığı seç veya daha sonra tekrar dene.')
      const output = runWalkForward(candles, timeframe, settings.feeBps, settings.rsiPeriod)
      setResult(output)
      showToast('Walk-forward değerlendirmesi tamamlandı.', 'success')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Backtest çalıştırılamadı.')
      setResult(null)
    } finally {
      setRunning(false)
    }
  }

  const metrics = result?.oosMetrics
  const returnTone = metrics ? metrics.netPnl >= 0 ? 'tone-positive' : 'tone-negative' : ''

  return (
    <div className="page page--backtest">
      <div className="page-heading">
        <div><span className="eyebrow">STRATEJİ DEĞERLENDİRME</span><h1>Walk-forward backtest</h1><p>Parametreleri geçmiş pencerelerde seç, sonraki pencerelerde sınayıp raporla.</p></div>
        <Badge tone={mode === 'futures' ? 'accent' : 'warning'}>{mode === 'futures' ? 'Futures candles' : 'Spot candles'}</Badge>
      </div>

      <Card className="backtest-controls-card">
        <CardHeader><div><span className="eyebrow">TEST KONFİGÜRASYONU</span><CardTitle>{symbol} üzerinde değerlendirme</CardTitle></div></CardHeader>
        <CardBody>
          <div className="backtest-controls">
            <div className="field-group"><label htmlFor="backtest-timeframe">Zaman aralığı</label><select id="backtest-timeframe" value={timeframe} onChange={(event) => setTimeframe(event.target.value as '1m' | '5m')}><option value="1m">1 dakika</option><option value="5m">5 dakika</option></select></div>
            <div className="field-group"><label htmlFor="backtest-window">Toplam mum</label><select id="backtest-window" value={windowSize} onChange={(event) => setWindowSize(Number(event.target.value))}><option value={300}>300 mum</option><option value={500}>500 mum</option><option value={700}>700 mum</option><option value={1000}>1.000 mum</option></select></div>
            <div className="backtest-fees"><span>Ücret varsayımı</span><strong className="mono">{settings.feeBps} bps / yön</strong><small>Her giriş ve çıkıştan düşülür.</small></div>
            <Button variant="primary" onClick={run} disabled={running || mode === 'offline'}><Play size={16} weight="fill" aria-hidden="true" />{running ? 'Hesaplanıyor…' : 'Backtest çalıştır'}</Button>
          </div>
          <p className="helper-text">Strateji: EMA kesişimi + RSI orta çizgisi. Parametreler yalnızca önceki eğitim penceresinde seçilir; emir, kaldıraç veya gerçek hesap kullanılmaz.</p>
        </CardBody>
      </Card>

      {error && <div className="notice notice--error" role="alert"><WarningCircle size={18} aria-hidden="true" />{error}</div>}
      {result && metrics ? <>
        <section className="backtest-summary" aria-label="Dış örnek performans özeti">
          <Metric label="Dış örnek işlemi" value={String(metrics.trades)} detail={`${result.candlesUsed} mum · ${result.folds.length} pencere`} />
          <Metric label="Dış örnek win rate" value={`${(metrics.winRate * 100).toFixed(1)}%`} detail={`${metrics.wins} kazanan işlem`} />
          <Metric label="Net bileşik PnL" value={formatSigned(metrics.netPnl, '%', 2)} detail="Ücretler düşüldü" className={returnTone} />
          <Metric label="Profit factor" value={metrics.profitFactor == null ? '∞*' : metrics.profitFactor.toFixed(2)} detail="Kazanç / kayıp" />
          <Metric label="En yüksek düşüş" value={`−${metrics.maxDrawdown.toFixed(2)}%`} detail="Dış örnek equity" className="tone-negative" />
          <Metric label="Ortalama R" value={metrics.avgR == null ? '—' : `${metrics.avgR.toFixed(2)}R`} detail="Kazanan / kaybeden ort." />
        </section>

        <Card className="equity-card">
          <CardHeader><div><span className="eyebrow">OUT-OF-SAMPLE</span><CardTitle>Equity sırası</CardTitle></div><span className="helper-text">Başlangıç endeksi 100</span></CardHeader>
          <CardBody>
            {metrics.equity.length > 1 ? <div className="equity-chart" role="img" aria-label={`Equity başlangıç 100, bitiş ${metrics.equity.at(-1)?.toFixed(2) ?? '100'}`}>
              {metrics.equity.slice(1).map((value, index, series) => {
                const minimum = Math.min(100, ...series)
                const maximum = Math.max(100, ...series)
                const range = Math.max(maximum - minimum, 0.01)
                const height = 12 + ((value - minimum) / range) * 76
                return <span key={index} className={value >= 100 ? 'equity-bar equity-bar--up' : 'equity-bar equity-bar--down'} style={{ height: `${height}%` }} title={`İşlem ${index + 1}: ${value.toFixed(2)}`} />
              })}
              <div className="equity-chart__baseline" />
            </div> : <EmptyState title="Dış örnek işlem oluşmadı" description="Seçili pencerede kurallar işlem tetiklemedi; daha fazla mumla tekrar deneyebilirsin." />}
          </CardBody>
        </Card>

        <Card className="walkforward-card">
          <CardHeader><div><span className="eyebrow">GENİŞLEYEN EĞİTİM PENCERELERİ</span><CardTitle>Pencere ayrıntıları</CardTitle></div></CardHeader>
          <CardBody>
            <div className="table-scroll"><table className="data-table walkforward-table">
              <caption className="sr-only">Her eğitim penceresinde seçilen EMA parametreleri ve sonraki dış örnek sonucu</caption>
              <thead><tr><th scope="col">Pencere</th><th scope="col">Eğitim aralığı</th><th scope="col">OOS aralığı</th><th scope="col">Seçilen EMA</th><th scope="col">İşlem</th><th scope="col">Win rate</th><th scope="col">Net PnL</th></tr></thead>
              <tbody>{result.folds.map((fold) => (
                <tr key={fold.index}><th scope="row">WF-{fold.index}</th><td>{fold.trainEnd + 1} mum</td><td>{fold.testEnd - fold.testStart + 1} mum</td><td className="mono">{fold.params.fast}/{fold.params.slow}</td><td>{fold.outSample.trades}</td><td>{(fold.outSample.winRate * 100).toFixed(1)}%</td><td className={fold.outSample.netPnl >= 0 ? 'tone-positive mono' : 'tone-negative mono'}>{formatSigned(fold.outSample.netPnl, '%', 2)}</td></tr>
              ))}</tbody>
            </table></div>
          </CardBody>
        </Card>

        <Card className="backtest-trades-card">
          <CardHeader><div><span className="eyebrow">SONUÇ KAYITLARI</span><CardTitle>Dış örnek işlemleri</CardTitle></div><span className="result-count">{result.oosTrades.length} işlem</span></CardHeader>
          <CardBody>
            {result.oosTrades.length === 0 ? <EmptyState title="İşlem yok" description="Bu kurallar dış örnek pencerelerinde sinyal üretmedi." /> : <div className="table-scroll"><table className="data-table trades-table">
              <caption className="sr-only">Simüle edilen dış örnek işlemler ve ücret sonrası sonuçlar</caption>
              <thead><tr><th scope="col">Yön</th><th scope="col">Giriş</th><th scope="col">Çıkış</th><th scope="col">Giriş fiyatı</th><th scope="col">Çıkış fiyatı</th><th scope="col">Net sonuç</th><th scope="col">Mum</th></tr></thead>
              <tbody>{result.oosTrades.slice(-30).reverse().map((trade, index) => (
                <tr key={`${trade.entryTime}-${index}`}><th scope="row"><Badge tone={trade.direction === 'AL' ? 'positive' : 'negative'}>{trade.direction}</Badge></th><td>{formatDateTime(trade.entryTime)}</td><td>{formatDateTime(trade.exitTime)}</td><td className="mono">{formatPrice(trade.entryPrice)}</td><td className="mono">{formatPrice(trade.exitPrice)}</td><td className={trade.netPnlPct >= 0 ? 'tone-positive mono' : 'tone-negative mono'}>{formatSigned(trade.netPnlPct, '%', 2)}</td><td>{trade.barsHeld}</td></tr>
              ))}</tbody>
            </table></div>}
          </CardBody>
        </Card>
      </> : <Card className="backtest-empty-card"><EmptyState title="Backtest için hazır" description="Sembol, aralık ve pencereyi seçip çalıştır. Sonuçlar yeni dış örnek hesaplanana kadar burada gösterilmez." /></Card>}
      <p className="disclaimer">* Kayıp görülmeyen örneklerde profit factor matematiksel olarak sonsuz olabilir; bu sıfır risk anlamına gelmez. Backtest ücret, slippage, fonlama, likidite ve emir gerçekleşme etkilerini tam modellemez.</p>
    </div>
  )
}

function Metric({ label, value, detail, className = '' }: { label: string; value: string; detail: string; className?: string }) {
  return <div className="backtest-metric"><span>{label}</span><strong className={`mono ${className}`}>{value}</strong><small>{detail}</small></div>
}
