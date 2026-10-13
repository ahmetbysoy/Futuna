import { clamp, ema, rsi } from '@/lib/math'
import type { AppSettings } from '@/app/AppContext'
import type { Candle, FlowSnapshot } from '@/features/market/types'

export type SignalDirection = 'AL' | 'SAT' | 'NÖTR'

export interface SignalDecision {
  direction: SignalDirection
  /** Rule-alignment index, not a probability or expected return. */
  score: number
  alignment: number
  fastValue: number | null
  slowValue: number | null
  rsiValue: number | null
  momentumPct: number | null
  reasons: string[]
  summary: string
}

export function calculateSignal(candles: Candle[], flow: FlowSnapshot, settings: AppSettings): SignalDecision {
  const neutral: SignalDecision = {
    direction: 'NÖTR', score: 50, alignment: 0,
    fastValue: null, slowValue: null, rsiValue: null, momentumPct: null,
    reasons: ['Sinyal için yeterli mum verisi bekleniyor.'],
    summary: 'Piyasa verisi ısınıyor; bu skor olasılık tahmini değildir.',
  }
  if (candles.length < Math.max(settings.slowEma + 4, settings.rsiPeriod + 3)) return neutral

  const closes = candles.map((candle) => candle.close)
  const fast = ema(closes, settings.fastEma)
  const slow = ema(closes, settings.slowEma)
  const rsiSeries = rsi(closes, settings.rsiPeriod)
  const last = candles.length - 1
  const fastValue = fast[last]
  const slowValue = slow[last]
  const rsiValue = rsiSeries[last]
  const momentumPct = candles[last - 3]?.close > 0
    ? ((closes[last] / closes[last - 3]) - 1) * 100
    : 0
  if (![fastValue, slowValue, rsiValue, momentumPct].every(Number.isFinite)) return neutral

  const trend = fastValue > slowValue ? 1 : fastValue < slowValue ? -1 : 0
  let score = 50 + trend * 16
  if (rsiValue >= 57) score += 10
  else if (rsiValue <= 43) score -= 10
  else if (rsiValue > 50) score += 4
  else if (rsiValue < 50) score -= 4
  score += clamp(momentumPct * 34, -10, 10)

  const traded = flow.buyNotional60 + flow.sellNotional60
  if (traded > 0) score += clamp((flow.cvd60 / traded) * 8, -8, 8)
  if (flow.obi != null) score += clamp(flow.obi * 7, -5, 5)
  score = Math.round(clamp(score, 3, 97))

  const edge = settings.minSignalEdge
  const direction: SignalDirection = score >= 50 + edge ? 'AL' : score <= 50 - edge ? 'SAT' : 'NÖTR'
  const alignment = Math.round(clamp(Math.abs(score - 50) * 2, 0, 100))
  const reasons: string[] = []
  reasons.push(trend > 0
    ? `EMA ${settings.fastEma}, EMA ${settings.slowEma} üzerinde.`
    : trend < 0
      ? `EMA ${settings.fastEma}, EMA ${settings.slowEma} altında.`
      : 'Hızlı ve yavaş EMA birbirine yakın.')
  reasons.push(rsiValue >= 57
    ? `RSI ${rsiValue.toFixed(1)}: yukarı yönlü momentum.`
    : rsiValue <= 43
      ? `RSI ${rsiValue.toFixed(1)}: aşağı yönlü momentum.`
      : `RSI ${rsiValue.toFixed(1)}: orta bantta.`)
  reasons.push(`Son 3 mum değişimi ${momentumPct >= 0 ? '+' : ''}${momentumPct.toFixed(2)}%.`)
  if (traded > 0) reasons.push(`60 sn CVD ${flow.cvd60 >= 0 ? 'alıcı' : 'satıcı'} tarafında.`)
  if (flow.obi != null) reasons.push(`Derinlik dengesi ${flow.obi >= 0 ? 'alış' : 'satış'} tarafına eğilimli.`)

  const summary = direction === 'AL'
    ? 'Yukarı yönlü teknik katmanlar çoğunlukta; emir üretmez.'
    : direction === 'SAT'
      ? 'Aşağı yönlü teknik katmanlar çoğunlukta; emir üretmez.'
      : 'Katmanlar net bir yönde birleşmedi; bekle-gör.'

  return { direction, score, alignment, fastValue, slowValue, rsiValue, momentumPct, reasons, summary }
}
