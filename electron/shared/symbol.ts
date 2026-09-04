const CN_PREFIXES_SH = ['5', '6', '9']
const CN_PREFIXES_SZ = ['0', '1', '2', '3']
const CN_PREFIXES_BJ = ['4', '8']

export const MARKET_INDEXES = [
  { symbol: 'sh000001', name: '上证指数' },
  { symbol: 'sz399001', name: '深证成指' },
  { symbol: 'sz399006', name: '创业板指' },
  { symbol: 'sh000688', name: '科创50' },
  { symbol: 'bj899050', name: '北证50' },
  { symbol: 'hkHSI', name: '恒生指数' },
  { symbol: 'hkHSTECH', name: '恒生科技' },
  { symbol: 'usDJI', name: '道琼斯' },
  { symbol: 'usIXIC', name: '纳斯达克' },
  { symbol: 'usINX', name: '标普500' }
]

export function isValidSymbol(symbol: string): boolean {
  return /^(sh|sz|bj)\d{6}$|^hk\d{5}$|^us[A-Z]{1,16}$/.test(symbol)
}

export function detectMarket(symbol: string): 'cn' | 'hk' | 'us' {
  if (/^(sh|sz|bj)/.test(symbol)) return 'cn'
  if (/^hk/.test(symbol)) return 'hk'
  return 'us'
}

export function marketLabelOf(symbol: string): string {
  const market = detectMarket(symbol)
  if (market === 'cn') {
    if (symbol.startsWith('sh')) return '沪'
    if (symbol.startsWith('sz')) return '深'
    return '北'
  }
  return market === 'hk' ? '港' : '美'
}

const KNOWN_US_INDEXES = ['usDJI', 'usIXIC', 'usINX']
const KNOWN_HK_INDEXES = ['hkHSI', 'hkHSTECH']

export function normalizeSymbol(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const lower = trimmed.toLowerCase()

  if (isValidSymbol(lower)) {
    if (lower.startsWith('us')) return `us${trimmed.slice(2).toUpperCase()}`
    if (lower.startsWith('hk')) return `hk${lower.slice(2)}`
    return lower
  }
  const known = [...KNOWN_US_INDEXES, ...KNOWN_HK_INDEXES].find(
    (s) => s.toLowerCase() === lower
  )
  if (known) return known

  if (/^\d{6}$/.test(trimmed)) {
    const c = trimmed[0]
    if (CN_PREFIXES_SH.includes(c)) return `sh${trimmed}`
    if (CN_PREFIXES_SZ.includes(c)) return `sz${trimmed}`
    if (CN_PREFIXES_BJ.includes(c)) return `bj${trimmed}`
    return `sh${trimmed}`
  }
  if (/^\d{5}$/.test(trimmed)) return `hk${trimmed}`
  if (/^[A-Za-z]{1,16}$/.test(trimmed)) return `us${trimmed.toUpperCase()}`
  return null
}

export function toDisplaySymbolParts(symbol: string): { market: string; code: string } {
  const market = symbol.slice(0, 2).toUpperCase()
  return { market, code: symbol.slice(2) }
}
