import { ArrowDown, ArrowUp, BookOpenText } from '@phosphor-icons/react'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { formatCompact, formatPrice, formatTime } from '@/lib/format'
import { useMarket } from '@/features/market/MarketContext'
import type { DepthLevel } from '@/features/market/types'

function BookRows({ levels, side, maxNotional }: { levels: DepthLevel[]; side: 'ask' | 'bid'; maxNotional: number }) {
  return (
    <ol className={`book-rows book-rows--${side}`} aria-label={side === 'ask' ? 'En iyi satış kademeleri' : 'En iyi alış kademeleri'}>
      {levels.map((level, index) => (
        <li key={`${side}-${level.price}-${index}`} className="book-row">
          <span className="book-row__bar" style={{ width: `${Math.max(2, level.notional / maxNotional * 100)}%` }} aria-hidden="true" />
          <span className="book-row__price mono">{formatPrice(level.price)}</span>
          <span className="book-row__size mono">{formatCompact(level.quantity)}</span>
          <span className="book-row__notional mono">{formatCompact(level.notional)}</span>
        </li>
      ))}
    </ol>
  )
}

export function OrderBookPanel() {
  const { flow, quote, mode } = useMarket()
  const asks = flow.asks.slice(0, 10).reverse()
  const bids = flow.bids.slice(0, 10)
  const maxNotional = Math.max(1, ...asks.map((level) => level.notional), ...bids.map((level) => level.notional))
  const bestAsk = flow.asks[0]?.price
  const bestBid = flow.bids[0]?.price
  const hasDepth = asks.length > 0 && bids.length > 0
  const sourceName = mode === 'spot-fallback' ? 'Spot' : 'Futures'
  const statusLabel = {
    live: `${sourceName} canlı diff akışı`,
    syncing: 'REST snapshot ile sıra eşleştiriliyor',
    connecting: 'Canlı derinlik akışına bağlanıyor',
    'rest-fallback': `${sourceName} REST yedek görüntüsü`,
    unavailable: 'Derinlik verisi kullanılamıyor',
    offline: 'Piyasa kaynağı çevrimdışı',
  }[flow.depthStatus]
  const note = flow.depthStatus === 'live'
    ? 'Yerel emir defteri REST snapshot ile başlatılır ve Binance diff güncellemelerinin sırası doğrulanarak ilerletilir. Görünen ilk 20 kademe iptal edilebilir; bu veri emir gerçekleşme garantisi vermez.'
    : flow.depthStatus === 'rest-fallback'
      ? 'Canlı diff akışı kullanılamadığında REST anlık görüntüsü yedek olarak gösterilir; bu görüntü gerçek zamanlı veya sıralı değildir. Miktarlar iptal edilebilir ve gerçekleşme garantisi vermez.'
      : flow.depthStatus === 'unavailable'
        ? 'Derinlik uç noktasına ulaşılamıyor. Bağlantı yeniden denendiğinde yerel defter tekrar eşitlenecek.'
        : flow.depthStatus === 'offline'
          ? 'Piyasa veri kaynağı çevrimdışı.'
          : 'Yerel defter önce REST snapshot ile kurulur; güncellemeler sıra doğrulaması tamamlanana kadar canlı kabul edilmez.'

  return (
    <Card className="orderbook-card">
      <CardHeader className="orderbook-header">
        <div className="section-title-group"><span className="section-icon" aria-hidden="true"><BookOpenText size={17} /></span><div><CardTitle>Derinlik defteri</CardTitle><p className="card-subtitle">İlk 20 kademe · {statusLabel}</p></div></div>
        <span className={`orderbook-updated depth-status--${flow.depthStatus}`}>{flow.depthUpdatedAt ? `Son güncelleme ${formatTime(flow.depthUpdatedAt)}` : statusLabel}</span>
      </CardHeader>
      <CardBody>
        {!hasDepth ? <div className="book-empty" role="status"><span className="spinner" aria-hidden="true" /> Emir defteri görüntüsü bekleniyor.</div> : <>
          <div className="book-table-head"><span>Fiyat</span><span>Miktar</span><span>Notional (USDT)</span></div>
          <div className="book-side-heading book-side-heading--ask"><span>Satış <small>ASK</small></span><span>{formatCompact(flow.askNotional)} USDT</span></div>
          <BookRows levels={asks} side="ask" maxNotional={maxNotional} />
          <div className="book-midline">
            <span className="book-midline__price mono">{formatPrice(quote.lastPrice)}</span>
            <span className="book-spread"><ArrowDown size={13} aria-hidden="true" />{bestAsk != null ? formatPrice(bestAsk) : '—'} spread {flow.spread == null ? '—' : `${flow.spread.toFixed(3)}%`} {bestBid != null ? formatPrice(bestBid) : '—'}<ArrowUp size={13} aria-hidden="true" /></span>
          </div>
          <div className="book-side-heading book-side-heading--bid"><span>Alış <small>BID</small></span><span>{formatCompact(flow.bidNotional)} USDT</span></div>
          <BookRows levels={bids} side="bid" maxNotional={maxNotional} />
          <div className="book-imbalance" aria-label={`İlk 20 seviyenin ${flow.obi != null && flow.obi >= 0 ? 'alış' : 'satış'} dengesinde`}>
            <span>İlk 20 kademe notional dengesi</span>
            <strong className={`mono ${flow.obi == null ? 'tone-neutral' : flow.obi >= 0 ? 'tone-positive' : 'tone-negative'}`}>{flow.obi == null ? '—' : `${flow.obi >= 0 ? '+' : ''}${(flow.obi * 100).toFixed(2)}%`}</strong>
          </div>
        </>}
        <p className="helper-text orderbook-note">{note}</p>
      </CardBody>
    </Card>
  )
}
