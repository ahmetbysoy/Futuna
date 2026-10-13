import { ArrowsClockwise, ArrowDownRight, ArrowUpRight, ChartLineUp } from '@phosphor-icons/react'
import { useApp } from '@/app/AppContext'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { formatPrice, formatSigned, signedClass } from '@/lib/format'
import { useMarket } from '@/features/market/MarketContext'
import type { Timeframe } from '@/features/market/types'
import { PriceChart } from './PriceChart'
import { IndicatorPanels } from './IndicatorPanels'

const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '4h']

export function PriceChartPanel() {
  const { symbol, timeframe, setTimeframe, mode, candles, liveCandle, quote, loadingCandles, error, refresh } = useMarket()
  const { theme, settings, showToast } = useApp()
  const active = candles.at(-1)
  const displayPrice = quote.lastPrice ?? liveCandle?.close ?? active?.close ?? null
  const base = symbol.replace('USDT', '')

  return (
    <Card className="chart-card">
      <CardHeader className="chart-card__header">
        <div className="chart-title-wrap">
          <span className="section-icon" aria-hidden="true"><ChartLineUp size={17} /></span>
          <div>
            <div className="chart-heading-row">
              <CardTitle className="chart-title">Fiyat hareketi</CardTitle>
              <Badge tone={mode === 'futures' ? 'accent' : 'warning'}>{mode === 'futures' ? 'Sürekli kontrat' : 'Spot veri'}</Badge>
            </div>
            <p className="chart-subtitle">{base} / USDT <span className="text-muted">·</span> {symbol} <span className="text-muted">·</span> {timeframe}</p>
          </div>
        </div>
        <div className="chart-price-block">
          <strong className="chart-price mono">{formatPrice(displayPrice)}</strong>
          <span className={`chart-price-change ${signedClass(quote.change24h)}`}>
            {quote.change24h != null && quote.change24h >= 0 ? <ArrowUpRight size={14} aria-hidden="true" /> : <ArrowDownRight size={14} aria-hidden="true" />}
            {formatSigned(quote.change24h)} <span className="text-muted">24s</span>
          </span>
        </div>
      </CardHeader>

      {mode === 'spot-fallback' && (
        <div className="notice notice--warning" role="status">
          <strong>Spot veri yedeği aktif.</strong> Mumlar spot piyasadan gelir; funding, açık pozisyon ve tasfiye akışı futures verisi olarak gösterilmez.
        </div>
      )}
      {error && (
        <div className="notice notice--error" role="alert">
          <div><strong>Veri yenilenemedi.</strong><span>{error}</span></div>
          <Button size="sm" variant="secondary" onClick={() => { refresh(); showToast('Piyasa verisi yeniden isteniyor.', 'neutral') }}><ArrowsClockwise size={15} /> Yeniden dene</Button>
        </div>
      )}

      <div className="timeframe-row" role="group" aria-label="Grafik zaman aralığı">
        {TIMEFRAMES.map((item) => (
          <Button key={item} size="sm" variant={timeframe === item ? 'primary' : 'subtle'} aria-pressed={timeframe === item} onClick={() => setTimeframe(item)}>
            {item}
          </Button>
        ))}
        <span className="timeframe-spacer" />
        <span className="chart-setting-hint">{settings.showEma ? `EMA ${settings.fastEma}/${settings.slowEma}` : 'EMA kapalı'} <span aria-hidden="true">·</span> {settings.showVolume ? 'Hacim açık' : 'Hacim kapalı'}</span>
      </div>

      {candles.length > 0 ? (
        <PriceChart
          candles={candles}
          liveCandle={liveCandle}
          symbol={symbol}
          timeframe={timeframe}
          theme={theme}
          showEma={settings.showEma}
          showVolume={settings.showVolume}
          showBollinger={settings.showBollinger}
          showVwap={settings.showVwap}
          showSar={settings.showSar}
          fastEma={settings.fastEma}
          slowEma={settings.slowEma}
          bbPeriod={settings.bbPeriod}
          bbStd={settings.bbStd}
          loading={loadingCandles}
        />
      ) : (
        <div className="chart-loading" role="status">
          <div className="chart-skeleton" aria-hidden="true"><span /><span /><span /><span /><span /></div>
          <strong>{loadingCandles ? 'Mum verileri yükleniyor' : 'Grafik verisi bekleniyor'}</strong>
          <span>{loadingCandles ? 'Piyasa geçmişi getiriliyor.' : 'Bağlantı sağlanınca gerçek piyasa verisi burada görünür.'}</span>
        </div>
      )}
      {candles.length > 0 && <IndicatorPanels candles={candles} settings={settings} />}
    </Card>
  )
}
