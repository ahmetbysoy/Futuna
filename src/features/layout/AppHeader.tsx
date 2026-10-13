import { useApp } from '@/app/AppContext'
import { Button } from '@/components/ui/Button'
import { ConnectionBadge, ProviderBadge } from '@/components/ui/StatusIndicator'
import { useMarket } from '@/features/market/MarketContext'
import { formatTime } from '@/lib/format'
import { ArrowsClockwise, Moon, Star, Sun } from '@phosphor-icons/react'
import { SymbolPicker } from './SymbolPicker'

export function AppHeader() {
  const { theme, toggleTheme, isFavorite, toggleFavorite, showToast, setActiveView } = useApp()
  const { symbol, mode, connection, lastMessageAt, reconnect } = useMarket()
  const favorite = isFavorite(symbol)

  const changeFavorite = () => {
    toggleFavorite(symbol)
    showToast(favorite ? `${symbol} favorilerden kaldırıldı.` : `${symbol} favorilere eklendi.`, favorite ? 'neutral' : 'success')
  }

  return (
    <header className="topbar">
      <div className="topbar__mobile-brand">
        <span className="brand-mark brand-mark--small" aria-hidden="true"><span>F</span></span>
        <span>Futures<span className="brand-dot">.</span></span>
      </div>
      <SymbolPicker />
      <div className="topbar__right">
        <div className="topbar__status">
          <ProviderBadge mode={mode} />
          <ConnectionBadge state={connection} />
        </div>
        <span className="topbar__last-update" aria-label={lastMessageAt ? `Son piyasa mesajı ${formatTime(lastMessageAt)}` : 'Henüz piyasa mesajı yok'}>
          {lastMessageAt ? formatTime(lastMessageAt) : '—'}
        </span>
        <Button variant={favorite ? 'primary' : 'ghost'} size="icon" aria-label={favorite ? `${symbol} favorilerden kaldır` : `${symbol} favorilere ekle`} aria-pressed={favorite} onClick={changeFavorite}>
          <Star size={17} weight={favorite ? 'fill' : 'regular'} aria-hidden="true" />
        </Button>
        <Button variant="ghost" size="icon" aria-label={theme === 'dark' ? 'Açık temaya geç' : 'Koyu temaya geç'} onClick={toggleTheme}>
          {theme === 'dark' ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
        </Button>
        <Button variant="ghost" size="icon" aria-label="Piyasa verisine yeniden bağlan" onClick={reconnect}>
          <ArrowsClockwise size={17} aria-hidden="true" />
        </Button>
        <Button className="topbar__settings" variant="secondary" size="sm" onClick={() => setActiveView('settings')}>
          <span>Ayarlar</span>
        </Button>
      </div>
    </header>
  )
}
