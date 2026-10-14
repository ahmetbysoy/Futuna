import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useApp } from '@/app/AppContext'
import { useMarket } from '@/features/market/MarketContext'
import { useDecision } from '@/features/signals/DecisionContext'
import { readStorage, writeStorage } from '@/lib/storage'
import { orderflowStore } from '@/features/orderflow/orderflowStore'
import type { FlowEventRecord } from '@/features/orderflow/types'
import { FLOW_OUTCOME_WINDOWS_SECONDS, expectedFlowDirection, isFlowEventType, measureFlowOutcome, type FlowOutcomeDirection } from './outcomes'

export type SessionFormat = 'md' | 'html' | 'json'
export interface SessionEvent {
  id: string
  timestamp: number
  type: string
  data: Record<string, string | number | boolean | null>
}
interface PendingFlowOutcome {
  sessionId: string
  sourceId: string
  eventType: FlowEventRecord['type']
  symbol: string
  referencePrice: number
  expectedDirection: FlowOutcomeDirection | null
  observedAt: number
  nextWindowIndex: number
}

export interface SessionRecord {
  id: string
  symbol: string
  timeframe: string
  startedAt: number
  maxMinutes: number
  startPrice: number
  lastPrice: number
  endPrice: number | null
  endedAt: number | null
  endReason: string | null
  events: SessionEvent[]
}
interface PersistedSessions { active: SessionRecord | null; history: SessionRecord[] }
interface SessionContextValue {
  active: SessionRecord | null
  history: SessionRecord[]
  startSession: () => boolean
  stopSession: (reason?: string) => void
  clearHistory: () => void
  downloadReport: (format: SessionFormat, includePrompt: boolean) => void
}

const STORAGE_KEY = 'fs.session-recorder.v1'
const MAX_PENDING_FLOW_OUTCOMES = 100
const SessionContext = createContext<SessionContextValue | null>(null)

function getInitial(): PersistedSessions {
  const saved = readStorage<Partial<PersistedSessions>>(STORAGE_KEY, {})
  return {
    active: saved.active && Array.isArray(saved.active.events) ? saved.active : null,
    history: Array.isArray(saved.history) ? saved.history.slice(0, 10) : [],
  }
}

function makeEvent(type: string, data: SessionEvent['data'], timestamp = Date.now()): SessionEvent {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, timestamp, type, data }
}

function eventSignature(timestamp: number, price: number | null | undefined, notional: number | null | undefined) {
  return `${Math.trunc(timestamp)}|${price ?? ''}|${notional ?? ''}`
}

function addBoundedSignature(signatures: Set<string>, signature: string, limit = 500) {
  if (signatures.has(signature)) return
  if (signatures.size >= limit) signatures.delete(signatures.values().next().value as string)
  signatures.add(signature)
}

function makeFlowOutcomeEvent(
  pending: PendingFlowOutcome,
  windowSeconds: number,
  observedPrice: number | null,
  observedAt: number,
  status: string,
  quoteUpdatedAt: number | null,
) {
  const measured = measureFlowOutcome(pending.referencePrice, observedPrice, pending.expectedDirection)
  return makeEvent('ORDERFLOW_OUTCOME', {
    source: 'orderflow',
    sourceId: pending.sourceId,
    eventType: pending.eventType,
    symbol: pending.symbol,
    windowSeconds,
    observedAfterSeconds: Math.max(0, Math.round((observedAt - pending.observedAt) / 1_000)),
    referencePrice: pending.referencePrice,
    observedPrice,
    quoteUpdatedAt,
    returnPct: measured.returnPct,
    expectedDirection: pending.expectedDirection,
    directionCorrect: measured.directionCorrect,
    status,
  }, observedAt)
}

