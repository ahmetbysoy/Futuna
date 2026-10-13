import { useMemo, useRef, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, MagnifyingGlass, Play, WarningCircle } from '@phosphor-icons/react'
import { useApp } from '@/app/AppContext'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { useMarket } from '@/features/market/MarketContext'
import { formatCompact, formatPrice, formatSigned } from '@/lib/format'
import { pickCandidates, scanMarkets, type ScanResult } from './scannerEngine'

type ListChoice = 'favorites' | 'top20' | 'top50'
type DirectionFilter = 'all' | 'AL' | 'SAT'

export function ScannerPage() {
  const { symbols, mode, loadTickers, loadKlines, setSymbol } = useMarket()
  const { favorites, settings, setActiveView, showToast, updateSettings, addRecent } = useApp()
  const [list, setList] = useState<ListChoice>(settings.scannerLimit === 50 ? 'top50' : 'top20')
  const [timeframe, setTimeframe] = useState<'1m' | '5m'>('5m')
  const [filter, setFilter] = useState<DirectionFilter>('all')
  const [results, setResults] = useState<ScanResult[]>([])
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState({ complete: 0, total: 0, current: '' })
  const [error, setError] = useState<string | null>(null)
  const runIdRef = useRef(0)
  const symbolSet = useMemo(() => new Set(symbols.map((item) => item.symbol)), [symbols])
  const visibleResults = results.filter((result) => filter === 'all' || result.direction === filter)

  const run = async () => {
    const runId = ++runIdRef.current
    setRunning(true)
    setError(null)
    setResults([])
    setProgress({ complete: 0, total: 0, current: '' })
    try {
      const tickers = await loadTickers()
      if (runId !== runIdRef.current) return
      const candidates = pickCandidates(tickers, symbolSet, list, favorites)
      if (!candidates.length) {
        setError(list === 'favorites' ? 'Favorilerinde taranabilir sembol yok. Önce birkaç USDT paritesi ekle.' : 'Bu veri kaynağında taranabilir USDT sembolü bulunamadı.')
        return
      }
      setProgress({ complete: 0, total: candidates.length, current: '' })
      const scanned = await scanMarkets(
        candidates,
        (target) => loadKlines(target, timeframe, 120),
        settings,
        (complete, total, current) => {
          if (runId === runIdRef.current) setProgress({ complete, total, current })
        },
      )
      if (runId !== runIdRef.current) return
      setResults(scanned)
      showToast(`${scanned.length} sembol tarandı.`, 'success')
    } catch (scanError) {
      if (runId === runIdRef.current) setError(scanError instanceof Error ? scanError.message : 'Tarama tamamlanamadı.')
    } finally {
      if (runId === runIdRef.current) setRunning(false)
    }
  }

  const changeList = (value: ListChoice) => {
    setList(value)
    if (value === 'top20' || value === 'top50') updateSettings({ scannerLimit: value === 'top20' ? 20 : 50 })
  }

  const openSymbol = (target: string) => {
    setSymbol(target)
    addRecent(target)
    setActiveView('dashboard')
  }

  return (
    <div className="page page--scanner">
      <div className="page-heading">
        <div><span className="eyebrow">ÇOKLU SEMBOL ANALİZİ</span><h1>Piyasa tarayıcı</h1><p>Likiditeye göre seçilen USDT piyasalarında aynı kural setini karşılaştır.</p></div>
        <Badge tone={mode === 'futures' ? 'accent' : 'warning'}>{mode === 'futures' ? 'Futures verisi' : mode === 'spot-fallback' ? 'Spot veri' : 'Veri bekleniyor'}</Badge>
      </div>

      <Card className="scanner-controls-card">
        <CardHeader><div><span className="eyebrow">TARAMA PARAMETRELERİ</span><CardTitle>Evreni ve zaman aralığını seç</CardTitle></div></CardHeader>
        <CardBody>
          <div className="scanner-controls">
            <div className="field-group"><label htmlFor="scanner-list">Sembol evreni</label><select id="scanner-list" value={list} onChange={(event) => changeList(event.target.value as ListChoice)}><option value="favorites">Favorilerim</option><option value="top20">Top 20 hacim</option><option value="top50">Top 50 hacim</option></select></div>
            <div className="field-group"><label htmlFor="scanner-timeframe">Zaman aralığı</label><select id="scanner-timeframe" value={timeframe} onChange={(event) => setTimeframe(event.target.value as '1m' | '5m')}><option value="1m">1 dakika</option><option value="5m">5 dakika</option></select></div>
            <div className="field-group"><label htmlFor="scanner-filter">Sonuç yönü</label><select id="scanner-filter" value={filter} onChange={(event) => setFilter(event.target.value as DirectionFilter)}><option value="all">Tüm yönler</option><option value="AL">Sadece AL</option><option value="SAT">Sadece SAT</option></select></div>
            <div className="scanner-run-wrap"><span className="field-label-spacer" aria-hidden="true">&nbsp;</span><Button variant="primary" onClick={run} disabled={running || mode === 'offline'}><Play size={16} weight="fill" aria-hidden="true" />{running ? 'Taranıyor…' : 'Taramayı başlat'}</Button></div>
          </div>
          {running && <div className="scanner-progress" role="status" aria-live="polite"><span className="spinner" aria-hidden="true" /> {progress.complete}/{progress.total || '…'} tamamlandı{progress.current ? ` · ${progress.current}` : ''}<div className="progress-track"><span style={{ width: `${progress.total ? progress.complete / progress.total * 100 : 8}%` }} /></div></div>}
          <p className="helper-text">Top-50 taraması daha fazla istek ve süre kullanır. Veriler seçili piyasa kaynağının 24 saatlik quote hacmine göre sıralanır.</p>
        </CardBody>
      </Card>

      {error && <div className="notice notice--warning" role="status"><WarningCircle size={18} aria-hidden="true" /><span>{error}</span>{list === 'favorites' && <Button size="sm" variant="ghost" onClick={() => setActiveView('favorites')}>Favorilere git</Button>}</div>}
      <Card className="scanner-results-card">
        <CardHeader className="scanner-results-header"><div><span className="eyebrow">KURAL SETİ: EMA + RSI + MOMENTUM</span><CardTitle>Tarama sonuçları</CardTitle></div><span className="result-count">{visibleResults.length} / {results.length} sonuç</span></CardHeader>
        <CardBody>
          {visibleResults.length === 0 ? <EmptyState icon={<MagnifyingGlass size={22} />} title={running ? 'Semboller sırayla inceleniyor' : 'Henüz tarama yok'} description={running ? 'Her sembol için sınırlı sayıda gerçek mum verisi okunuyor.' : 'Evreni seçip taramayı başlat. Filtre sonuçları geldikten sonra uygulanır.'} /> : (
            <div className="table-scroll"><table className="data-table scanner-table">
              <caption className="sr-only">Tarama sonuçları, kurala göre sıralanmıştır</caption>
              <thead><tr><th scope="col">Sembol</th><th scope="col">Son fiyat</th><th scope="col">24s</th><th scope="col">Hacim</th><th scope="col">Trend</th><th scope="col">RSI</th><th scope="col">Yön</th><th scope="col">Katman uyumu</th></tr></thead>
              <tbody>{visibleResults.map((result) => (
                <tr key={result.symbol}>
                  <th scope="row"><button type="button" className="table-link" onClick={() => openSymbol(result.symbol)}>{result.symbol}</button></th>
                  <td className="mono">{formatPrice(result.price)}</td>
                  <td className={result.change24h >= 0 ? 'tone-positive mono' : 'tone-negative mono'}>{result.change24h >= 0 ? <ArrowUpRight size={13} aria-hidden="true" /> : <ArrowDownRight size={13} aria-hidden="true" />}{formatSigned(result.change24h)}</td>
                  <td className="mono">{formatCompact(result.quoteVolume)}</td>
                  <td><span className={`trend-label trend-label--${result.trend === 'Yukarı' ? 'up' : result.trend === 'Aşağı' ? 'down' : 'flat'}`}>{result.trend}</span></td>
                  <td className="mono">{result.rsi == null ? '—' : result.rsi.toFixed(1)}</td>
                  <td><Badge tone={result.direction === 'AL' ? 'positive' : result.direction === 'SAT' ? 'negative' : 'neutral'}>{result.direction}</Badge></td>
                  <td><div className="score-cell"><span className="score-mini-track"><i style={{ width: `${result.alignment}%` }} /></span><strong className="mono">{result.alignment}</strong></div></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </CardBody>
      </Card>
      <p className="disclaimer">Tarayıcı sadece seçili teknik kuralları karşılaştırır. Sonuçlar emir sinyali veya yatırım tavsiyesi değildir.</p>
    </div>
  )
}
