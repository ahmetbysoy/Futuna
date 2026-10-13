import { useMemo, useState } from 'react'
import { Bell, CheckCircle, ChartLineUp, Moon, Palette, Sun, WarningCircle } from '@phosphor-icons/react'
import { useApp } from '@/app/AppContext'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { useMarket } from '@/features/market/MarketContext'
import type { MarketMode } from '@/features/market/types'
import { formatCompact } from '@/lib/format'
import { readStorage, writeStorage } from '@/lib/storage'
import { SessionRecorderCard } from '@/features/session/SessionRecorderCard'
import { ORDERFLOW_PRESET_LABELS, ORDERFLOW_PRESETS, type OrderflowPresetId } from '@/features/orderflow/settings'
import { useOrderflow } from '@/features/orderflow/useOrderflow'

const LOSS_STORAGE_KEY = 'fs.daily-loss.v1'

interface DailyLossRecord { day: string; amount: number }
function todayKey() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
function initialLoss() {
  const saved = readStorage<DailyLossRecord | null>(LOSS_STORAGE_KEY, null)
  if (saved?.day === todayKey() && Number.isFinite(saved.amount)) return saved.amount
  writeStorage(LOSS_STORAGE_KEY, { day: todayKey(), amount: 0 } satisfies DailyLossRecord)
  return 0
}

