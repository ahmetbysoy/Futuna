import { systemClock, type Clock } from '../clock'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface FlowCalibrationStatus {
  warm: boolean
  samples: number
  threshold: number
  wallMin: number
  bigWhale: number
  p50: number | null
  p80: number | null
  p95: number | null
}

const MAX_SAMPLES = 500
const WARM_MIN = 30
const SAVE_INTERVAL_MS = 60_000
const MEMORY_TTL_MS = 24 * 60 * 60_000
const STORAGE_PREFIX = 'fs_cal_'

export class FlowCalibrator {
  private samples: number[] = []
  private lastSave = 0
  private symbol = ''
  private whaleMin = 300_000

  constructor(
    private readonly clock: Clock = systemClock,
    private readonly storage?: StorageLike,
  ) {}

  reset(symbol: string, whaleMin = this.whaleMin, now = this.clock.now()) {
    this.symbol = symbol.toUpperCase()
    this.whaleMin = this.normalizeWhaleMin(whaleMin)
    this.samples = []
    this.lastSave = 0
    this.load(now)
  }

  setFallback(whaleMin: number) {
    this.whaleMin = this.normalizeWhaleMin(whaleMin)
  }

  add(notional: number, now = this.clock.now()) {
    if (!Number.isFinite(notional) || notional <= 0) return
    this.samples.push(notional)
    if (this.samples.length > MAX_SAMPLES) this.samples.shift()
    if (now - this.lastSave >= SAVE_INTERVAL_MS && this.isWarm()) {
      this.save(now)
      this.lastSave = now
    }
  }

  isWarm() {
    return this.samples.length >= WARM_MIN
  }

  sampleCount() {
    return this.samples.length
  }

  percentile(percentile: number): number | null {
    if (this.samples.length === 0) return null
    const p = Math.max(0, Math.min(1, percentile))
    const sorted = [...this.samples].sort((left, right) => left - right)
    const index = Math.min(sorted.length - 1, Math.floor(sorted.length * p))
    return sorted[index]
  }

  threshold() {
    if (!this.isWarm()) return Math.max(5_000, this.whaleMin)
    const p80 = this.percentile(0.80) ?? 0
    const floor = Math.max(1_000, this.whaleMin * 0.01)
    return Math.max(floor, p80)
  }

  wallThreshold() {
    if (!this.isWarm()) return this.threshold() * 0.08
    return Math.max(100, this.percentile(0.50) ?? 0)
  }

  bigThreshold() {
    if (!this.isWarm()) return this.threshold() * 2
    return Math.max(this.threshold(), this.percentile(0.95) ?? 0)
  }

  status(): FlowCalibrationStatus {
    const warm = this.isWarm()
    return {
      warm,
      samples: this.samples.length,
      threshold: Math.round(this.threshold()),
      wallMin: Math.round(this.wallThreshold()),
      bigWhale: Math.round(this.bigThreshold()),
      p50: warm ? Math.round(this.percentile(0.50) ?? 0) : null,
      p80: warm ? Math.round(this.percentile(0.80) ?? 0) : null,
      p95: warm ? Math.round(this.percentile(0.95) ?? 0) : null,
    }
  }

  private load(now: number) {
    if (!this.storage || !this.symbol) return
    try {
      const raw = this.storage.getItem(this.storageKey())
      if (!raw) return
      const saved = JSON.parse(raw) as { med?: number; ts?: number }
      if (!Number.isFinite(saved.ts) || !Number.isFinite(saved.med) || (saved.med ?? 0) <= 0) return
      if (now - (saved.ts ?? 0) > MEMORY_TTL_MS || now < (saved.ts ?? 0)) return
      for (let index = 0; index < 20; index += 1) this.samples.push(saved.med ?? 0)
    } catch {
      // Storage is optional: private browsing and quota restrictions are valid states.
    }
  }

  private save(now: number) {
    if (!this.storage || !this.symbol || !this.isWarm()) return
    const med = this.percentile(0.50)
    const p90 = this.percentile(0.90)
    if (med == null || p90 == null) return
    try {
      this.storage.setItem(this.storageKey(), JSON.stringify({ med, p90, ts: now }))
    } catch {
      // A storage failure must not interrupt processing of public market data.
    }
  }

  private storageKey() {
    return `${STORAGE_PREFIX}${this.symbol}`
  }

  private normalizeWhaleMin(value: number) {
    return Number.isFinite(value) && value > 0 ? value : 300_000
  }
}
