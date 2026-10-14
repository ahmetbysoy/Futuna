import { useEffect, useRef } from 'react'
import { useApp } from '@/app/AppContext'
import { useMarket } from '@/features/market/MarketContext'
import { useDecision } from '@/features/signals/DecisionContext'
import { orderflowStore } from '@/features/orderflow/orderflowStore'
import type { FlowEventRecord } from '@/features/orderflow/types'
import { formatCompact, formatPrice } from '@/lib/format'

const MAX_FLOW_ALERT_COOLDOWNS = 60

const EVENT_LABELS: Record<FlowEventRecord['type'], string> = {
  WHALE: 'Büyük işlem',
  SWEEP: 'Piyasa süpürmesi',
  'DOM SWEEP': 'Emir defteri süpürmesi',
  'ABSORPTION?': 'Olası absorpsiyon',
  'DELTA BURST': 'Delta ivmesi',
  'SPOOF?': 'Olası sahte emir',
  FILLED: 'Duvar emirleri karşılandı',
  ICEBERG: 'Gizli likidite yenilemesi',
  LIQUIDATION: 'Tasfiye',
  WALL_NEW: 'Yeni likidite duvarı',
  WALL_GROW: 'Duvar büyüyor',
  WALL_EATEN: 'Duvar tüketiliyor',
  WALL_GONE: 'Duvar çekildi',
}

function sideLabel(side: FlowEventRecord['side']) {
  if (side === 'buy' || side === 'bid') return 'Alış tarafı'
  if (side === 'sell' || side === 'ask') return 'Satış tarafı'
  if (side === 'long') return 'Long pozisyon'
  if (side === 'short') return 'Short pozisyon'
  return null
}

export function AlertMonitor() {
  const { settings } = useApp()
  const { symbol, mode } = useMarket()
  const { decision } = useDecision()
  const initializedRef = useRef(false)
  const previousDirectionRef = useRef(decision.direction)
  const lastFlowAlertAtRef = useRef(new Map<string, number>())

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

  useEffect(() => orderflowStore.subscribeEvents((event) => {
    const raw = orderflowStore.getRawState()
    if (raw.symbol !== symbol || raw.mode !== mode) return
    if (!initializedRef.current || !settings.alertsEnabled || !settings.alertOnHighFlow) return
    if (event.type !== 'WHALE' && event.type !== 'LIQUIDATION' && event.sev !== 'high') return
    const now = Date.now()
    const alertGroup = event.type === 'LIQUIDATION' ? 'LIQUIDATION' : event.type === 'WHALE' ? 'WHALE' : 'HIGH_FLOW'
    const alertKey = `${symbol}:${alertGroup}`
    const previousAlertAt = lastFlowAlertAtRef.current.get(alertKey) ?? 0
    if (now - previousAlertAt < 900) return
    lastFlowAlertAtRef.current.delete(alertKey)
    lastFlowAlertAtRef.current.set(alertKey, now)
    while (lastFlowAlertAtRef.current.size > MAX_FLOW_ALERT_COOLDOWNS) {
      const oldestKey = lastFlowAlertAtRef.current.keys().next().value as string | undefined
      if (oldestKey == null) break
      lastFlowAlertAtRef.current.delete(oldestKey)
    }

    const details = [sideLabel(event.side)]
    if (event.notional != null) details.push(`${formatCompact(event.notional)} USDT`)
    if (event.price != null) details.push(`Fiyat ${formatPrice(event.price)}`)
    const severity = event.sev === 'high' ? 'Yüksek önem' : 'Eşik üstü olay'
    const frequency = event.side === 'buy' || event.side === 'bid' || event.side === 'long'
      ? 820
      : event.side === 'sell' || event.side === 'ask' || event.side === 'short'
        ? 500
        : 660

    dispatchAlert(
      `${symbol} · ${EVENT_LABELS[event.type]}`,
      `${severity}${details.length ? ` · ${details.join(' · ')}` : ''}`,
      settings.alertVolume,
      settings.notificationsEnabled,
      settings.vibrationEnabled,
      frequency,
    )
  }), [symbol, mode, settings.alertsEnabled, settings.alertOnHighFlow, settings.alertVolume, settings.notificationsEnabled, settings.vibrationEnabled])

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
  if (vibrate && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try { navigator.vibrate?.([90, 45, 90]) } catch { /* Haptics are optional and browser-controlled. */ }
  }
  if (notify && typeof Notification !== 'undefined') {
    try {
      if (Notification.permission !== 'granted') return
      const notification = new Notification(title, { body, tag: 'futures-scanner-alert' })
      notification.onclick = () => { window.focus(); notification.close() }
    } catch { /* Notifications can be blocked after permission changes or in unsupported contexts. */ }
  }
}
