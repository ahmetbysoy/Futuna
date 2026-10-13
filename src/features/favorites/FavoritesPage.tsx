import { ArrowUpRight, Star, ClockCounterClockwise, Trash } from '@phosphor-icons/react'
import { useApp } from '@/app/AppContext'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { useMarket } from '@/features/market/MarketContext'
import { formatPrice, formatSigned, signedClass } from '@/lib/format'

export function FavoritesPage() {
  const { favorites, recentSymbols, toggleFavorite, setActiveView, addRecent } = useApp()
  const { symbols, symbol, setSymbol, quote } = useMarket()
  const favoritesList = symbols.filter((item) => favorites.includes(item.symbol))
  const recentList = symbols.filter((item) => recentSymbols.includes(item.symbol))

  const open = (target: string) => {
    setSymbol(target)
    addRecent(target)
    setActiveView('dashboard')
  }

  return (
    <div className="page page--favorites">
      <div className="page-heading"><div><span className="eyebrow">KİŞİSEL İZLEME LİSTESİ</span><h1>Favoriler</h1><p>Sık takip ettiğin sembollere hızlıca dön.</p></div></div>
      <Card className="favorites-card">
        <CardHeader><div><span className="eyebrow">PINNED MARKETS</span><CardTitle>Takip listesi</CardTitle></div><span className="result-count">{favoritesList.length} sembol</span></CardHeader>
        <CardBody>
          {favoritesList.length ? <ul className="symbol-list">{favoritesList.map((item) => (
            <li key={item.symbol} className={item.symbol === symbol ? 'is-current' : ''}>
              <button type="button" className="symbol-list__main" onClick={() => open(item.symbol)}>
                <span className="symbol-avatar">{item.baseAsset.slice(0, 2)}</span>
                <span><strong>{item.baseAsset}<small>/USDT</small></strong><small>{item.symbol}{item.symbol === symbol ? ' · seçili' : ''}</small></span>
                <span className="symbol-list__price mono">{item.symbol === symbol ? formatPrice(quote.lastPrice) : '—'}<small>{item.symbol === symbol ? <span className={signedClass(quote.change24h)}>{formatSigned(quote.change24h)}</span> : 'Piyasayı aç'}</small></span>
              </button>
              <Button variant="ghost" size="icon" aria-label={`${item.symbol} favorilerden kaldır`} onClick={() => toggleFavorite(item.symbol)}><Star size={17} weight="fill" aria-hidden="true" /></Button>
            </li>
          ))}</ul> : <EmptyState icon={<Star size={22} />} title="Favori sembol yok" description="Üst çubuktaki yıldızla seçili sembolü favorilerine ekleyebilirsin." action={<Button variant="secondary" onClick={() => setActiveView('dashboard')}>Piyasaya dön</Button>} />}
        </CardBody>
      </Card>
      <Card className="recent-card">
        <CardHeader><div><span className="eyebrow">SON KULLANILANLAR</span><CardTitle>Yakın zamanda açılanlar</CardTitle></div><ClockCounterClockwise size={17} className="muted-icon" aria-hidden="true" /></CardHeader>
        <CardBody>
          {recentList.length ? <ul className="recent-list">{recentList.map((item) => <li key={item.symbol}><button type="button" onClick={() => open(item.symbol)}><span className="recent-list__symbol">{item.baseAsset}/USDT</span><span className="recent-list__symbol-code">{item.symbol}</span><span className="recent-list__open">Aç <ArrowUpRight size={14} aria-hidden="true" /></span></button></li>)}</ul> : <EmptyState icon={<Trash size={20} />} title="Yakın geçmiş boş" description="Sembol seçtikçe burada görünür." />}
        </CardBody>
      </Card>
      <Card className="favorites-tip"><CardBody><strong>İpucu</strong><p>Sembol aramasında <kbd>/</kbd> tuşu arama kutusuna odaklanır. Klavye ile ilk 10 eşleşme arasında gezinebilirsin.</p></CardBody></Card>
    </div>
  )
}
