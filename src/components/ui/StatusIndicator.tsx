import type { ConnectionState, MarketMode } from '@/features/market/types'
import { Badge } from './Badge'

const connectionLabels: Record<ConnectionState, string> = {
  starting: 'Başlatılıyor',
  connecting: 'Bağlanıyor',
  live: 'Canlı',
  reconnecting: 'Yeniden bağlanıyor',
  offline: 'Çevrimdışı',
}

export function ConnectionBadge({ state }: { state: ConnectionState }) {
  const tone = state === 'live' ? 'positive' : state === 'offline' ? 'negative' : 'warning'
  return <Badge tone={tone} className="connection-badge"><span className={`connection-dot connection-dot--${state}`} aria-hidden="true" />{connectionLabels[state]}</Badge>
}

export function ProviderBadge({ mode }: { mode: MarketMode }) {
  if (mode === 'futures') return <Badge tone="accent">USDⓈ-M Futures</Badge>
  if (mode === 'spot-fallback') return <Badge tone="warning">Spot yedeği</Badge>
  return <Badge tone="neutral">Kaynak bekleniyor</Badge>
}
