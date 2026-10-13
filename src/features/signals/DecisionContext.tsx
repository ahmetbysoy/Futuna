import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useApp } from '@/app/AppContext'
import { readStorage, writeStorage } from '@/lib/storage'
import { useMarket } from '@/features/market/MarketContext'
import { calculateSignal, type SignalDecision, type SignalDirection } from './signalEngine'

export interface SignalEvent {
  id: string
  symbol: string
  direction: Exclude<SignalDirection, 'NÖTR'>
  price: number
  score: number
  timestamp: number
  reason: string
}

interface DecisionContextValue {
  decision: SignalDecision
  history: SignalEvent[]
  clearHistory: () => void
}

const DecisionContext = createContext<DecisionContextValue | null>(null)

export function DecisionProvider({ children }: { children: ReactNode }) {
  const { candles, flow, symbol } = useMarket()
  const { settings } = useApp()
  const decision = useMemo(() => calculateSignal(candles, flow, settings), [candles, flow, settings])
  const [history, setHistory] = useState<SignalEvent[]>(() => readStorage('fs.signal-history.v1', []))
  const lastRecordRef = useRef<string | null>(null)

  useEffect(() => {
    const latest = candles.at(-1)
    if (!latest || decision.direction === 'NÖTR' || candles.length < settings.slowEma + 5) return
    const signalKey = `${symbol}:${decision.direction}:${Math.floor(latest.time / 60)}`
    if (lastRecordRef.current === signalKey) return
    const last = history[0]
    const shouldLog = !last || last.symbol !== symbol || last.direction !== decision.direction || Date.now() - last.timestamp > 30 * 60_000
    lastRecordRef.current = signalKey
    if (!shouldLog) return
    const event: SignalEvent = {
      id: `${symbol}-${latest.time}-${decision.direction}`,
      symbol,
      direction: decision.direction,
      price: latest.close,
      score: decision.score,
      timestamp: Date.now(),
      reason: decision.reasons[0] ?? decision.summary,
    }
    setHistory((current) => [event, ...current].slice(0, 100))
  }, [candles, decision, history, settings.slowEma, symbol])

  useEffect(() => writeStorage('fs.signal-history.v1', history), [history])

  const clearHistory = useCallback(() => setHistory([]), [])
  const value = useMemo(() => ({ decision, history, clearHistory }), [decision, history, clearHistory])
  return <DecisionContext.Provider value={value}>{children}</DecisionContext.Provider>
}

export function useDecision() {
  const context = useContext(DecisionContext)
  if (!context) throw new Error('useDecision must be used inside DecisionProvider')
  return context
}
