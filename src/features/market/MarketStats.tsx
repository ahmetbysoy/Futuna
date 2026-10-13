import { ArrowDown, ArrowUp, CurrencyDollar, Gauge, ChartLineUp } from '@phosphor-icons/react'
import { MetricCard } from '@/components/ui/MetricCard'
import { formatCompact, formatFunding, formatPrice, formatSigned } from '@/lib/format'
import { useMarket } from './MarketContext'

export function MarketStats() {
  const { quote, mode } = useMarket()
  const change = quote.change24h
  return (
    <section className="stats-grid" aria-label="Piyasa özeti">
      <MetricCard label="24 saat değişim" value={formatSigned(change)} detail="son 24 saat" tone={change == null ? 'neutral' : change >= 0 ? 'positive' : 'negative'} icon={change != null && change >= 0 ? <ArrowUp size={15} /> : <ArrowDown size={15} />} />
      <MetricCard label="24s işlem hacmi" value={formatCompact(quote.quoteVolume24h, ' USDT')} detail="kotasyon hacmi" tone="neutral" icon={<ChartLineUp size={15} />} />
      <MetricCard label="Funding" value={mode === 'futures' ? formatFunding(quote.fundingRate) : '—'} detail={mode === 'futures' ? 'son fonlama oranı' : 'spot modunda mevcut değil'} tone={quote.fundingRate == null ? 'neutral' : quote.fundingRate >= 0 ? 'positive' : 'negative'} icon={<CurrencyDollar size={15} />} />
      <MetricCard label="Açık pozisyon" value={mode === 'futures' ? formatCompact(quote.openInterest) : '—'} detail={mode === 'futures' ? `OI değişimi ${formatSigned(quote.openInterestChange)}` : 'spot modunda mevcut değil'} tone={quote.openInterestChange == null ? 'neutral' : quote.openInterestChange >= 0 ? 'positive' : 'negative'} icon={<Gauge size={15} />} />
      <MetricCard label="Gün içi yüksek" value={formatPrice(quote.high24h)} detail="24s tepe" tone="neutral" icon={<ArrowUp size={15} />} />
      <MetricCard label="Gün içi düşük" value={formatPrice(quote.low24h)} detail="24s dip" tone="neutral" icon={<ArrowDown size={15} />} />
    </section>
  )
}
