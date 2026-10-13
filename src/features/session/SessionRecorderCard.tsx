import { useEffect, useState } from 'react'
import { DownloadSimple, Pause, Play, Trash } from '@phosphor-icons/react'
import { useApp } from '@/app/AppContext'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { useMarket } from '@/features/market/MarketContext'
import { formatDateTime, formatPrice } from '@/lib/format'
import { useSessionRecorder, type SessionFormat } from './SessionContext'

export function SessionRecorderCard() {
  const { active, history, startSession, stopSession, downloadReport, clearHistory } = useSessionRecorder()
  const { quote, symbol } = useMarket()
  const { settings, updateSettings, showToast } = useApp()
  const [format, setFormat] = useState<SessionFormat>('md')
  const [includePrompt, setIncludePrompt] = useState(true)
  const [now, setNow] = useState(Date.now())
  const latest = active ?? history[0] ?? null

  useEffect(() => {
    if (!active) { setNow(Date.now()); return }
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [active?.id])

  const elapsed = latest ? Math.max(0, (latest.endedAt ?? now) - latest.startedAt) : 0
  const liveSessionPrice = active && latest?.symbol === symbol ? quote.lastPrice ?? latest.lastPrice : latest?.endPrice ?? latest?.lastPrice
  const netPct = latest?.startPrice && liveSessionPrice != null ? (liveSessionPrice / latest.startPrice - 1) * 100 : null

  const start = () => {
    if (startSession()) return
    showToast('Oturum başlatılamadı. Seçili sembol için fiyat bekleniyor veya kayıt zaten açık.', 'warning')
  }

  return (
    <Card className="session-card">
      <CardHeader className="session-card__header">
        <div><span className="eyebrow">YEREL OLAY KAYDI</span><CardTitle>Oturum kaydedici</CardTitle><p className="card-subtitle">{symbol} fiyat örnekleri, sinyal ve büyük işlem olayları.</p></div>
        {active && <Badge tone="positive"><span className="recording-dot" />Kaydediliyor</Badge>}
      </CardHeader>
      <CardBody>
        <p className="helper-text session-intro">Kayıt tarayıcıda tutulur; dış servise gönderilmez. Tam emir defteri akışı veya kişisel borsa hesabı verisi içermez.</p>
        <div className="session-controls">
          {!active ? <Button variant="primary" onClick={start} disabled={quote.lastPrice == null}><Play size={15} weight="fill" aria-hidden="true" />Kaydı başlat</Button> : <Button variant="danger" onClick={() => stopSession()}><Pause size={15} aria-hidden="true" />Kaydı durdur</Button>}
          <div className="field-group field-group--inline"><label htmlFor="session-max-minutes">En fazla</label><select id="session-max-minutes" value={settings.sessionMaxMinutes} onChange={(event) => updateSettings({ sessionMaxMinutes: Number(event.target.value) })}><option value={5}>5 dakika</option><option value={15}>15 dakika</option><option value={30}>30 dakika</option><option value={60}>1 saat</option></select></div>
          <div className="field-group field-group--inline"><label htmlFor="session-format">İndirme biçimi</label><select id="session-format" value={format} onChange={(event) => setFormat(event.target.value as SessionFormat)}><option value="md">Markdown</option><option value="html">HTML</option><option value="json">JSON</option></select></div>
          <Button variant="secondary" onClick={() => downloadReport(format, includePrompt)} disabled={!latest}><DownloadSimple size={15} aria-hidden="true" />İndir</Button>
        </div>
        <label className="check-line session-prompt-check"><input type="checkbox" checked={includePrompt} onChange={(event) => setIncludePrompt(event.target.checked)} /><span>Raporla birlikte kısa analiz istemi ekle</span></label>
        {latest ? <div className="session-current" role="status" aria-live="polite">
          <div className="session-current__top"><strong>{latest.symbol}</strong><span>{active ? 'Aktif oturum' : 'Son kayıt'}</span></div>
          <div className="session-current__grid"><div><span>Süre</span><strong>{Math.floor(elapsed / 60_000)} dk {Math.floor((elapsed % 60_000) / 1_000)} sn</strong></div><div><span>Olay</span><strong>{latest.events.length}</strong></div><div><span>Fiyat değişimi</span><strong className={netPct == null ? '' : netPct >= 0 ? 'tone-positive' : 'tone-negative'}>{netPct == null ? '—' : `${netPct >= 0 ? '+' : ''}${netPct.toFixed(2)}%`}</strong></div><div><span>Son fiyat</span><strong className="mono">{formatPrice(liveSessionPrice)}</strong></div></div>
          <small>Başlangıç {formatDateTime(latest.startedAt)} · Otomatik süre sınırı {latest.maxMinutes} dk</small>
        </div> : <div className="session-empty">Henüz kayıt yok. Başlatınca 15 saniyede bir fiyat örneği ve yeni sinyal/flow olayları eklenir.</div>}
        {history.length > 0 && <div className="session-history"><div className="session-history__heading"><strong>Önceki oturumlar</strong><Button variant="ghost" size="sm" onClick={() => { if (window.confirm('Oturum geçmişi bu cihazdan silinsin mi?')) { clearHistory(); showToast('Oturum geçmişi silindi.', 'success') } }}><Trash size={14} aria-hidden="true" />Geçmişi sil</Button></div><ul>{history.slice(0, 4).map((item) => <li key={item.id}><span><strong>{item.symbol}</strong><small>{formatDateTime(item.startedAt)} · {item.events.length} olay</small></span><span>{item.endPrice == null ? '—' : formatPrice(item.endPrice)}</span></li>)}</ul></div>}
      </CardBody>
    </Card>
  )
}