export function SettingsPage() {
  const { theme, setTheme, settings, updateSettings, updateOrderflowSettings, resetSettings, showToast } = useApp()
  const { connection, mode, symbol, reconnect } = useMarket()
  const [search, setSearch] = useState('')
  const [dailyLoss, setDailyLoss] = useState(initialLoss)
  const [lossInput, setLossInput] = useState('')
  const [notificationState, setNotificationState] = useState(() => typeof Notification === 'undefined' ? 'Bu tarayıcı bildirimleri desteklemiyor.' : `Tarayıcı izni: ${Notification.permission}`)
  const query = search.trim().toLowerCase()
  const currentSymbolThreshold = settings.orderflow.whaleMinBySymbol[symbol] ?? settings.orderflow.whaleMin
  const hasSymbolThreshold = Object.prototype.hasOwnProperty.call(settings.orderflow.whaleMinBySymbol, symbol)

  const sections = useMemo(() => [
    { id: 'appearance', label: 'Görünüm ve bağlantı', search: 'tema açık koyu renk piyasa futures spot websocket bağlantı yeniden bağlan', content: 'Görünümü kişiselleştir ve veri kaynağının durumunu denetle.' },
    { id: 'chart', label: 'Grafik ve göstergeler', search: 'grafik ema bollinger vwap rsi macd sar hacim flow çizgi periyot standart sapma', content: 'Fiyat grafiğinde görünen teknik katmanları seç.' },
    { id: 'orderflow', label: 'Emir akışı ve mikro yapı', search: 'orderflow order flow emir akışı heatmap ısı haritası dom ladder duvar ray eşik scalp pusula iceberg eşik preset kalibrasyon', content: 'Likidite katmanlarını, büyük işlem eşiklerini ve hazır görünümleri düzenle.' },
    { id: 'signals', label: 'Sinyal ve test varsayımları', search: 'sinyal motoru eşik rsi periyot ücret komisyon bps backtest scanner tarayıcı sembol limit', content: 'Kural tabanlı özet ve tarihsel test için kullanılan ayarları düzenle.' },
    { id: 'alerts', label: 'Ses ve bildirimler', search: 'uyarı alert bildirim browser tarayıcı ses volume titreşim al sat işlem flow', content: 'İsteğe bağlı ses, tarayıcı bildirimi ve mobil titreşim tercihlerini ayarla.' },
    { id: 'risk', label: 'Manuel günlük risk takibi', search: 'risk günlük kayıp limit usdt manuel tracker zarar gün sıfırla', content: 'Sadece senin girdiğin tutarları yerel olarak takip eder; borsa hesabına bağlı değildir.' },
  ], [])
  const visibleSections = sections.filter((section) => !query || `${section.label} ${section.search} ${section.content}`.toLowerCase().includes(query))

  const addLoss = () => {
    const amount = Number(lossInput)
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast('Pozitif bir USDT tutarı gir.', 'warning')
      return
    }
    const next = dailyLoss + amount
    setDailyLoss(next)
    writeStorage(LOSS_STORAGE_KEY, { day: todayKey(), amount: next } satisfies DailyLossRecord)
    setLossInput('')
    showToast('Manuel kayıp tutarı yerel kayda eklendi.', 'success')
    if (settings.dailyLossEnabled && next >= settings.dailyLossLimit && settings.alertOnLimit) showToast('Manuel günlük limit eşiğine ulaşıldı.', 'warning')
  }

  const resetLoss = () => {
    if (!window.confirm('Bugünün manuel kayıp sayacı sıfırlansın mı?')) return
    setDailyLoss(0)
    writeStorage(LOSS_STORAGE_KEY, { day: todayKey(), amount: 0 } satisfies DailyLossRecord)
    showToast('Bugünün manuel sayacı sıfırlandı.', 'success')
  }

  const requestNotificationPermission = async () => {
    if (typeof Notification === 'undefined') {
      setNotificationState('Bu tarayıcı bildirimleri desteklemiyor.')
      showToast('Tarayıcı bildirimi desteklenmiyor.', 'warning')
      return
    }
    const permission = await Notification.requestPermission()
    setNotificationState(`Tarayıcı izni: ${permission}`)
    updateSettings({ notificationsEnabled: permission === 'granted' })
    showToast(permission === 'granted' ? 'Bildirim izni verildi.' : 'Bildirim izni etkinleştirilmedi.', permission === 'granted' ? 'success' : 'warning')
  }

  const testSound = () => {
    if (!settings.alertsEnabled) updateSettings({ alertsEnabled: true })
    try {
      const AudioContextClass = window.AudioContext
      if (!AudioContextClass) throw new Error('Ses desteği bulunamadı.')
      const context = new AudioContextClass()
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(740, context.currentTime)
      oscillator.frequency.setValueAtTime(920, context.currentTime + 0.12)
      gain.gain.setValueAtTime(Math.max(0.001, settings.alertVolume * 0.12), context.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.32)
      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start()
      oscillator.stop(context.currentTime + 0.33)
      oscillator.onended = () => void context.close()
      showToast('Ses uyarısı denendi.', 'success')
    } catch (reason) {
      showToast(reason instanceof Error ? reason.message : 'Ses uyarısı başlatılamadı.', 'warning')
    }
  }

  const resetPreferences = () => {
    if (!window.confirm('Grafik, sinyal ve bildirim tercihleri varsayılanlara dönsün mü? Favoriler ve geçmiş korunur.')) return
    resetSettings()
    showToast('Tercihler varsayılanlara döndürüldü.', 'success')
  }

  const applyOrderflowPreset = (presetId: OrderflowPresetId) => {
    updateOrderflowSettings({ ...ORDERFLOW_PRESETS[presetId], presetId })
    showToast(`${ORDERFLOW_PRESET_LABELS[presetId]} emir akışı görünümü uygulandı.`, 'success')
  }

  const updateSymbolThreshold = (value: number) => {
    updateOrderflowSettings({
      whaleMinBySymbol: { ...settings.orderflow.whaleMinBySymbol, [symbol]: value },
      presetId: 'custom',
    })
  }

  const resetSymbolThreshold = () => {
    const whaleMinBySymbol = { ...settings.orderflow.whaleMinBySymbol }
    delete whaleMinBySymbol[symbol]
    updateOrderflowSettings({ whaleMinBySymbol, presetId: 'custom' })
    showToast(`${symbol} için genel eşik tabanı kullanılacak.`, 'success')
  }

  return (
    <div className="page page--settings">
      <div className="page-heading">
        <div><span className="eyebrow">TERCİHLER VE VERİ DENETİMİ</span><h1>Ayarlar</h1><p>Grafik, analiz ve yerel bildirim davranışını kişiselleştir.</p></div>
        <Button variant="ghost" size="sm" onClick={resetPreferences}>Varsayılanlara dön</Button>
      </div>

      <div className="settings-search-wrap">
        <label htmlFor="settings-search">Ayar ara</label>
        <input id="settings-search" type="search" placeholder="Örn. tema, RSI, bildirim, günlük limit" value={search} onChange={(event) => setSearch(event.target.value)} />
        <span className="settings-search-hint">{query ? `${visibleSections.length} bölüm` : 'Bölümler konuya göre gruplanmıştır'}</span>
      </div>

      {visibleSections.length === 0 && <Card><EmptySettings /></Card>}
      {visibleSections.map((section) => (
        <details className="settings-section" key={section.id} open={query ? true : undefined}>
          <summary><span><strong>{section.label}</strong><small>{section.content}</small></span><span className="settings-section__chevron" aria-hidden="true">⌄</span></summary>
          <div className="settings-section__body">
            {section.id === 'appearance' && <>
              <div className="settings-row"><div><strong>Tema</strong><small>Okuma konforuna göre açık veya koyu görünüm.</small></div><div className="theme-choice" role="group" aria-label="Renk teması"><Button size="sm" variant={theme === 'dark' ? 'primary' : 'secondary'} aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}><Moon size={15} aria-hidden="true" />Koyu</Button><Button size="sm" variant={theme === 'light' ? 'primary' : 'secondary'} aria-pressed={theme === 'light'} onClick={() => setTheme('light')}><Sun size={15} aria-hidden="true" />Açık</Button></div></div>
              <div className="settings-row"><div><strong>Veri bağlantısı</strong><small>Salt okunur, herkese açık {mode === 'futures' ? 'USDⓈ-M futures' : mode === 'spot-fallback' ? 'spot' : 'piyasa'} akışı.</small></div><div className="settings-status"><Badge tone={connection === 'live' ? 'positive' : connection === 'offline' ? 'negative' : 'warning'}>{connection}</Badge><Button size="sm" variant="secondary" onClick={reconnect}>Yeniden bağlan</Button></div></div>
              <div className="settings-row"><div><strong>Veri gizliliği</strong><small>Favoriler, ayarlar, sinyal geçmişi ve oturum kaydı bu tarayıcıda saklanır.</small></div><Badge tone="neutral">Yerel</Badge></div>
            </>}

            {section.id === 'chart' && <>
              <Toggle id="show-ema" label="EMA çizgileri" description="Yapılandırılabilir hızlı ve yavaş üssel ortalama." checked={settings.showEma} onChange={(value) => updateSettings({ showEma: value })} />
              <Toggle id="show-bollinger" label="Bollinger bantları" description="Hareketli ortalama çevresindeki standart sapma bantları." checked={settings.showBollinger} onChange={(value) => updateSettings({ showBollinger: value })} />
              <Toggle id="show-vwap" label="VWAP" description="Yüklenen mum aralığında hacim ağırlıklı ortalama fiyat." checked={settings.showVwap} onChange={(value) => updateSettings({ showVwap: value })} />
              <Toggle id="show-rsi" label="RSI alt paneli" description="0–100 momentumu ve 30/70 referanslarını göster." checked={settings.showRsi} onChange={(value) => updateSettings({ showRsi: value })} />
              <Toggle id="show-macd" label="MACD ölçümleri" description="Hızlı/yavaş EMA ve sinyal farkı; ayrıntılar sinyal ekranında." checked={settings.showMacd} onChange={(value) => updateSettings({ showMacd: value })} />
              <Toggle id="show-sar" label="Parabolic SAR" description="Trend dönüş noktası için parabolik izleyici çizgisi." checked={settings.showSar} onChange={(value) => updateSettings({ showSar: value })} />
              <Toggle id="show-volume" label="Hacim çubukları" description="Mum yönüyle renk kodlanan baz hacim." checked={settings.showVolume} onChange={(value) => updateSettings({ showVolume: value })} />
              <Toggle id="show-flow" label="Order flow ve DOM panelleri" description="CVD, derinlik dengesi, spread ve REST defter snapshotı." checked={settings.showFlow} onChange={(value) => updateSettings({ showFlow: value })} />
              <div className="settings-number-grid">
                <NumberSetting id="ema-fast" label="Hızlı EMA" value={settings.fastEma} min={2} max={50} onChange={(value) => updateSettings({ fastEma: Math.min(value, settings.slowEma - 1) })} />
                <NumberSetting id="ema-slow" label="Yavaş EMA" value={settings.slowEma} min={3} max={200} onChange={(value) => updateSettings({ slowEma: Math.max(value, settings.fastEma + 1) })} />
                <NumberSetting id="bb-period" label="BB periyodu" value={settings.bbPeriod} min={5} max={200} onChange={(value) => updateSettings({ bbPeriod: value })} />
                <NumberSetting id="bb-std" label="BB standart sapma" value={settings.bbStd} min={0.5} max={5} step={0.1} onChange={(value) => updateSettings({ bbStd: value })} />
                <NumberSetting id="macd-fast" label="MACD hızlı" value={settings.macdFast} min={2} max={100} onChange={(value) => updateSettings({ macdFast: value })} />
                <NumberSetting id="macd-slow" label="MACD yavaş" value={settings.macdSlow} min={3} max={200} onChange={(value) => updateSettings({ macdSlow: value })} />
                <NumberSetting id="macd-signal" label="MACD sinyal" value={settings.macdSignal} min={2} max={100} onChange={(value) => updateSettings({ macdSignal: value })} />
              </div>
            </>}

            {section.id === 'orderflow' && <>
              <div className="orderflow-preset-area">
                <div><strong>Hazır görünümler</strong><small>Görsel katman ve pusula hassasiyetini birlikte ayarlar. Sembol eşiklerini değiştirmez.</small><span className="orderflow-preset-state">{settings.orderflow.presetId === 'custom' ? 'Özel ayar' : `${ORDERFLOW_PRESET_LABELS[settings.orderflow.presetId]} preset’i etkin`}</span></div>
                <div className="orderflow-presets" role="group" aria-label="Emir akışı hazır görünümleri">
                  {(['balanced', 'scalping', 'minimal'] as const).map((presetId) => (
                    <Button key={presetId} size="sm" variant={settings.orderflow.presetId === presetId ? 'primary' : 'secondary'} aria-pressed={settings.orderflow.presetId === presetId} onClick={() => applyOrderflowPreset(presetId)}>
                      {ORDERFLOW_PRESET_LABELS[presetId]}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="settings-info-note"><ChartLineUp size={16} aria-hidden="true" /><span>Kalibrasyon sembol başına ayrı örnek toplar. “Dinamik eşik” büyük işlem algılama eşiğidir; emir üretmez veya sinyal motorunu değiştirmez.</span></div>
              <div className="orderflow-calibration-row">
                <div><strong>{symbol} · büyük işlem eşiği</strong><small>Son 30 örnek ısınma eşiğidir; yeterli veri sonrası p80 kullanılır.</small></div>
                <OrderflowCalibrationStatus symbol={symbol} mode={mode} />
              </div>
              <div className="settings-number-grid">
                <NumberSetting id="orderflow-default-threshold" label="Genel taban eşik" value={settings.orderflow.whaleMin} min={5_000} max={50_000_000} step={10_000} onChange={(value) => updateOrderflowSettings({ whaleMin: value })} suffix=" USDT" />
                <NumberSetting id="orderflow-symbol-threshold" label={`${symbol} taban eşiği`} value={currentSymbolThreshold} min={5_000} max={50_000_000} step={10_000} onChange={updateSymbolThreshold} suffix=" USDT" />
                <NumberSetting id="orderflow-wall-percentile" label="Duvar yüzdeliği" value={settings.orderflow.wallPct} min={60} max={99} onChange={(value) => updateOrderflowSettings({ wallPct: value })} suffix="%" />
                <NumberSetting id="orderflow-wall-count" label="Canlı duvar sayısı" value={settings.orderflow.liveWallCount} min={2} max={20} onChange={(value) => updateOrderflowSettings({ liveWallCount: value })} />
                <NumberSetting id="orderflow-wall-range" label="Duvar izleme aralığı" value={settings.orderflow.liveWallRange} min={0.1} max={2} step={0.1} onChange={(value) => updateOrderflowSettings({ liveWallRange: value })} suffix="% mid" />
                <NumberSetting id="orderflow-ice-ticks" label="Iceberg yakınlığı" value={settings.orderflow.compassIceTick} min={1} max={100} onChange={(value) => updateOrderflowSettings({ compassIceTick: value })} suffix="tick" />
                <NumberSetting id="orderflow-wall-ticks" label="Pusula duvar aralığı" value={settings.orderflow.compassWallTick} min={1} max={100} onChange={(value) => updateOrderflowSettings({ compassWallTick: value })} suffix="tick" />
                <div className="field-group"><label htmlFor="orderflow-compass-half">Pusula yarı ömrü</label><select id="orderflow-compass-half" value={settings.orderflow.compassHalf} onChange={(event) => updateOrderflowSettings({ compassHalf: Number(event.target.value) as 5_000 | 10_000 | 20_000 | 30_000 })}><option value={5_000}>5 saniye</option><option value={10_000}>10 saniye</option><option value={20_000}>20 saniye</option><option value={30_000}>30 saniye</option></select></div>
              </div>
              <div className="settings-row">
                <div><strong>{symbol} özel eşiği</strong><small>{hasSymbolThreshold ? 'Bu sembolün özel taban eşiği etkin.' : 'Özel eşik yok; genel taban eşik kullanılıyor.'}</small></div>
                <Button size="sm" variant="secondary" disabled={!hasSymbolThreshold} onClick={resetSymbolThreshold}>Sembol eşiğini kaldır</Button>
              </div>
              <div className="orderflow-setting-group">
                <strong>Grafik katmanları</strong>
                <Toggle id="orderflow-heatmap" label="15 dakikalık likidite ısı haritası" description="Son 900 saniyenin sınırlı DOM örneklerini fiyat/zaman üzerinde göster." checked={settings.orderflow.showHeatmap} onChange={(value) => updateOrderflowSettings({ showHeatmap: value })} />
                <Toggle id="orderflow-ladder" label="DOM kademe yoğunluğu" description="Görünen fiyat aralığındaki alış/satış notional yoğunluğu." checked={settings.orderflow.showLadder} onChange={(value) => updateOrderflowSettings({ showLadder: value })} />
                <Toggle id="orderflow-wall-rays" label="Likidite duvarı ışınları" description="Göreli büyük defter kümelerini kademelere bağlı kısa ışınlarla işaretle." checked={settings.orderflow.showWallRays} onChange={(value) => updateOrderflowSettings({ showWallRays: value })} />
                <Toggle id="orderflow-live-walls" label="Canlı duvar izleme" description="Senkronize defterdeki duvarların yaşını, değişimini ve emilimini göster." checked={settings.orderflow.showLiveWalls} onChange={(value) => updateOrderflowSettings({ showLiveWalls: value })} />
                <Toggle id="orderflow-wall-labels" label="Işın notional etiketleri" description="Grafik üzerindeki duvar ışınlarına yoğunluk değerleri ekle." checked={settings.orderflow.wallLabels} onChange={(value) => updateOrderflowSettings({ wallLabels: value })} />
                <Toggle id="orderflow-established" label="Yalnızca oturmuş duvarları göster" description="Işınlarda en az 25 saniye izlenen seviyeleri öne çıkar." checked={settings.orderflow.wallEstOnly} onChange={(value) => updateOrderflowSettings({ wallEstOnly: value })} />
                <div className="settings-number-grid">
                  <div className="field-group"><label htmlFor="orderflow-ladder-side">DOM konumu</label><select id="orderflow-ladder-side" value={settings.orderflow.ladderSide} onChange={(event) => updateOrderflowSettings({ ladderSide: event.target.value as 'left' | 'right' | 'both' })}><option value="right">Sağ</option><option value="left">Sol</option><option value="both">İki taraf</option></select></div>
                  <NumberSetting id="orderflow-ladder-width" label="Kademe genişliği" value={settings.orderflow.ladderWidth} min={24} max={96} onChange={(value) => updateOrderflowSettings({ ladderWidth: value })} suffix="px" />
                  <div className="field-group"><label htmlFor="orderflow-ray-length">Işın uzunluğu</label><select id="orderflow-ray-length" value={settings.orderflow.wallRayLen} onChange={(event) => updateOrderflowSettings({ wallRayLen: event.target.value as 'short' | 'medium' | 'long' })}><option value="short">Kısa</option><option value="medium">Orta</option><option value="long">Uzun</option></select></div>
                  <div className="field-group orderflow-opacity-setting"><label htmlFor="orderflow-wall-opacity">Katman opaklığı</label><div className="range-control"><input id="orderflow-wall-opacity" type="range" min={10} max={100} step={5} value={Math.round(settings.orderflow.wallOpacity * 100)} aria-label="Katman opaklığı" onChange={(event) => updateOrderflowSettings({ wallOpacity: Number(event.target.value) / 100 })} /><output htmlFor="orderflow-wall-opacity">{Math.round(settings.orderflow.wallOpacity * 100)}%</output></div></div>
                </div>
              </div>
              <div className="orderflow-setting-group">
                <strong>Canlı davranış ve olaylar</strong>
                <Toggle id="orderflow-pulse" label="Duvar nabzı" description="Hareketi azalt tercihi açıksa animasyon kendiliğinden durur." checked={settings.orderflow.liveWallPulse} onChange={(value) => updateOrderflowSettings({ liveWallPulse: value })} />
                <Toggle id="orderflow-flash" label="Yeni duvar parlaması" description="Yeni oluşan duvarları kısa süreyle vurgula." checked={settings.orderflow.liveWallFlash} onChange={(value) => updateOrderflowSettings({ liveWallFlash: value })} />
                <Toggle id="orderflow-live-labels" label="Canlı duvar etiketleri" description="Taraf, notional ve izleme yaşını göster." checked={settings.orderflow.liveWallLabels} onChange={(value) => updateOrderflowSettings({ liveWallLabels: value })} />
                <Toggle id="orderflow-whale-events" label="Büyük işlem olaylarını algıla" description="Dinamik sembol eşiğini geçen işlemleri işaret ve olay akışına ekle." checked={settings.orderflow.whaleAlerts} onChange={(value) => updateOrderflowSettings({ whaleAlerts: value })} />
              </div>
            </>}

            {section.id === 'signals' && <>
              <div className="settings-number-grid">
                <NumberSetting id="rsi-period" label="RSI periyodu" value={settings.rsiPeriod} min={2} max={100} onChange={(value) => updateSettings({ rsiPeriod: value })} />
                <NumberSetting id="signal-edge" label="Yön eşiği" value={settings.minSignalEdge} min={1} max={25} onChange={(value) => updateSettings({ minSignalEdge: value })} suffix=" puan" />
                <NumberSetting id="fee-bps" label="Test ücreti" value={settings.feeBps} min={0} max={100} onChange={(value) => updateSettings({ feeBps: value })} suffix=" bps/yön" />
                <div className="field-group"><label htmlFor="scanner-limit">Tarayıcı evreni</label><select id="scanner-limit" value={settings.scannerLimit} onChange={(event) => updateSettings({ scannerLimit: Number(event.target.value) as 20 | 50 })}><option value={20}>Top 20</option><option value={50}>Top 50</option></select></div>
              </div>
              <div className="settings-info-note"><Palette size={16} aria-hidden="true" /><span>Uyum puanı yalnızca kural hizalanmasını gösterir; kazanma olasılığı değildir. Backtest'te ücret giriş ve çıkış başına düşülür.</span></div>
            </>}

            {section.id === 'alerts' && <>
              <Toggle id="alerts-enabled" label="Sesli uyarılar" description="Yeni AL/SAT yönü ve seçili büyük flow olayı için kısa ses." checked={settings.alertsEnabled} onChange={(value) => updateSettings({ alertsEnabled: value })} />
              <div className="settings-row"><div><strong>Ses düzeyi</strong><small>Tarayıcı ses çıkışının yaklaşık seviyesidir.</small></div><div className="range-control"><input id="alert-volume" type="range" min={0} max={1} step={0.1} value={settings.alertVolume} aria-label="Ses düzeyi" onChange={(event) => updateSettings({ alertVolume: Number(event.target.value) })} /><output htmlFor="alert-volume">{Math.round(settings.alertVolume * 100)}%</output></div></div>
              <div className="settings-row"><div><strong>Ses denemesi</strong><small>Kısa çift tonlu örnek oynatır.</small></div><Button size="sm" variant="secondary" onClick={testSound}>Sesi dene</Button></div>
              <Toggle id="alert-vibration" label="Mobil titreşim" description="Desteklenen cihazlarda kısa titreşim; sistem bunu yok sayabilir." checked={settings.vibrationEnabled} onChange={(value) => updateSettings({ vibrationEnabled: value })} />
              <Toggle id="alert-on-signal" label="AL/SAT yön değişimi" description="Yeni bir kural yönü ilk kez oluştuğunda uyar." checked={settings.alertOnSignal} onChange={(value) => updateSettings({ alertOnSignal: value })} />
              <Toggle id="alert-on-flow" label="Büyük işlem / tasfiye olayı" description="Yalnızca uygulamanın eşik üzeri public trade/force-order olayları." checked={settings.alertOnHighFlow} onChange={(value) => updateSettings({ alertOnHighFlow: value })} />
              <Toggle id="alert-on-limit" label="Manuel günlük limit" description="Girdiğin kayıp toplamı ayarlanan sınıra ulaştığında uyar." checked={settings.alertOnLimit} onChange={(value) => updateSettings({ alertOnLimit: value })} />
              <div className="settings-row"><div><strong>Tarayıcı bildirimi</strong><small>{notificationState}</small></div><div className="settings-status"><Button size="sm" variant="secondary" onClick={requestNotificationPermission}><Bell size={15} aria-hidden="true" />İzin iste</Button><input type="checkbox" aria-label="Tarayıcı bildirimlerini etkinleştir" checked={settings.notificationsEnabled} disabled={typeof Notification === 'undefined' || Notification.permission !== 'granted'} onChange={(event) => updateSettings({ notificationsEnabled: event.target.checked })} /></div></div>
            </>}

            {section.id === 'risk' && <>
              <div className="settings-info-note settings-info-note--warning"><WarningCircle size={16} aria-hidden="true" /><span>Bu sayaç manuel girilir. Borsa hesabı, açık pozisyon veya gerçekleşmiş PnL okunmaz; limit emri engellemez.</span></div>
              <Toggle id="daily-loss-enabled" label="Manuel limit uyarısını etkinleştir" description="Manuel toplam eşiği geçtiğinde uyarı göster." checked={settings.dailyLossEnabled} onChange={(value) => updateSettings({ dailyLossEnabled: value })} />
              <div className="settings-number-grid"><NumberSetting id="daily-loss-limit" label="Günlük limit" value={settings.dailyLossLimit} min={10} max={100000} step={10} onChange={(value) => updateSettings({ dailyLossLimit: value })} suffix=" USDT" /></div>
              <div className="daily-loss-tracker"><div><span>Bugün manuel girilen toplam</span><strong className="mono">{formatCompact(dailyLoss, ' USDT')}</strong></div><div className="daily-loss-tracker__actions"><label className="sr-only" htmlFor="manual-loss-amount">Eklenecek manuel kayıp, USDT</label><input id="manual-loss-amount" type="number" min="0.01" step="0.01" value={lossInput} onChange={(event) => setLossInput(event.target.value)} placeholder="Tutar" /><Button size="sm" variant="primary" onClick={addLoss}>Kaydı ekle</Button><Button size="sm" variant="ghost" onClick={resetLoss}>Günü sıfırla</Button></div>{settings.dailyLossEnabled && <div className="progress-track" role="progressbar" aria-label="Manuel günlük limit kullanımı" aria-valuemin={0} aria-valuemax={settings.dailyLossLimit} aria-valuenow={Math.min(dailyLoss, settings.dailyLossLimit)}><span style={{ width: `${Math.min(100, dailyLoss / Math.max(1, settings.dailyLossLimit) * 100)}%` }} /></div>}</div>
            </>}
          </div>
        </details>
      ))}

      {!query && <>
        <SessionRecorderCard />
        <Card className="settings-note-card"><CardBody><div className="settings-note-icon"><CheckCircle size={18} aria-hidden="true" /></div><div><strong>Emir gönderimi kapalı</strong><p>Bu uygulama yalnızca public piyasa verisi okur; API anahtarı istemez ve trade göndermez. Futures verisine erişilemediğinde Spot yedeği ayrı etiketlenir.</p></div></CardBody></Card>
      </>}
    </div>
  )
}

function Toggle({ id, label, description, checked, onChange }: { id: string; label: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <div className="settings-row settings-row--toggle"><div><label htmlFor={id}>{label}</label><small>{description}</small></div><input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /></div>
}

function NumberSetting({ id, label, value, min, max, step = 1, suffix = '', onChange }: { id: string; label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (value: number) => void }) {
  return <div className="field-group"><label htmlFor={id}>{label}</label><div className="number-with-suffix"><input id={id} type="number" value={value} min={min} max={max} step={step} onChange={(event) => { const next = Number(event.target.value); if (Number.isFinite(next)) onChange(Math.max(min, Math.min(max, next))) }} /><span>{suffix}</span></div></div>
}

function OrderflowCalibrationStatus({ symbol, mode }: { symbol: string; mode: MarketMode }) {
  const snapshot = useOrderflow()
  const isCurrent = snapshot.symbol === symbol && snapshot.mode === mode
  const calibration = snapshot.calibration
  const threshold = isCurrent ? calibration.threshold : null
  const sampleCount = isCurrent ? calibration.samples : 0
  const warm = isCurrent && calibration.warm
  const description = !isCurrent
    ? 'Sembol verisi eşitleniyor.'
    : mode === 'offline'
      ? 'Veri kaynağı çevrimdışı; taban eşik gösterilir.'
      : warm
        ? `Otomatik p80 kalibrasyonu etkin · ${sampleCount} örnek`
        : `Taban eşik kullanılıyor · ${sampleCount}/30 kalibrasyon örneği`

  return (
    <div className="orderflow-calibration-status">
      <div><span>Etkin eşik</span><strong className="mono">{threshold == null ? '—' : formatCompact(threshold, ' USDT')}</strong></div>
      <small>{warm && calibration.p80 != null ? `${description} · p80 ${formatCompact(calibration.p80)} USDT` : description}</small>
      <div className="orderflow-calibration-progress" role="progressbar" aria-label="Sembol kalibrasyon örnekleri" aria-valuemin={0} aria-valuemax={30} aria-valuenow={Math.min(30, sampleCount)}>
        <span style={{ width: `${Math.min(100, sampleCount / 30 * 100)}%` }} />
      </div>
    </div>
  )
}

function EmptySettings() {
  return <CardBody><div className="settings-empty"><WarningCircle size={19} aria-hidden="true" /><span>Bu aramayla eşleşen ayar bölümü bulunamadı.</span></div></CardBody>
}
