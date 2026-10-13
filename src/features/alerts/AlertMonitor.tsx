import { useEffect, useRef } from 'react'
import { useApp } from '@/app/AppContext'
import { useMarket } from '@/features/market/MarketContext'
import { useDecision } from '@/features/signals/DecisionContext'

export function AlertMonitor() {
  const { settings } = useApp()
  const { symbol, flow } = useMarket()
  const { decision } = useDecision()
  const initializedRef = useRef(false)
  const previousDirectionRef = useRef(decision.direction)
  const lastFlowIdRef = useRef<string | null>(flow.events[0]?.id ?? null)

  useEffect(() => {
    if (!initializedRef.current) {
      previousDirectionRef.current = decision.direction
      initializedRef.current = true
      return
    }
    const previous = previousDirectionRef.current
    previousDirectionRef.current = decision.direction
    if (settings.alertsEnabled && settings.alertOnSignal && decision.direction !== 'NÖTR' && decision.direction !== previous) {
      dispatchAlert(
        `${symbol} · ${decision.direction} kural yönü`,
        `${decision.summary} Katman uyumu ${decision.alignment}/100.`,
        settings.alertVolume,
        settings.notificationsEnabled,
        settings.vibrationEnabled,
        decision.direction === 'AL' ? 880 : 520,
      )
    }
  }, [decision.direction, decision.summary, decision.alignment, symbol, settings.alertsEnabled, settings.alertOnSignal, settings.alertVolume, settings.notificationsEnabled, settings.vibrationEnabled])

  useEffect(() => {
    const latest = flow.events[0]
    if (!latest || latest.id === lastFlowIdRef.current) return
    lastFlowIdRef.current = latest.id
    if (!initializedRef.current || !settings.alertsEnabled || !settings.alertOnHighFlow) return
    dispatchAlert(
      `${latest.symbol} · ${latest.label}`,
      `${latest.notional.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} USDT · fiyat ${latest.price.toLocaleString('tr-TR', { maximumFractionDigits: 4 })}`,
      settings.alertVolume,
      settings.notificationsEnabled,
      settings.vibrationEnabled,
      latest.kind === 'buy' ? 820 : latest.kind === 'sell' ? 490 : 660,
    )
  }, [flow.events, settings.alertsEnabled, settings.alertOnHighFlow, settings.alertVolume, settings.notificationsEnabled, settings.vibrationEnabled])

  return null
}

function dispatchAlert(title: string, body: string, volume: number, notify: boolean, vibrate: boolean, frequency: number) {
  if (volume > 0 && typeof window.AudioContext !== 'undefined') {
    try {
      const context = new AudioContext()
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      gain.gain.setValueAtTime(Math.max(0.001, Math.min(1, volume) * 0.085), context.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.22)
      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start()
      oscillator.stop(context.currentTime + 0.23)
      oscillator.onended = () => void context.close()
    } catch { /* Ses yoksa diğer bildirim kanalları çalışmaya devam eder. */ }
  }
  if (vibrate && typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.([90, 45, 90])
  if (notify && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    const notification = new Notification(title, { body, tag: 'futures-scanner-alert' })
    notification.onclick = () => { window.focus(); notification.close() }
  }
}
