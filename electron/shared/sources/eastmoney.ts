import type { Quote, SearchResultItem } from '../types'
import { isMarketOpen } from '../market-hours'

function toSecid(symbol: string): string | null {
  if (symbol.startsWith('sh')) return `1.${symbol.slice(2)}`
  if (symbol.startsWith('sz') || symbol.startsWith('bj')) return `0.${symbol.slice(2)}`
  return null
}

interface EmQuoteRaw {
  data: {
    f43: number
    f44: number
    f45: number
    f46: number
    f47: number
    f48: number
    f57: string
    f58: string
    f60: number
    f86: number
    f169: number
    f170: number
  }
}

export async function fetchEastmoneyQuote(symbol: string): Promise<Quote | null> {
  const secid = toSecid(symbol)
  if (!secid) return null
  const fields = 'f43,f44,f45,f46,f47,f48,f57,f58,f60,f86,f169,f170'
  const url = `https://push2delay.eastmoney.com/api/qt/stock/get?fltt=2&invt=2&secid=${secid}&fields=${fields}`
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = (await res.json()) as EmQuoteRaw
  const d = json?.data
  if (!d || !Number.isFinite(d.f43)) return null

  const tradeTimeFull = new Date(d.f86 * 1000 + 8 * 3600_000).toISOString()
  const isToday = tradeTimeFull.slice(0, 10) === new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
  const market = symbol.startsWith('sh') ? '沪' : symbol.startsWith('sz') ? '深' : '北'

  return {
    symbol,
    code: d.f57,
    name: d.f58,
    price: d.f43,
    previousClose: d.f60,
    open: d.f46,
    high: d.f44,
    low: d.f45,
    change: d.f169,
    changePercent: d.f170,
    volume: d.f47,
    amount: d.f48,
    tradeTime: tradeTimeFull.slice(11, 19),
    currencyCode: 'CNY',
    marketLabel: market,
    status: isToday && isMarketOpen('cn') ? '开市' : '休市'
  }
}

export async function searchEastmoney(keyword: string): Promise<SearchResultItem[]> {
  const url = `https://suggest.eastmoney.com/suggest/default.aspx?input=${encodeURIComponent(keyword)}`
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const text = new TextDecoder('utf-8').decode(await res.arrayBuffer())
  const payload = text.match(/var\s+Data\s*=\s*"([^"]*)"/)?.[1] ?? ''
  if (!payload) return []

  const marketPrefix: Record<string, string> = {
    '1': 'sz',
    '60': 'bj',
    '21': 'hk',
    '31': 'us',
    '16': 'sz'
  }
  const items: SearchResultItem[] = []
  for (const row of payload.split(';')) {
    const cols = row.split(',')
    if (cols.length < 4) continue
    const [marketCode, code, rawName] = cols
    const name = rawName.replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex: string) =>
      String.fromCharCode(parseInt(hex, 16))
    )
    if (marketCode === '11') continue
    if (marketCode === '1') {
      const prefix = ['5', '6', '9'].includes(code[0]) ? 'sh' : 'sz'
      items.push({ symbol: `${prefix}${code}`, code, name, market: prefix === 'sh' ? '沪' : '深' })
      continue
    }
    const prefix = marketPrefix[marketCode]
    if (!prefix) continue
    const symbol = `${prefix}${marketCode === '31' ? code.toUpperCase() : code}`
    items.push({ symbol, code, name, market: prefix === 'hk' ? '港' : prefix === 'us' ? '美' : '北' })
  }
  return items.slice(0, 12)
}
