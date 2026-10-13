import { ArrowDownRight, ArrowUpRight, ArrowsLeftRight, Minus } from '@phosphor-icons/react'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { useMarket } from '@/features/market/MarketContext'
import { useDecision } from '@/features/signals/DecisionContext'
import { useOrderflow } from '@/features/orderflow/useOrderflow'

export function DecisionStrip() {
  const snapshot = useOrderflow()
  const { mode, symbol } = useMarket()
  const { decision } = useDecision()
  const isCurrent = snapshot.symbol === symbol && snapshot.mode === mode
  const flowReady = isCurrent && mode !== 'offline' && snapshot.depthSynced
  const decisionSide = decision.direction === 'AL' ? 'BULL' : decision.direction === 'SAT' ? 'BEAR' : 'FLAT'
  const flowSide = flowReady ? snapshot.compass.direction : 'FLAT'
  const aligned = flowReady && decisionSide !== 'FLAT' && flowSide !== 'FLAT'
  const sameDirection = aligned && decisionSide === flowSide
  const badgeTone: BadgeTone = !flowReady || !aligned ? 'warning' : sameDirection ? 'positive' : 'negative'
  const badgeLabel = !flowReady
    ? 'AKIŞ BEKLENİYOR'
    : !aligned
      ? 'TEYİT YOK'
      : sameDirection
        ? 'AYNI YÖNDE'
        : 'AYRIŞIYOR'
  const TechnicalIcon = decision.direction === 'AL' ? ArrowUpRight : decision.direction === 'SAT' ? ArrowDownRight : Minus
  const FlowIcon = flowReady && flowSide === 'BULL' ? ArrowUpRight : flowReady && flowSide === 'BEAR' ? ArrowDownRight : ArrowsLeftRight
  const flowLabel = !flowReady ? 'Bekleniyor' : flowSide === 'BULL' ? 'Yukarı' : flowSide === 'BEAR' ? 'Aşağı' : 'Nötr'

  return (
    <Card className="orderflow-decision-strip" aria-label="Teknik yön ve emir akışı karşılaştırması">
      <span className="decision-strip__icon" aria-hidden="true"><ArrowsLeftRight size={17} /></span>
      <div className="decision-strip__heading">
        <span className="eyebrow">KARAR ŞERİDİ · BİLGİLENDİRME</span>
        <strong>Teknik yön ve piyasa akışı</strong>
        <small>{mode === 'spot-fallback' ? 'Spot yedek akışı · futures tasfiyeleri yok' : 'Kural yönü ayrı tutulur; sinyal skoru değişmez'}</small>
      </div>
      <div className="decision-strip__directions" aria-label="Yön karşılaştırması">
        <div className="decision-strip__direction">
          <span>KURAL</span>
          <strong className={`tone-${decision.direction === 'AL' ? 'positive' : decision.direction === 'SAT' ? 'negative' : 'neutral'}`}><TechnicalIcon size={14} aria-hidden="true" />{decision.direction}</strong>
        </div>
        <span className="decision-strip__divider" aria-hidden="true">/</span>
        <div className="decision-strip__direction">
          <span>AKIŞ</span>
          <strong className={`tone-${flowReady && flowSide === 'BULL' ? 'positive' : flowReady && flowSide === 'BEAR' ? 'negative' : 'neutral'}`}><FlowIcon size={14} aria-hidden="true" />{flowLabel}</strong>
        </div>
      </div>
      <Badge tone={badgeTone} aria-live="polite">{badgeLabel}</Badge>
    </Card>
  )
}
