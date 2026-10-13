import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { useMarket } from '@/features/market/MarketContext'
import { useOrderflow } from '@/features/orderflow/useOrderflow'
import type { CompassComponents } from '@/features/orderflow/types'
import { formatSigned } from '@/lib/format'

const COMPONENTS: Array<{ key: keyof CompassComponents; label: string; max: number }> = [
  { key: 'ice', label: 'Iceberg tepkisi', max: 30 },
  { key: 'drift', label: 'Likidite kayması', max: 20 },
  { key: 'flow', label: 'CVD + süpürme', max: 20 },
  { key: 'pull', label: 'Çekilme / dolum', max: 15 },
  { key: 'wall', label: 'Yakın duvar dengesi', max: 15 },
]

export function ScalpingCompass() {
  const snapshot = useOrderflow()
  const { mode, symbol } = useMarket()
  const isCurrent = snapshot.symbol === symbol && snapshot.mode === mode
  const ready = isCurrent && mode !== 'offline' && snapshot.depthSynced
  const score = ready ? snapshot.compass.score : 0
  const direction = ready ? snapshot.compass.direction : 'FLAT'
  const tone = direction === 'BULL' ? 'positive' : direction === 'BEAR' ? 'negative' : 'neutral'
  const directionLabel = direction === 'BULL' ? 'Yukarı eğilim' : direction === 'BEAR' ? 'Aşağı eğilim' : 'Nötr / sıkışma'
  const statusLabel = !isCurrent || snapshot.depthStatus === 'connecting' || snapshot.depthStatus === 'syncing'
    ? 'Derinlik bekleniyor'
    : snapshot.depthStatus === 'live' && ready
      ? mode === 'spot-fallback' ? 'Spot yedeği · canlı' : 'Canlı derinlik'
      : snapshot.depthStatus === 'rest-fallback'
        ? 'REST yedeği'
        : snapshot.depthStatus === 'offline' || mode === 'offline'
          ? 'Çevrimdışı'
          : 'Derinlik kullanılamıyor'

  return (
    <Card className="scalping-compass" aria-label="Scalping pusulası">
      <CardHeader className="scalping-compass__header">
        <div>
          <span className="eyebrow">EMİR AKIŞI · EMİR GÖNDERMEZ</span>
          <CardTitle>Scalping pusulası</CardTitle>
        </div>
        <span className={`compass-status compass-status--${tone}`}><i aria-hidden="true" />{statusLabel}</span>
      </CardHeader>
      <CardBody className="scalping-compass__body">
        <div className="compass-score-row">
          <div className="compass-score-readout">
            <strong className={`tone-${tone} mono`}>{formatSigned(score, '', 0)}</strong>
            <span>/100</span>
          </div>
          <div className="compass-direction">
            <strong className={`tone-${tone}`}>{ready ? snapshot.compass.label : 'Derinlik verisi bekleniyor'}</strong>
            <span>{ready ? directionLabel : 'Senkronize emir defteri gerekli'}</span>
          </div>
        </div>
        <div
          className="compass-score-track"
          role="meter"
          aria-label="Scalping pusulası yön baskısı"
          aria-valuemin={-100}
          aria-valuemax={100}
          aria-valuenow={score}
        >
          <span className="compass-score-track__center" aria-hidden="true" />
          <span
            className={`compass-score-track__marker compass-score-track__marker--${tone}`}
            style={{ left: `${50 + score / 2}%` }}
            aria-hidden="true"
          />
        </div>
        <div className="compass-components" aria-label="Pusula bileşenleri">
          {COMPONENTS.map(({ key, label, max }) => {
            const value = ready ? snapshot.compass.components[key] : 0
            const percent = Math.min(1, Math.abs(value) / max)
            const left = value >= 0 ? 50 : 50 - percent * 50
            return (
              <div className="compass-component" key={key}>
                <span className="compass-component__label">{label}</span>
                <div className="compass-component__track" aria-hidden="true">
                  <span
                    className={`compass-component__fill compass-component__fill--${value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral'}`}
                    style={{ left: `${left}%`, width: `${percent * 50}%` }}
                  />
                </div>
                <strong className={`tone-${value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral'} mono`}>{formatSigned(Math.round(value * 100), ' pt', 0)}</strong>
              </div>
            )
          })}
        </div>
        <p className="helper-text scalping-compass__note">Yön baskısı göstergesidir; teknik kural skorunu değiştirmez ve yatırım tavsiyesi değildir.</p>
      </CardBody>
    </Card>
  )
}