function restorePendingFlowOutcomes(record: SessionRecord | null) {
  if (!record) return []
  const completed = new Map<string, Set<number>>()
  const candidates = new Map<string, PendingFlowOutcome>()

  for (const event of record.events) {
    const sourceId = event.data.sourceId
    if (typeof sourceId !== 'string') continue
    if (event.type === 'ORDERFLOW_OUTCOME') {
      const windowSeconds = event.data.windowSeconds
      if (typeof windowSeconds !== 'number') continue
      const windows = completed.get(sourceId) ?? new Set<number>()
      windows.add(windowSeconds)
      completed.set(sourceId, windows)
      continue
    }
    if (!event.type.startsWith('ORDERFLOW_')) continue
    const eventType = event.data.eventType
    const referencePrice = event.data.outcomeReferencePrice ?? event.data.price
    const capturedAt = event.data.capturedAt
    if (!isFlowEventType(eventType) || typeof referencePrice !== 'number' || referencePrice <= 0) continue
    const expectedDirection = event.data.expectedDirection === 'LONG' || event.data.expectedDirection === 'SHORT'
      ? event.data.expectedDirection
      : null
    candidates.set(sourceId, {
      sessionId: record.id,
      sourceId,
      eventType,
      symbol: record.symbol,
      referencePrice,
      expectedDirection,
      observedAt: typeof capturedAt === 'number' ? capturedAt : event.timestamp,
      nextWindowIndex: 0,
    })
  }

  const pending: PendingFlowOutcome[] = []
  for (const candidate of candidates.values()) {
    const windows = completed.get(candidate.sourceId)
    while (candidate.nextWindowIndex < FLOW_OUTCOME_WINDOWS_SECONDS.length
      && windows?.has(FLOW_OUTCOME_WINDOWS_SECONDS[candidate.nextWindowIndex])) {
      candidate.nextWindowIndex += 1
    }
    if (candidate.nextWindowIndex < FLOW_OUTCOME_WINDOWS_SECONDS.length) pending.push(candidate)
  }
  return pending.slice(-MAX_PENDING_FLOW_OUTCOMES)
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const { symbol, timeframe, mode, quote, flow, connection } = useMarket()
  const { decision } = useDecision()
  const { settings, showToast } = useApp()
  const initial = useMemo(getInitial, [])
  const initialPendingOutcomes = useMemo(() => restorePendingFlowOutcomes(initial.active), [initial.active])
  const [active, setActive] = useState<SessionRecord | null>(initial.active)
  const [history, setHistory] = useState<SessionRecord[]>(initial.history)
  const activeRef = useRef<SessionRecord | null>(initial.active)
  const historyRef = useRef<SessionRecord[]>(initial.history)
  const latestRef = useRef({ symbol, timeframe, mode, quote, flow, connection, decision })
  const lastEventIdsRef = useRef(new Set<string>())
  const orderflowSignaturesRef = useRef(new Set<string>())
  const pendingOutcomesRef = useRef<PendingFlowOutcome[]>(initialPendingOutcomes)
  const lastPriceSampleAtRef = useRef(initial.active?.events.filter((event) => event.type === 'PRICE_SAMPLE').at(-1)?.timestamp ?? initial.active?.startedAt ?? 0)
  const lastSignalRef = useRef<string | null>(null)
  latestRef.current = { symbol, timeframe, mode, quote, flow, connection, decision }
  activeRef.current = active
  historyRef.current = history

  useEffect(() => writeStorage(STORAGE_KEY, { active, history }), [active, history])

  const pushEvent = useCallback((type: string, data: SessionEvent['data'], timestamp?: number) => {
    const current = activeRef.current
    if (!current) return
    const next = { ...current, events: [...current.events, makeEvent(type, data, timestamp)].slice(-2_000) }
    activeRef.current = next
    setActive(next)
  }, [])

  const finish = useCallback((reason: string, auto = false) => {
    const current = activeRef.current
    if (!current) return
    const latest = latestRef.current
    const finalPrice = latest.symbol === current.symbol && latest.quote.lastPrice != null ? latest.quote.lastPrice : current.lastPrice
    const endedAt = Date.now()
    const incompleteOutcomes = pendingOutcomesRef.current
      .filter((pending) => pending.sessionId === current.id)
      .flatMap((pending) => FLOW_OUTCOME_WINDOWS_SECONDS.slice(pending.nextWindowIndex)
        .map((windowSeconds) => makeFlowOutcomeEvent(pending, windowSeconds, null, endedAt, 'session-ended', null)))
    const event = makeEvent('SESSION_END', { reason, endPrice: finalPrice, durationSeconds: Math.round((endedAt - current.startedAt) / 1_000) })
    const closed: SessionRecord = {
      ...current,
      lastPrice: finalPrice,
      endPrice: finalPrice,
      endedAt,
      endReason: reason,
      events: [...current.events, ...incompleteOutcomes, event].slice(-2_000),
    }
    const nextHistory = [closed, ...historyRef.current.filter((item) => item.id !== closed.id)].slice(0, 10)
    activeRef.current = null
    lastEventIdsRef.current.clear()
    orderflowSignaturesRef.current.clear()
    pendingOutcomesRef.current = pendingOutcomesRef.current.filter((pending) => pending.sessionId !== current.id)
    historyRef.current = nextHistory
    setActive(null)
    setHistory(nextHistory)
    if (auto) showToast(`Oturum kaydı ${reason === 'max_süre' ? 'belirlenen süre sonunda' : 'otomatik olarak'} durduruldu.`, 'warning')
  }, [showToast])

  const startSession = useCallback(() => {
    if (activeRef.current) return false
    const current = latestRef.current
    if (current.quote.lastPrice == null || !Number.isFinite(current.quote.lastPrice)) return false
    const startedAt = Date.now()
    const record: SessionRecord = {
      id: `session-${startedAt}`,
      symbol: current.symbol,
      timeframe: current.timeframe,
      startedAt,
      maxMinutes: settings.sessionMaxMinutes,
      startPrice: current.quote.lastPrice,
      lastPrice: current.quote.lastPrice,
      endPrice: null,
      endedAt: null,
      endReason: null,
      events: [makeEvent('SESSION_START', {
        symbol: current.symbol,
        timeframe: current.timeframe,
        startPrice: current.quote.lastPrice,
        marketMode: current.mode,
        connection: current.connection,
        initialDirection: current.decision.direction,
      })],
    }
    activeRef.current = record
    setActive(record)
    lastEventIdsRef.current.clear()
    orderflowSignaturesRef.current.clear()
    pendingOutcomesRef.current = []
    lastSignalRef.current = null
    lastPriceSampleAtRef.current = startedAt
    showToast('Oturum kaydı başladı. Veriler yalnızca bu cihazda saklanır.', 'success')
    return true
  }, [settings.sessionMaxMinutes, showToast])

  const stopSession = useCallback((reason = 'manuel') => finish(reason, false), [finish])
  const clearHistory = useCallback(() => {
    historyRef.current = []
    setHistory([])
  }, [])

  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => {
      const current = activeRef.current
      if (!current) return
      const now = Date.now()
      const latest = latestRef.current
      if (now - current.startedAt >= current.maxMinutes * 60_000) {
        finish('max_süre', true)
        return
      }
      let next = current
      const outcomeEvents: SessionEvent[] = []
      const pendingOutcomes: PendingFlowOutcome[] = []
      for (const pending of pendingOutcomesRef.current) {
        if (pending.sessionId !== current.id) continue
        while (pending.nextWindowIndex < FLOW_OUTCOME_WINDOWS_SECONDS.length) {
          const windowSeconds = FLOW_OUTCOME_WINDOWS_SECONDS[pending.nextWindowIndex]
          if (now - pending.observedAt < windowSeconds * 1_000) break
          const quoteUpdatedAt = latest.quote.updatedAt
          const sameSymbol = latest.symbol === pending.symbol && current.symbol === pending.symbol
          const freshQuote = quoteUpdatedAt != null && now >= quoteUpdatedAt && now - quoteUpdatedAt <= 30_000
          const observedPrice = sameSymbol && freshQuote && latest.quote.lastPrice != null && Number.isFinite(latest.quote.lastPrice)
            ? latest.quote.lastPrice
            : null
          const status = !sameSymbol ? 'symbol-unavailable' : observedPrice == null ? 'price-unavailable' : 'complete'
          outcomeEvents.push(makeFlowOutcomeEvent(pending, windowSeconds, observedPrice, now, status, quoteUpdatedAt))
          pending.nextWindowIndex += 1
        }
        if (pending.nextWindowIndex < FLOW_OUTCOME_WINDOWS_SECONDS.length) pendingOutcomes.push(pending)
      }
      pendingOutcomesRef.current = pendingOutcomes
      if (outcomeEvents.length > 0) next = { ...next, events: [...next.events, ...outcomeEvents].slice(-2_000) }
      if (now - lastPriceSampleAtRef.current >= 15_000 && latest.symbol === current.symbol && latest.quote.lastPrice != null) {
        const priceEvent = makeEvent('PRICE_SAMPLE', { price: latest.quote.lastPrice, connection: latest.connection })
        next = { ...next, lastPrice: latest.quote.lastPrice, events: [...next.events, priceEvent].slice(-2_000) }
        lastPriceSampleAtRef.current = now
      }
      if (next !== current) {
        activeRef.current = next
        setActive(next)
      }
    }, 1_000)
    return () => window.clearInterval(timer)
  }, [active?.id, finish])

  useEffect(() => {
    const current = activeRef.current
    if (!current) return
    if (symbol !== current.symbol) {
      const key = `symbol:${symbol}`
      if (!lastEventIdsRef.current.has(key)) {
        addBoundedSignature(lastEventIdsRef.current, key, 2_500)
        pushEvent('SYMBOL_CHANGED', { from: current.symbol, to: symbol, note: 'Recorder remains attached to the original symbol.' })
      }
    }
  }, [symbol, active?.id, pushEvent])

  useEffect(() => orderflowStore.subscribeEvents((event) => {
    const current = activeRef.current
    const latest = latestRef.current
    const raw = orderflowStore.getRawState()
    if (!current || latest.symbol !== current.symbol || raw.symbol !== current.symbol || event.ts < current.startedAt) return
    if (lastEventIdsRef.current.has(event.id)) return
    addBoundedSignature(lastEventIdsRef.current, event.id, 2_500)
    if (event.type === 'WHALE' || event.type === 'LIQUIDATION') {
      addBoundedSignature(orderflowSignaturesRef.current, eventSignature(event.ts, event.price, event.notional))
    }
    const type = `ORDERFLOW_${event.type.replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '')}`
    const observedAt = Date.now()
    const referencePrice = event.source === 'depth'
      ? latest.quote.lastPrice ?? event.price
      : event.price ?? latest.quote.lastPrice
    const expectedDirection = expectedFlowDirection(event)
    if (referencePrice != null && Number.isFinite(referencePrice) && referencePrice > 0) {
      if (pendingOutcomesRef.current.length >= MAX_PENDING_FLOW_OUTCOMES) pendingOutcomesRef.current.shift()
      pendingOutcomesRef.current.push({
        sessionId: current.id,
        sourceId: event.id,
        eventType: event.type,
        symbol: current.symbol,
        referencePrice,
        expectedDirection,
        observedAt,
        nextWindowIndex: 0,
      })
    }
    pushEvent(type, {
      source: 'orderflow',
      sourceId: event.id,
      eventType: event.type,
      severity: event.sev,
      marketMode: raw.mode,
      side: event.side ?? null,
      price: event.price ?? null,
      notional: event.notional ?? null,
      description: event.text,
      capturedAt: observedAt,
      outcomeReferencePrice: referencePrice != null && Number.isFinite(referencePrice) && referencePrice > 0 ? referencePrice : null,
      expectedDirection,
    }, event.ts)
  }), [pushEvent])

  useEffect(() => {
    const current = activeRef.current
    if (!current || symbol !== current.symbol) return
    for (const item of [...flow.events].reverse()) {
      if (item.timestamp < current.startedAt || lastEventIdsRef.current.has(item.id)) continue
      const signature = eventSignature(item.timestamp, item.price, item.notional)
      if (orderflowSignaturesRef.current.has(signature)) {
        addBoundedSignature(lastEventIdsRef.current, item.id, 2_500)
        continue
      }
      addBoundedSignature(lastEventIdsRef.current, item.id, 2_500)
      pushEvent(item.kind === 'liquidation' ? 'LIQUIDATION' : 'LARGE_TRADE', {
        symbol: item.symbol,
        side: item.kind,
        price: item.price,
        notional: item.notional,
        label: item.label,
      })
    }
  }, [flow.events, symbol, active?.id, pushEvent])

  useEffect(() => {
    const current = activeRef.current
    if (!current || symbol !== current.symbol || (decision.direction !== 'AL' && decision.direction !== 'SAT')) return
    const candleTime = latestRef.current.quote.updatedAt ?? Math.floor(Date.now() / 60_000)
    const key = `${symbol}:${decision.direction}:${Math.floor(candleTime / 60_000)}`
    if (lastSignalRef.current === key) return
    lastSignalRef.current = key
    pushEvent('SIGNAL', { symbol, direction: decision.direction, alignment: decision.alignment, summary: decision.summary })
  }, [decision, symbol, active?.id, pushEvent])

  const downloadReport = useCallback((format: SessionFormat, includePrompt: boolean) => {
    const record = activeRef.current ?? historyRef.current[0]
    if (!record) return
    const content = serializeSession(record, format, includePrompt)
    const extension = format === 'md' ? 'md' : format
    const mime = format === 'json' ? 'application/json' : format === 'html' ? 'text/html' : 'text/markdown'
    const blob = new Blob([content], { type: `${mime};charset=utf-8` })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `futures-session-${record.symbol}-${new Date(record.startedAt).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.${extension}`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
    showToast(`Oturum ${extension.toUpperCase()} olarak indirildi.`, 'success')
  }, [showToast])

  const value = useMemo(() => ({ active, history, startSession, stopSession, clearHistory, downloadReport }), [active, history, startSession, stopSession, clearHistory, downloadReport])
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSessionRecorder() {
  const context = useContext(SessionContext)
  if (!context) throw new Error('useSessionRecorder must be used inside SessionProvider')
  return context
}

