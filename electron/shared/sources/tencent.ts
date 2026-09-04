import type { DailyKline, Quote, SearchResultItem } from '../types'
import { detectMarket, isValidSymbol, marketLabelOf } from '../symbol'
import { isMarketOpen } from '../market-hours'

function decodeBuffer(buffer: ArrayBuffer, contentType: string | null): string {
  const charset = (contentType?.match(/charset=([\w-]+)/i)?.[1] ?? 'gbk').toLowerCase()
  const label = ['gbk', 'gb2312', 'gb18030'].includes(charset) ? 'gbk' : 'utf-8'
  return new TextDecoder(label).decode(buffer)
}

async function fetchText(url: string, fallbackCharset: 'gbk' | 'utf-8' = 'gbk'): Promise<string> {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const buffer = await res.arrayBuffer()
  const contentType = res.headers.get('content-type') ?? ''
  if (!/charset/i.test(contentType)) {
    return new TextDecoder(fallbackCharset).decode(buffer)
  }
  return decodeBuffer(buffer, contentType)
}

const QUOTE_RE = /v_([a-z0-9A-Z]+)="([^"]*)"/g

function parseQuoteFields(symbol: string, fields: string[]): Quote | null {
  const price = parseFloat(fields[3])
  const previousClose = parseFloat(fields[4])
  if (!Number.isFinite(price) || !Number.isFinite(previousClose)) return null

  const change = fields[31] !== undefined && fields[31] !== '' ? parseFloat(fields[31]) : price - previousClose
  const changePercent =
    fields[32] !== undefined && fields[32] !== ''
      ? parseFloat(fields[32])
      : previousClose > 0
        ? ((price - previousClose) / previousClose) * 100
        : 0

  const market = detectMarket(symbol)
  const currencyCode = market === 'us' ? 'USD' : market === 'hk' ? 'HKD' : 'CNY'
  const rawTime = fields[30] ?? ''
  const tradeDate = rawTime.slice(0, 8)
  const tradeTime = rawTime.length >= 14 ? `${rawTime.slice(8, 10)}:${rawTime.slice(10, 12)}:${rawTime.slice(12, 14)}` : ''
  const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10).replaceAll('-', '')
  const isToday = tradeDate === today

  return {
    symbol,
    code: fields[2] ?? symbol.slice(2),
    name: fields[1] ?? symbol,
    price,
    previousClose,
    open: parseFloat(fields[5]) || 0,
    high: parseFloat(fields[33]) || 0,
    low: parseFloat(fields[34]) || 0,
    change,
    changePercent,
    volume: parseFloat(fields[36]) || 0,
    amount: parseFloat(fields[37]) || 0,
    tradeTime,
    currencyCode,
    marketLabel: marketLabelOf(symbol),
    status: isToday && isMarketOpen(market) ? '开市' : '休市'
  }
}

export async function fetchTencentQuotes(symbols: string[]): Promise<Record<string, Quote>> {
  if (symbols.length === 0) return {}
  const url = `https://qt.gtimg.cn/q=${symbols.join(',')}`
  const text = await fetchText(url, 'gbk')
  const quotes: Record<string, Quote> = {}
  QUOTE_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = QUOTE_RE.exec(text)) !== null) {
    const symbol = symbols.find((s) => s.toLowerCase() === match![1].toLowerCase())
    if (!symbol) continue
    const fields = match[2].split('~')
    const quote = parseQuoteFields(symbol, fields)
    if (quote) quotes[symbol] = quote
  }
  return quotes
}

function unescapeUnicode(s: string): string {
  return s.replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)))
}

export async function searchTencent(keyword: string): Promise<SearchResultItem[]> {
  const url = `https://smartbox.gtimg.cn/s3/?v=2&t=all&c=1&q=${encodeURIComponent(keyword)}`
  const text = await fetchText(url, 'gbk')
  const raw = text.match(/v_hint="([^"]*)"/)?.[1] ?? ''
  if (!raw) return []
  const payload = unescapeUnicode(raw)
  const items: SearchResultItem[] = []
  for (const row of payload.split('^')) {
    const cols = row.split('~')
    if (cols.length < 3) continue
    const [market, code, name] = cols
    let prefix = ''
    if (market === 'sh' || market === 'sz' || market === 'bj') prefix = market
    else if (market === 'hk') prefix = 'hk'
    else if (market === 'us') prefix = 'us'
    else continue
    const symbol = `${prefix}${code}`
    if (!isValidSymbol(symbol)) continue
    items.push({ symbol, code, name, market: marketLabelOf(symbol) })
  }
  return items.slice(0, 12)
}

export async function fetchTencentDailyKline(symbol: string, limit = 60): Promise<DailyKline[]> {
  const ts = Date.now()
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},day,,,${limit},qfq&_=${ts}`
  const text = await fetchText(url, 'utf-8')
  const json = JSON.parse(text)
  const node = json?.data?.[symbol]
  const rows: unknown[][] = node?.qfqday ?? node?.day ?? []
  return rows
    .map((r) => ({
      date: String(r[0]),
      open: Number(r[1]),
      close: Number(r[2]),
      high: Number(r[3]),
      low: Number(r[4]),
      volume: Number(r[5]),
      amount: Number(r[6])
    }))
    .filter((k) => Number.isFinite(k.close))
}
