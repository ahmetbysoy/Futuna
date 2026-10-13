export function compactNotional(value: number) {
  const amount = Math.abs(value)
  const sign = value < 0 ? '−' : ''
  if (amount >= 1_000_000_000) return `${sign}${(amount / 1_000_000_000).toFixed(1)}B`
  if (amount >= 1_000_000) return `${sign}${(amount / 1_000_000).toFixed(1)}M`
  if (amount >= 1_000) return `${sign}${(amount / 1_000).toFixed(1)}K`
  return `${sign}${Math.round(amount)}`
}

export function formatPrice(price: number) {
  return price.toLocaleString('tr-TR', { maximumFractionDigits: 8 })
}
