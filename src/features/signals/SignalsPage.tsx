import { useMemo, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, Trash } from '@phosphor-icons/react'
import { useApp } from '@/app/AppContext'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs'
import { FlowPanel } from '@/features/flow/FlowPanel'
import { useMarket } from '@/features/market/MarketContext'
import { formatCompact, formatDateTime, formatPrice } from '@/lib/format'
import { bollinger, macd, vwap } from '@/lib/math'
import { DecisionCard } from './DecisionCard'
import { useDecision } from './DecisionContext'

export function SignalsPage() {
  const { history, clearHistory, decision } = useDecision()
  const { candles, quote, flow } = useMarket()
  const { showToast, settings } = useApp()
  const [segment, setSegment] = useState('metrics')
  const closes = useMemo(() => candles.map((candle) => candle.close), [candles])
  const bands = useMemo(() => bollinger(closes, settings.bbPeriod, settings.bbStd), [closes, settings.bbPeriod, settings.bbStd])
  const vwapValues = useMemo(() => vwap(candles), [candles])
  const macdValues = useMemo(() => macd(closes, settings.macdFast, settings.macdSlow, settings.macdSignal), [closes, settings.macdFast, settings.macdSlow, settings.macdSignal])

  const clear = () => {
    if (!history.length) return
    if (window.confirm('Sinyal geçmişi bu cihazdan silinsin mi?')) {
      clearHistory()
      showToast('Sinyal geçmişi temizlendi.', 'success')
    }
  }
  const latestVwap = vwapValues.at(-1)
  const vwapDeviation = quote.lastPrice != null && latestVwap != null && Number.isFinite(latestVwap)
    ? `${(((quote.lastPrice / latestVwap) - 1) * 100).toFixed(2)}%`
    : '—'

  return (
    <div className="page page--signals">
      <div className="page-heading">
        <div><span className="eyebrow">ANALİZ <span aria-hidden="true">/</span> KARAR MOTORU</span><h1>Sinyal merkezi</h1><p>Hesaplanan yönü oluşturan teknik ve akış katmanlarını incele.</p></div>
        <Badge tone="neutral">Emir üretimi yok</Badge>
      </div>

      <div className="signals-overview">
        <DecisionCard />
        <Card className="signal-context-card">
          <CardHeader><span className="eyebrow">ANLIK DURUM</span><CardTitle>Katman özeti</CardTitle></CardHeader>
          <CardBody>
            <div className="signal-context-grid">
              <div><span>Fiyat</span><strong className="mono">{formatPrice(quote.lastPrice)}</strong></div>
              <div><span>RSI</span><strong className="mono">{decision.rsiValue == null ? '—' : decision.rsiValue.toFixed(1)}</strong></div>
              <div><span>CVD · 60s</span><strong className={`mono ${flow.cvd60 >= 0 ? 'tone-positive' : 'tone-negative'}`}>{formatCompact(flow.cvd60, ' USDT')}</strong></div>
              <div><span>Defter OBI</span><strong className="mono">{flow.obi == null ? '—' : `${(flow.obi * 100).toFixed(1)}%`}</strong></div>
            </div>
            <p className="helper-text">Katman uyumu sabit kuralların bir özetidir; piyasa yönünü garanti etmez.</p>
          </CardBody>
        </Card>
      </div>

      <Tabs value={segment} onValueChange={setSegment} className="signal-tabs">
        <TabsList aria-label="Sinyal ayrıntıları">
          <TabsTrigger value="metrics">Metrikler</TabsTrigger>
          <TabsTrigger value="flow">Olay akışı</TabsTrigger>
          <TabsTrigger value="history">Geçmiş <span className="tab-count">{history.length}</span></TabsTrigger>
        </TabsList>
        <TabsContent value="metrics">
          <Card className="signal-metrics-card">
            <CardHeader><div><span className="eyebrow">HESAPLANAN GÖSTERGELER</span><CardTitle>Ham akış ve teknik ölçümler</CardTitle></div></CardHeader>
            <CardBody>
              <div className="detailed-metrics-grid">
                <Metric label={`EMA ${settings.fastEma}`} value={decision.fastValue == null ? '—' : formatPrice(decision.fastValue)} detail="Kapanış EMA değeri" />
                <Metric label={`EMA ${settings.slowEma}`} value={decision.slowValue == null ? '—' : formatPrice(decision.slowValue)} detail="Trend referansı" />
                <Metric label="Momentum" value={decision.momentumPct == null ? '—' : `${decision.momentumPct >= 0 ? '+' : ''}${decision.momentumPct.toFixed(2)}%`} detail="Son 3 mum" />
                <Metric label="VWAP sapması" value={vwapDeviation} detail="UTC gün başlangıçlı VWAP" />
                <Metric label={`BB ${settings.bbPeriod} aralığı`} value={`${formatPrice(bands.lower.at(-1))} – ${formatPrice(bands.upper.at(-1))}`} detail={`${settings.bbStd} standart sapma`} />
                <Metric label="MACD histogram" value={formatPrice(macdValues.histogram.at(-1), 5)} detail={`${settings.macdFast}/${settings.macdSlow}/${settings.macdSignal}`} />
                <Metric label="Alış notionalı" value={formatCompact(flow.buyNotional60, ' USDT')} detail="Son 60 saniye" />
                <Metric label="Satış notionalı" value={formatCompact(flow.sellNotional60, ' USDT')} detail="Son 60 saniye" />
                <Metric label="Likidasyon akışı" value={flow.liquidationNotional60 == null ? '—' : formatCompact(flow.liquidationNotional60, ' USDT')} detail={flow.liquidationNotional60 == null ? 'Spot yedeğinde yok' : 'Son 60 saniye'} />
              </div>
              <div className="reason-panel"><strong>Yorumlanan nedenler</strong><ul>{decision.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div>
            </CardBody>
          </Card>
        </TabsContent>
        <TabsContent value="flow"><FlowPanel /></TabsContent>
        <TabsContent value="history">
          <Card className="history-card">
            <CardHeader className="history-card__header">
              <div><span className="eyebrow">BU CİHAZDA SAKLANIR</span><CardTitle>Sinyal geçmişi</CardTitle></div>
              <Button size="sm" variant="ghost" onClick={clear} disabled={!history.length}><Trash size={15} aria-hidden="true" />Temizle</Button>
            </CardHeader>
            <CardBody>
              {history.length === 0 ? <EmptyState title="Henüz kayıtlı sinyal yok" description="AL veya SAT yönü kurallara göre oluştuğunda bu listede görünür." /> : (
                <div className="table-scroll"><table className="data-table signal-history-table">
                  <caption className="sr-only">En yeni sinyaller başta olmak üzere geçmiş sinyal listesi</caption>
                  <thead><tr><th scope="col">Yön</th><th scope="col">Sembol</th><th scope="col">Fiyat</th><th scope="col">Uyum</th><th scope="col">Oluşma zamanı</th><th scope="col">Neden</th></tr></thead>
                  <tbody>{history.map((item) => (
                    <tr key={item.id}>
                      <th scope="row"><Badge tone={item.direction === 'AL' ? 'positive' : 'negative'}>{item.direction === 'AL' ? <ArrowUpRight size={13} aria-hidden="true" /> : <ArrowDownRight size={13} aria-hidden="true" />}{item.direction}</Badge></th>
                      <td className="mono">{item.symbol}</td><td className="mono">{formatPrice(item.price)}</td><td className="mono">{item.score}/100</td><td>{formatDateTime(item.timestamp)}</td><td className="history-reason">{item.reason}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              )}
            </CardBody>
          </Card>
        </TabsContent>
      </Tabs>
      <p className="disclaimer">Sinyal geçmişi yalnızca bu tarayıcıda yerel olarak saklanır. Geçmiş performans gelecekteki sonuçları göstermez.</p>
    </div>
  )
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="detailed-metric"><span>{label}</span><strong className="mono">{value}</strong><small>{detail}</small></div>
}
