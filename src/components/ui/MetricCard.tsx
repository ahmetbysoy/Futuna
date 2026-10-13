import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface MetricCardProps {
  label: string
  value: string
  detail?: string
  tone?: 'positive' | 'negative' | 'neutral' | 'warning'
  icon?: ReactNode
}

export function MetricCard({ label, value, detail, tone = 'neutral', icon }: MetricCardProps) {
  return (
    <section className="metric-card" aria-label={`${label}: ${value}${detail ? `, ${detail}` : ''}`}>
      <div className="metric-card__top">
        <span className="metric-card__label">{label}</span>
        {icon && <span className="metric-card__icon" aria-hidden="true">{icon}</span>}
      </div>
      <strong className={cn('metric-card__value', `tone-${tone}`)}>{value}</strong>
      {detail && <span className="metric-card__detail">{detail}</span>}
    </section>
  )
}
