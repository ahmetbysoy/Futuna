import { ArrowsLeftRight, Drop, Fire, Waves } from '@phosphor-icons/react'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { formatCompact, formatPrice, formatSigned, formatTime } from '@/lib/format'
import { useMarket } from '@/features/market/MarketContext'

function FlowMetric({ label, value, detail, tone = 'neutral' }: { label: string; value: string; detail: string; tone?: 'positive' | 'negative' | 'neutral' | 'warning' }) {
  return <div className="flow-metric"><span>{label}</span><strong className={`tone-${tone} mono`}>{value}</strong><small>{detail}</small></div>
}

export function FlowPanel({ compact = false }: { compact?: boolean }) {
  const { flow, mode } = useMarket()
  const cvdTone = flow.cvd60 > 0 ? 'positive' : flow.cvd60 < 0 ? 'negative' : 'neutral'
  const obiPct = flow.obi == null ? null : flow.obi * 100
  const obiTone = obiPct == null ? 'neutral' : obiPct > 3 ? 'positive' : obiPct < -3 ? 'negative' : 'neutral'
  const tradeTotal = flow.buyNotional60 + flow.sellNotional60
  const derivativeMode = mode === 'futures'
  const events = flow.events.slice(0, compact ? 3 : 7)

  return (
    <Card className="flow-card">
      <CardHeader className="flow-card__header">
        <div className="section-title-group">
          <span className="section-icon" aria-hidden="true"><Waves size={17} /></span>
          <div><CardTitle>Emir akışı</CardTitle><p className="card-subtitle">Son 60 saniye · anlık akış</p></div>
        </div>
        <span className="flow-live-label"><i aria-hidden="true" />{flow.lastTradeAt ? `Güncellendi ${formatTime(flow.lastTradeAt)}` : 'İşlem akışı bekleniyor'}</span>
      </CardHeader>
      <CardBody>
        <div className="flow-metrics-grid">
          <FlowMetric label="CVD · 60s" value={formatSigned(flow.cvd60, ' USDT', 0)} detail={`Alış ${formatCompact(flow.buyNotional60)} · Satış ${formatCompact(flow.sellNotional60)}`} tone={cvdTone} />
          <FlowMetric label="Defter dengesi" value={obiPct == null ? '—' : formatSigned(obiPct, '%', 1)} detail={flow.obi == null ? 'Derinlik bekleniyor' : 'İlk 20 kademenin notional dengesi'} tone={obiTone} />
          <FlowMetric label="Spread" value={flow.spread == null ? '—' : `${flow.spread.toFixed(3)}%`} detail={flow.spread == null ? 'Henüz ölçülmedi' : 'En iyi alış / satış'} />
          <FlowMetric label="Likidasyon · 60s" value={derivativeMode ? formatCompact(flow.liquidationNotional60, ' USDT') : '—'} detail={derivativeMode ? 'Açık futures akışı' : 'Spot modunda yok'} tone={flow.liquidationNotional60 ? 'warning' : 'neutral'} />
        </div>
        {!compact && (
          <div className="flow-lower">
            <div className="flow-balance" aria-label={`Alış hacmi ${formatCompact(flow.buyNotional60)}, satış hacmi ${formatCompact(flow.sellNotional60)}`}>
              <div className="flow-balance__labels"><span>Alıcı {formatCompact(flow.buyNotional60)}</span><span>Satıcı {formatCompact(flow.sellNotional60)}</span></div>
              <div className="flow-balance__track"><span style={{ width: `${tradeTotal ? Math.max(5, Math.min(95, flow.buyNotional60 / tradeTotal * 100)) : 50}%` }} /></div>
            </div>
            <div className="flow-events">
              <div className="flow-events__heading"><span>Öne çıkan işlemler</span><span>{events.length} olay</span></div>
              {events.length === 0 ? (
                <div className="flow-empty"><ArrowsLeftRight size={15} aria-hidden="true" /> Büyük işlem veya tasfiye olayı bekleniyor.</div>
              ) : (
                <ul>
                  {events.map((event) => (
                    <li key={event.id}>
                      <span className={`flow-event-icon flow-event-icon--${event.kind}`} aria-hidden="true">{event.kind === 'liquidation' ? <Fire size={14} /> : event.kind === 'buy' ? <Drop size={14} /> : <Drop size={14} />}</span>
                      <span className="flow-event-label">{event.label}<small>{formatTime(event.timestamp)}</small></span>
                      <span className="flow-event-values"><strong className={event.kind === 'buy' ? 'tone-positive' : event.kind === 'sell' ? 'tone-negative' : 'tone-warning'}>{formatCompact(event.notional)} USDT</strong><small>{formatPrice(event.price)}</small></span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
        {mode === 'spot-fallback' && <p className="helper-text flow-footnote">Spot veri yedeğinde CVD ve derinlik spot sembolünü temsil eder; futures tasfiyesi sunulmaz.</p>}
      </CardBody>
    </Card>
  )
}
