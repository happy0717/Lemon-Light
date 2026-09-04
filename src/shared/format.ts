import type { Quote } from '@shared/types'

export function formatPrice(value: number, quote?: Quote): string {
  const digits = quote?.currencyCode === 'USD' || quote?.currencyCode === 'HKD' ? 2 : 2
  return value.toFixed(digits)
}

export function formatChangePercent(value: number): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

export function formatChange(value: number): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}`
}

export function formatAmount(value: number): string {
  if (value >= 1e12) return `${(value / 1e12).toFixed(2)}万亿`
  if (value >= 1e8) return `${(value / 1e8).toFixed(2)}亿`
  if (value >= 1e4) return `${(value / 1e4).toFixed(2)}万`
  return value.toFixed(0)
}

export function formatVolume(value: number): string {
  if (value >= 1e8) return `${(value / 1e8).toFixed(2)}亿手`
  if (value >= 1e4) return `${(value / 1e4).toFixed(2)}万手`
  return `${value.toFixed(0)}手`
}

export function trendClass(value: number): string {
  if (value > 0) return 'up'
  if (value < 0) return 'down'
  return 'flat'
}

export function hexToRgba(hex: string, alpha: number): string {
  let h = hex.replace('#', '').trim()
  if (!h) h = '0d0f13'
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('')
  }
  const n = parseInt(h.slice(0, 6), 16)
  if (Number.isNaN(n)) return `rgba(13, 15, 19, ${alpha})`
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return `rgba(${r}, ${g}, ${b}, ${Math.min(Math.max(alpha, 0), 1)})`
}

export function readableOnBackground(bg: string): string {
  let h = bg.replace('#', '')
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('')
  }
  const n = parseInt(h.slice(0, 6), 16)
  if (Number.isNaN(n)) return '#e9ecf1'
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.62 ? '#0d0f13' : '#e9ecf1'
}
