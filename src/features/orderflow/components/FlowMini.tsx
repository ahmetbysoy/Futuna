import { ArrowsLeftRight, Fire, Waves } from '@phosphor-icons/react'
import { Badge } from '@/components/ui/Badge'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { useMarket } from '@/features/market/MarketContext'
import { useOrderflow } from '@/features/orderflow/useOrderflow'
import type { FlowEventRecord } from '@/features/orderflow/types'
import { formatCompact, formatPrice, formatTime } from '@/lib/format'

const EVENT_LABELS: Record<FlowEventRecord['type'], string> = {
  WHALE: 'Büyük işlem',
  SWEEP: 'Piyasa süpürmesi',
  'DOM SWEEP': 'Defter süpürmesi',
  'ABSORPTION?': 'Olası absorpsiyon',
  'DELTA BURST': 'Delta ivmesi',
  'SPOOF?': 'Olası sahte emir',
  FILLED: 'Duvar emirleri karşılandı',
  ICEBERG: 'Gizli likidite yenilemesi',
  LIQUIDATION: 'Tasfiye',
  WALL_NEW: 'Yeni likidite duvarı',
  WALL_GROW: 'Duvar büyüyor',
  WALL_EATEN: 'Duvar tüketiliyor',
  WALL_GONE: 'Duvar çekildi',
}

function sideLabel(side: FlowEventRecord['side']) {
  if (side === 'buy' || side === 'bid' || side === 'long') return 'Alış tarafı'
  if (side === 'sell' || side === 'ask' || side === 'short') return 'Satış tarafı'
  return null
}

function eventDescription(event: FlowEventRecord) {
  const parts = [sideLabel(event.side)]
  if (event.notional != null) parts.push(`${formatCompact(event.notional)} USDT`)
  if (event.price != null && Number.isFinite(event.price)) parts.push(`@ ${formatPrice(event.price)}`)
  return parts.filter(Boolean).join(' · ') || 'Akış anomalisine ilişkin ölçüm'
}

function eventDateTime(ts: number) {
  const date = new Date(ts)
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined
}

export function FlowMini() {
  const snapshot = useOrderflow()
  const { mode, symbol } = useMarket()
  const isCurrent = snapshot.symbol === symbol && snapshot.mode === mode
  const events = isCurrent && mode !== 'offline' ? [...snapshot.events].reverse().slice(0, 6) : []
  const status = !isCurrent || snapshot.depthStatus === 'connecting' || snapshot.depthStatus === 'syncing'
    ? { label: 'Bağlanıyor', tone: 'neutral' as const }
    : snapshot.depthStatus === 'live'
      ? mode === 'spot-fallback'
        ? { label: 'Spot yedeği', tone: 'warning' as const }
        : { label: 'Canlı', tone: 'positive' as const }
      : snapshot.depthStatus === 'rest-fallback'
        ? { label: 'REST yedeği', tone: 'warning' as const }
        : mode === 'offline' || snapshot.depthStatus === 'offline'
          ? { label: 'Çevrimdışı', tone: 'negative' as const }
          : { label: 'Akış bekleniyor', tone: 'neutral' as const }

  return (
    <Card className="flow-mini-card" aria-label="FlowMini olay akışı">
      <CardHeader className="flow-mini-card__header">
        <div className="section-title-group">
          <span className="section-icon" aria-hidden="true"><Waves size={17} /></span>
          <div>
            <CardTitle>FlowMini</CardTitle>
            <p className="card-subtitle">Son emir akışı olayları · {snapshot.symbol === symbol ? symbol : 'sembol hazırlanıyor'}</p>
          </div>
        </div>
        <div className="flow-mini-card__status"><Badge tone={status.tone}>{status.label}</Badge><span>{events.length} olay</span></div>
      </CardHeader>
      <CardBody className="flow-mini-card__body">
        {events.length === 0 ? (
          <div className="flow-mini-empty" role="status">
            {mode === 'offline' ? <ArrowsLeftRight size={16} aria-hidden="true" /> : <Fire size={16} aria-hidden="true" />}
            <span>{mode === 'offline' ? 'Canlı emir akışı verisi çevrimdışı.' : 'Belirgin işlem veya emir defteri olayı bekleniyor.'}</span>
          </div>
        ) : (
          <ul className="flow-mini-list" aria-label="En yeni orderflow olayları">
            {events.map((event) => {
              const tone = event.side === 'buy' || event.side === 'bid' || event.side === 'long'
                ? 'positive'
                : event.side === 'sell' || event.side === 'ask' || event.side === 'short'
                  ? 'negative'
                  : event.sev === 'high' ? 'warning' : 'neutral'
              return (
                <li className={`flow-mini-event flow-mini-event--${tone}`} key={event.id}>
                  <span className="flow-mini-event__icon" aria-hidden="true">{event.type === 'LIQUIDATION' ? <Fire size={14} /> : <Waves size={14} />}</span>
                  <span className="flow-mini-event__content">
                    <strong>{EVENT_LABELS[event.type]}</strong>
                    <small>{eventDescription(event)}</small>
                  </span>
                  <span className="flow-mini-event__meta">
                    <time dateTime={eventDateTime(event.ts)}>{formatTime(event.ts)}</time>
                    <span>{event.sev === 'high' ? 'YÜKSEK' : event.sev === 'medium' ? 'ORTA' : 'DÜŞÜK'}</span>
                  </span>
                </li>
              )
            })}
          </ul>
        )}
        {mode === 'spot-fallback' && <p className="helper-text flow-mini-card__footnote">Spot akışında yalnızca spot trade ve derinlik olayları gösterilir; tasfiye verisi yoktur.</p>}
      </CardBody>
    </Card>
  )
}