function serializeSession(record: SessionRecord, format: SessionFormat, includePrompt: boolean) {
  const payload = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    session: record,
    limitations: ['Yalnızca bu tarayıcıdaki oturum verisi.', 'Borsa kimlik bilgisi veya emir işlemi toplanmaz.', 'Piyasa olayları örneklenmiş açık veridir; tam borsa olay günlüğü değildir.'],
  }
  if (format === 'json') return JSON.stringify(payload, null, 2)
  const duration = record.endedAt == null ? Math.max(0, Date.now() - record.startedAt) : record.endedAt - record.startedAt
  const minutes = Math.floor(duration / 60_000)
  const seconds = Math.floor((duration % 60_000) / 1_000)
  const prompt = includePrompt ? '# Analiz isteği\nBu oturum raporunu özetle. Kamuya açık piyasa olaylarını ve fiyat örneklerini birbirinden ayır; belirsizlikleri, ücretleri ve örnekleme sınırlarını belirt. Sonuçları tahmin veya yatırım tavsiyesi olarak sunma.\n\n---\n\n' : ''
  if (format === 'md') {
    const lines = [prompt, '# Futures Scanner — oturum raporu', '', `- Sembol: **${record.symbol}**`, `- Zaman aralığı: **${record.timeframe}**`, `- Başlangıç: ${new Date(record.startedAt).toLocaleString('tr-TR')}`, `- Süre: ${minutes} dk ${seconds} sn`, `- Başlangıç fiyatı: ${record.startPrice}`, `- Son fiyat: ${record.endPrice ?? record.lastPrice}`, `- Olay sayısı: ${record.events.length}`, '', '## Olay özeti', '']
    const counts = new Map<string, number>()
    record.events.forEach((event) => counts.set(event.type, (counts.get(event.type) ?? 0) + 1))
    counts.forEach((count, type) => lines.push(`- ${type}: ${count}`))
    lines.push('', '## Zaman çizelgesi', '')
    record.events.forEach((event) => lines.push(`### ${new Date(event.timestamp).toLocaleTimeString('tr-TR')} · ${event.type}`, '', `\`${JSON.stringify(event.data)}\``, ''))
    lines.push('> Bu kayıt yerel ve örneklenmiştir. Tam DOM akışı ya da borsa hesabı verisi içermez.')
    return lines.join('\n')
  }
  const escape = (text: string) => text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char)
  const rows = record.events.map((event) => `<tr><td>${escape(new Date(event.timestamp).toLocaleTimeString('tr-TR'))}</td><th>${escape(event.type)}</th><td><code>${escape(JSON.stringify(event.data))}</code></td></tr>`).join('')
  const promptBlock = includePrompt ? '<section><h2>Analiz isteği</h2><p>Bu oturum raporunu özetle. Kamuya açık piyasa olaylarını ve fiyat örneklerini ayır; belirsizlikleri ve örnekleme sınırlarını belirt. Tahmin veya yatırım tavsiyesi sunma.</p></section>' : ''
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Oturum raporu — ${escape(record.symbol)}</title><style>body{font:15px/1.55 system-ui,sans-serif;max-width:980px;margin:32px auto;padding:0 18px;color:#edf4f0;background:#101714}h1,h2{color:#8bd7b0}section{padding:14px;background:#19231e;border:1px solid #32443a;border-radius:12px;margin:18px 0}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px;border-bottom:1px solid #2b3931;vertical-align:top}code{white-space:pre-wrap;overflow-wrap:anywhere;color:#c7d8ce}.note{color:#b6c8bd}</style></head><body><h1>Futures Scanner — ${escape(record.symbol)} oturumu</h1><p class="note">${new Date(record.startedAt).toLocaleString('tr-TR')} · ${minutes} dk ${seconds} sn · ${record.events.length} olay</p>${promptBlock}<section><h2>Özet</h2><p>Zaman aralığı: ${escape(record.timeframe)} · Başlangıç: ${record.startPrice} · Son: ${record.endPrice ?? record.lastPrice}</p><p class="note">Bu kayıt yerel ve örneklenmiştir; tam DOM akışı veya borsa hesabı verisi içermez.</p></section><h2>Zaman çizelgesi</h2><table><thead><tr><th>Saat</th><th>Tür</th><th>Veri</th></tr></thead><tbody>${rows}</tbody></table></body></html>`
}
