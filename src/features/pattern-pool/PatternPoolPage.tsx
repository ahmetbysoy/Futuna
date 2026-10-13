import { useEffect, useRef, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, DownloadSimple, UploadSimple } from '@phosphor-icons/react'
import { useApp } from '@/app/AppContext'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { useMarket } from '@/features/market/MarketContext'
import { formatDateTime, formatPrice, formatSigned } from '@/lib/format'
import { calculatePatternRows } from './patternEngine'
import type { Timeframe } from '@/features/market/types'

const WINDOWS: Timeframe[] = ['1m', '5m', '15m', '1h']

interface ImportedPattern {
  id: string
  name: string
  samples: number
  wilson: number
  avgReturn: number
  avgMfe: number
  avgMae: number
  grade: string
}

function isImportedPattern(value: unknown): value is ImportedPattern {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return typeof row.id === 'string' && typeof row.name === 'string' && Number.isFinite(row.samples) && Number.isFinite(row.wilson) && Number.isFinite(row.avgReturn) && Number.isFinite(row.avgMfe) && Number.isFinite(row.avgMae) && typeof row.grade === 'string'
}

export function PatternPoolPage() {
  const { symbol, timeframe: activeTimeframe, mode, candles: activeCandles, loadKlines } = useMarket()
  const { settings, showToast } = useApp()
  const [timeframe, setTimeframe] = useState<Timeframe>(activeTimeframe)
  const [minSamples, setMinSamples] = useState(0)
  const [sourceCandles, setSourceCandles] = useState(activeCandles)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState('ema-cross')
  const [importedAt, setImportedAt] = useState<string | null>(null)
  const [importedRows, setImportedRows] = useState<ImportedPattern[]>([])
  const importInputRef = useRef<HTMLInputElement>(null)
  const requestIdRef = useRef(0)

  useEffect(() => {
    if (timeframe === activeTimeframe) return
    const requestId = ++requestIdRef.current
    let active = true
    setLoading(true)
    setError(null)
    loadKlines(symbol, timeframe, 1000)
      .then((history) => { if (active && requestId === requestIdRef.current) setSourceCandles(history) })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Mum verisi alınamadı.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [symbol, timeframe, activeTimeframe, loadKlines])

  useEffect(() => {
    if (timeframe !== activeTimeframe) return
    setSourceCandles(activeCandles)
    setLoading(false)
    setError(null)
  }, [activeCandles, activeTimeframe, timeframe])

  const rows = calculatePatternRows(sourceCandles, settings.feeBps)
  const visibleRows = rows.filter((row) => row.samples >= minSamples)
  const selected = rows.find((row) => row.id === selectedId) ?? rows[0]

  const exportJson = () => {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      symbol,
      timeframe,
      horizon: 10,
      feeBpsPerSide: settings.feeBps,
      note: 'Yerel tarihsel analiz; ileriye dönük performans iddiası değildir.',
      patterns: rows,
    }
    downloadFile(`${symbol}-${timeframe}-desen-analizi.json`, JSON.stringify(payload, null, 2), 'application/json')
    showToast('Desen raporu JSON olarak indirildi.', 'success')
  }

  const importJson = async (file?: File) => {
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text()) as { version?: number; symbol?: string; timeframe?: string; patterns?: unknown[] }
      if (parsed.version !== 1 || !Array.isArray(parsed.patterns)) throw new Error('Dosya formatı tanınmadı.')
      const validRows = parsed.patterns.filter(isImportedPattern)
      if (!validRows.length) throw new Error('Dosyada gösterilebilir desen satırı bulunamadı.')
      setImportedRows(validRows)
      setImportedAt(`${parsed.symbol ?? '—'} · ${parsed.timeframe ?? '—'} · ${validRows.length} desen`)
      showToast('Rapor içe aktarıldı ve mevcut analizden ayrı bir referans tablosu olarak açıldı.', 'success')
    } catch (reason) {
      showToast(reason instanceof Error ? reason.message : 'JSON dosyası okunamadı.', 'error')
    } finally {
      if (importInputRef.current) importInputRef.current.value = ''
    }
  }

  return (
    <div className="page page--pool">
      <div className="page-heading">
        <div><span className="eyebrow">YEREL TARİHSEL ANALİZ</span><h1>Desen havuzu</h1><p>{symbol} · geçmiş mumlarda kural örneklerini ölç.</p></div>
        <div className="page-heading__actions">
          <Button variant="secondary" size="sm" onClick={() => importInputRef.current?.click()}><UploadSimple size={15} aria-hidden="true" />İçe aktar</Button>
          <input ref={importInputRef} type="file" accept="application/json,.json" className="sr-only" aria-label="JSON analiz raporu içe aktar" onChange={(event) => void importJson(event.target.files?.[0])} />
          <Button variant="primary" size="sm" onClick={exportJson} disabled={!rows.length}><DownloadSimple size={15} aria-hidden="true" />JSON indir</Button>
        </div>
      </div>

      <div className="pool-filter-row">
        <div className="field-group"><label htmlFor="pool-timeframe">Zaman aralığı</label><select id="pool-timeframe" value={timeframe} onChange={(event) => setTimeframe(event.target.value as Timeframe)}>{WINDOWS.map((item) => <option key={item} value={item}>{item}</option>)}</select></div>
        <div className="field-group"><label htmlFor="pool-min-samples">En az örnek</label><select id="pool-min-samples" value={minSamples} onChange={(event) => setMinSamples(Number(event.target.value))}><option value={0}>Tüm örnekler</option><option value={5}>5+</option><option value={10}>10+</option><option value={25}>25+</option></select></div>
        <div className="pool-meta"><span>{sourceCandles.length.toLocaleString('tr-TR')} mum</span><span>·</span><span>10 mumluk ileri pencere</span><span>·</span><span>{mode === 'spot-fallback' ? 'Spot veri' : 'Futures veri'}</span></div>
      </div>

      {importedAt && <>
        <div className="notice notice--info" role="status">Referans raporu: {importedAt}. Bu satırlar mevcut sembolün analizine birleştirilmez.</div>
        <Card className="imported-pattern-card">
          <CardHeader><div><span className="eyebrow">YÜKLENEN JSON · AYRI KARŞILAŞTIRMA</span><CardTitle>İçe aktarılan desen özeti</CardTitle></div><Button size="sm" variant="ghost" onClick={() => { setImportedAt(null); setImportedRows([]) }}>Kapat</Button></CardHeader>
          <CardBody><div className="table-scroll"><table className="data-table imported-pattern-table"><caption className="sr-only">İçe aktarılan JSON raporundaki desen metrikleri</caption><thead><tr><th scope="col">Desen</th><th scope="col">Örnek</th><th scope="col">Wilson alt sınır</th><th scope="col">Ort. Ret 10</th><th scope="col">MFE / MAE</th><th scope="col">Durum</th></tr></thead><tbody>{importedRows.map((row) => <tr key={row.id}><th scope="row">{row.name}</th><td>{row.samples}</td><td>{(row.wilson * 100).toFixed(1)}%</td><td className={row.avgReturn >= 0 ? 'tone-positive mono' : 'tone-negative mono'}>{formatSigned(row.avgReturn, '%', 2)}</td><td className="mono">{formatSigned(row.avgMfe, '%', 2)} / {formatSigned(row.avgMae, '%', 2)}</td><td><Badge tone="neutral">{row.grade}</Badge></td></tr>)}</tbody></table></div></CardBody>
        </Card>
      </>}
      {error && <div className="notice notice--error" role="alert">{error}</div>}

      <div className="pool-layout">
        <Card className="pool-table-card">
          <CardHeader><div><span className="eyebrow">İŞLEM MALİYETİ DAHİL</span><CardTitle>Tarihsel örnekler</CardTitle></div><span className="result-count">{visibleRows.length} desen</span></CardHeader>
          <CardBody>
            {loading ? <div className="page-fallback" role="status"><span className="spinner" aria-hidden="true" /> Tarihsel mumlar getiriliyor…</div> : visibleRows.length === 0 ? <EmptyState title="Yeterli örnek yok" description="Seçili zaman aralığında filtre koşulunu karşılayan pattern bulunamadı." /> : (
              <div className="table-scroll"><table className="data-table pattern-table">
                <caption className="sr-only">Geçmiş desen metrikleri; ücret varsayımı her yönde uygulanmıştır</caption>
                <thead><tr><th scope="col">Desen</th><th scope="col">Örnek</th><th scope="col">Wilson alt sınır</th><th scope="col">Ort. Ret 10</th><th scope="col">MFE / MAE</th><th scope="col">Örnek yeterliliği</th></tr></thead>
                <tbody>{visibleRows.map((row) => (
                  <tr key={row.id} className={selected?.id === row.id ? 'is-selected' : ''}>
                    <th scope="row"><button type="button" className="pattern-select" onClick={() => setSelectedId(row.id)} aria-pressed={selected?.id === row.id}>{row.name}<small>{row.description}</small></button></th>
                    <td className="mono">{row.samples}</td>
                    <td className="mono">{(row.wilson * 100).toFixed(1)}%</td>
                    <td className={`mono ${row.avgReturn >= 0 ? 'tone-positive' : 'tone-negative'}`}>{formatSigned(row.avgReturn, '%', 2)}</td>
                    <td className="mono">{formatSigned(row.avgMfe, '%', 2)} <span className="text-muted">/</span> {formatSigned(row.avgMae, '%', 2)}</td>
                    <td><Badge tone={row.grade === 'Yeterli örnek' ? 'positive' : row.grade === 'İzle' ? 'warning' : 'neutral'}>{row.grade}</Badge></td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </CardBody>
        </Card>

        <Card className="pattern-detail-card">
          <CardHeader><div><span className="eyebrow">DESEN DETAYI</span><CardTitle>{selected?.name ?? 'Örnek yok'}</CardTitle></div></CardHeader>
          <CardBody>
            {selected ? <>
              <p className="pattern-detail-description">{selected.description}</p>
              <div className="pattern-kpis">
                <div><span>Örnek</span><strong className="mono">{selected.samples}</strong></div>
                <div><span>Win rate</span><strong className="mono">{(selected.winRate * 100).toFixed(1)}%</strong></div>
                <div><span>Medyan</span><strong className={`mono ${selected.medianReturn >= 0 ? 'tone-positive' : 'tone-negative'}`}>{formatSigned(selected.medianReturn, '%', 2)}</strong></div>
              </div>
              <div className="pattern-sample-list">
                <div className="flow-events__heading"><span>En yeni örnekler</span><span>{selected.events.length} kayıt</span></div>
                {selected.events.length ? <ul>{selected.events.slice(0, 8).map((event, index) => (
                  <li key={`${event.timestamp}-${index}`}>
                    <span className="pattern-sample-dir">{event.direction === 'AL' ? <ArrowUpRight size={14} aria-hidden="true" /> : <ArrowDownRight size={14} aria-hidden="true" />}{event.direction}</span>
                    <span>{formatDateTime(event.timestamp)}<small>Giriş {formatPrice(event.entry)} → çıkış {formatPrice(event.exit)}</small></span>
                    <strong className={`mono ${event.netReturnPct >= 0 ? 'tone-positive' : 'tone-negative'}`}>{formatSigned(event.netReturnPct, '%', 2)}</strong>
                  </li>
                ))}</ul> : <p className="helper-text">Bu desen için ileri dönem örneği yok.</p>}
              </div>
            </> : <EmptyState title="Detay gösterilemiyor" description="Mum verisi geldikten sonra desen seç." />}
          </CardBody>
        </Card>
      </div>

      <div className="notice notice--warning pattern-disclaimer" role="note"><strong>Yorumlama notu</strong><span>Wilson alt sınırı örnek belirsizliğini gösterir. Bu ölçümler tek bir sembolün sınırlı geçmiş verisidir; başarı olasılığı veya gelecek performansı değildir. Ücret varsayımı: {settings.feeBps} bps / yön.</span></div>
    </div>
  )
}

function downloadFile(name: string, body: string, mime: string) {
  const blob = new Blob([body], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}
