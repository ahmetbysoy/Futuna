import { ArrowDownRight, ArrowUpRight, Minus } from '@phosphor-icons/react'
import { Badge } from '@/components/ui/Badge'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { useDecision } from './DecisionContext'

export function DecisionCard({ compact = false }: { compact?: boolean }) {
  const { decision } = useDecision()
  const tone = decision.direction === 'AL' ? 'positive' : decision.direction === 'SAT' ? 'negative' : 'neutral'
  const DirectionIcon = decision.direction === 'AL' ? ArrowUpRight : decision.direction === 'SAT' ? ArrowDownRight : Minus
  const statusClass = `decision-status decision-status--${decision.direction === 'AL' ? 'long' : decision.direction === 'SAT' ? 'short' : 'neutral'}`

  return (
    <Card className={`decision-card${compact ? ' decision-card--compact' : ''}`}>
      <CardHeader className="decision-card__header">
        <div>
          <span className="eyebrow">KURAL TABANLI ÖZET</span>
          <CardTitle>Yön görünümü</CardTitle>
        </div>
        <Badge tone={tone}>{decision.direction === 'AL' ? 'AL sinyali' : decision.direction === 'SAT' ? 'SAT sinyali' : 'Nötr'}</Badge>
      </CardHeader>
      <CardBody>
        <div className={statusClass}>
          <span className="decision-status__icon" aria-hidden="true"><DirectionIcon size={20} weight="bold" /></span>
          <strong>{decision.direction}</strong>
          <span>{decision.direction === 'NÖTR' ? 'Net yön yok' : decision.direction === 'AL' ? 'Yukarı yönlü' : 'Aşağı yönlü'}</span>
        </div>
        <div className="alignment-block">
          <div className="alignment-block__label"><span>Katman uyumu</span><strong>{decision.alignment}<small>/100</small></strong></div>
          <div className="progress-track" role="progressbar" aria-label="Teknik katman uyumu" aria-valuemin={0} aria-valuemax={100} aria-valuenow={decision.alignment}>
            <span style={{ width: `${decision.alignment}%` }} />
          </div>
          <p className="helper-text">Kural uyumu göstergesidir; kazanma olasılığı değildir.</p>
        </div>
        {!compact && (
          <ul className="reason-list">
            {decision.reasons.slice(0, 4).map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        )}
        <p className="decision-summary">{decision.summary}</p>
      </CardBody>
    </Card>
  )
}
