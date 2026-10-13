import { ArrowSquareOut, ShieldWarning } from '@phosphor-icons/react'
import { useApp } from '@/app/AppContext'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { useMarket } from '@/features/market/MarketContext'
import { DecisionCard } from '@/features/signals/DecisionCard'
import { FlowPanel } from '@/features/flow/FlowPanel'
import { OrderBookPanel } from '@/features/flow/OrderBookPanel'
import { MarketStats } from '@/features/market/MarketStats'
import { PriceChartPanel } from '@/features/chart/PriceChartPanel'

export function DashboardPage() {
  const { mode, modeReason, connection, error, reconnect, loadingSymbols } = useMarket()
  const { showToast, settings } = useApp()

  return (
    <div className="page page--dashboard">
      <div className="page-heading">
        <div>
          <span className="eyebrow">PİYASA GÖZETİMİ <span aria-hidden="true">/</span> USDⓈ-M</span>
          <h1>Canlı terminal</h1>
          <p>Fiyat, teknik katmanlar ve işlem akışını tek görünümde takip et.</p>
        </div>
        <div className="page-heading__aside"><span className="data-note"><span className="data-note__line" />Salt-okuma piyasa verisi</span></div>
      </div>

      {mode === 'spot-fallback' && (
        <div className="provider-notice" role="status">
          <span className="provider-notice__icon" aria-hidden="true"><ShieldWarning size={19} /></span>
          <div><strong>Futures verisi erişilemiyor — spot yedeği kullanılıyor</strong><p>{modeReason}</p></div>
          <Button variant="secondary" size="sm" onClick={() => { reconnect(); showToast('Futures kaynağı yeniden deneniyor.', 'neutral') }}>Futures’ı yeniden dene</Button>
        </div>
      )}
      {mode === 'offline' && !loadingSymbols && error && (
        <div className="provider-notice provider-notice--error" role="alert">
          <span className="provider-notice__icon" aria-hidden="true"><ShieldWarning size={19} /></span>
          <div><strong>Canlı piyasa kaynağına ulaşılamadı</strong><p>{error}</p></div>
          <Button variant="secondary" size="sm" onClick={reconnect}>Yeniden bağlan</Button>
        </div>
      )}

      <MarketStats />
      <div className="dashboard-grid">
        <div className="dashboard-grid__primary"><PriceChartPanel /></div>
        <aside className="dashboard-grid__side" aria-label="Sinyal ve özet">
          <DecisionCard />
          <Card className="context-card">
            <div className="context-card__label"><span>VERİ KALİTESİ</span><ArrowSquareOut size={15} aria-hidden="true" /></div>
            <strong>{connection === 'live' ? 'Akış bağlantısı açık' : connection === 'offline' ? 'Akış çevrimdışı' : 'Bağlantı kuruluyor'}</strong>
            <p>{connection === 'live' ? 'Son mesajlar grafik ve flow modüllerine dağıtılıyor.' : 'Yeniden bağlanma denemeleri otomatik olarak sürüyor.'}</p>
          </Card>
        </aside>
      </div>
      {settings.showFlow && <FlowPanel />}
      {settings.showFlow && <OrderBookPanel />}
      <p className="disclaimer"><strong>Bilgilendirme:</strong> Gösterilen kurallar ve metrikler eğitim/analiz amaçlıdır; yatırım tavsiyesi, getiri garantisi veya emir değildir. Kaldıraçlı işlemler yüksek risk taşır.</p>
    </div>
  )
}
