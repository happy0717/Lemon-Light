import type { Market, MarketSession } from './types'
import { detectMarket } from './symbol'

interface SessionRule {
  market: Market
  label: string
  timeZone: string
  weekday: number[]
  sessions: Array<{ start: string; end: string }>
}

const CN_RULE: SessionRule = {
  market: 'cn',
  label: 'A股',
  timeZone: 'Asia/Shanghai',
  weekday: [1, 2, 3, 4, 5],
  sessions: [
    { start: '09:15', end: '11:30' },
    { start: '13:00', end: '15:00' }
  ]
}

const HK_RULE: SessionRule = {
  market: 'hk',
  label: '港股',
  timeZone: 'Asia/Hong_Kong',
  weekday: [1, 2, 3, 4, 5],
  sessions: [
    { start: '09:30', end: '12:00' },
    { start: '13:00', end: '16:00' }
  ]
}

const US_RULE: SessionRule = {
  market: 'us',
  label: '美股',
  timeZone: 'America/New_York',
  weekday: [1, 2, 3, 4, 5],
  sessions: [{ start: '09:30', end: '16:00' }]
}

const RULES: Record<Market, SessionRule> = { cn: CN_RULE, hk: HK_RULE, us: US_RULE }

function timeInZone(date: Date, timeZone: string): { minutes: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })
  const parts = fmt.formatToParts(date)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const hour = parseInt(get('hour'), 10) % 24
  const minute = parseInt(get('minute'), 10)
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return { minutes: hour * 60 + minute, weekday: weekdayMap[get('weekday')] ?? 0 }
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

export function isMarketOpen(market: Market, now: Date = new Date()): boolean {
  const rule = RULES[market]
  const { minutes, weekday } = timeInZone(now, rule.timeZone)
  if (!rule.weekday.includes(weekday)) return false
  return rule.sessions.some((s) => minutes >= toMinutes(s.start) && minutes < toMinutes(s.end))
}

export function getMarketSessions(now: Date = new Date()): MarketSession[] {
  return (['cn', 'hk', 'us'] as Market[]).map((market) => ({
    market,
    label: RULES[market].label,
    open: isMarketOpen(market, now)
  }))
}

export function anyMarketOpen(symbols: string[], now: Date = new Date()): boolean {
  const markets = new Set(symbols.map(detectMarket))
  for (const m of markets) if (isMarketOpen(m, now)) return true
  return false
}

function nextOpenTimeForRule(rule: SessionRule, now: Date): number {
  const stepMs = 60_000
  const maxScanMs = 8 * 24 * 60 * 60 * 1000
  for (let t = now.getTime(); t < now.getTime() + maxScanMs; t += stepMs) {
    const d = new Date(t)
    const { minutes, weekday } = timeInZone(d, rule.timeZone)
    if (!rule.weekday.includes(weekday)) continue
    if (rule.sessions.some((s) => toMinutes(s.start) === minutes)) return t
  }
  return now.getTime() + 60_000
}

export function nextMarketOpen(symbols: string[], now: Date = new Date()): number {
  const markets = new Set(symbols.map(detectMarket))
  let earliest = Infinity
  for (const m of markets) {
    const t = nextOpenTimeForRule(RULES[m], now)
    if (t < earliest) earliest = t
  }
  return Number.isFinite(earliest) ? earliest : now.getTime() + 60_000
}
