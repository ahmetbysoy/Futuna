const trNumber = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 })
const trCompact = new Intl.NumberFormat('tr-TR', { notation: 'compact', maximumFractionDigits: 2 })

export function formatPrice(value: number | null | undefined, maxDecimals = 2): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const decimals = value >= 1000 ? Math.min(maxDecimals, 2) : value >= 1 ? Math.min(maxDecimals, 4) : Math.min(maxDecimals, 8)
  return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: decimals }).format(value)
}

export function formatSigned(value: number | null | undefined, suffix = '%', digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toLocaleString('tr-TR', { maximumFractionDigits: digits, minimumFractionDigits: digits })}${suffix}`
}

export function formatCompact(value: number | null | undefined, suffix = ''): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${trCompact.format(value)}${suffix}`
}

export function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return value.toLocaleString('tr-TR', { maximumFractionDigits: digits })
}

export function formatFunding(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${value >= 0 ? '+' : ''}${(value * 100).toLocaleString('tr-TR', { maximumFractionDigits: 4 })}%`
}

export function formatTime(value: number | null | undefined): string {
  if (value == null) return '—'
  return new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(value)
}

export function formatDateTime(value: number | null | undefined): string {
  if (value == null) return '—'
  return new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(value)
}

export function signedClass(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'tone-neutral'
  return value > 0 ? 'tone-positive' : value < 0 ? 'tone-negative' : 'tone-neutral'
}

export { trNumber }
