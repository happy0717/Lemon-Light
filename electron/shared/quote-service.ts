import type { AlertFireDetail, Quote, QuotesPayload, StockAlert } from './types'
import { fetchTencentQuotes } from './sources/tencent'
import { fetchEastmoneyQuote } from './sources/eastmoney'
import { anyMarketOpen, nextMarketOpen } from './market-hours'

type BroadcastFn = (payload: QuotesPayload) => void
type AlertFireFn = (alert: StockAlert, quote: Quote, detail: AlertFireDetail) => void
type AlertsMutatedFn = () => void

const CLOSED_RETRY_LIMIT = 30
const MAX_CACHE_AGE_MS = 30_000

export class QuoteService {
  private quotes: Record<string, Quote> = {}
  private lastUpdated = 0
  private symbols: string[] = []
  private alerts: StockAlert[] = []
  private alertsEnabled = true
  private samples = new Map<string, Array<{ t: number; price: number }>>()
  private sampleDay = ''
  private refreshIntervalMs = 5000
  private timer: NodeJS.Timeout | null = null
  private running = false
  private closedRetryCount = 0
  private fetching = false
  private broadcast: BroadcastFn = () => {}
  private onAlertFire: AlertFireFn = () => {}
  private onAlertsMutated: AlertsMutatedFn = () => {}

  setBroadcast(fn: BroadcastFn): void {
    this.broadcast = fn
  }

  setAlertHandler(fn: AlertFireFn): void {
    this.onAlertFire = fn
  }

  setAlertsMutatedHandler(fn: AlertsMutatedFn): void {
    this.onAlertsMutated = fn
  }

  updateSymbols(symbols: string[]): void {
    this.symbols = [...new Set(symbols)].sort()
    this.restart()
  }

  updateSettings(refreshIntervalMs: number, alertsEnabled: boolean): void {
    this.refreshIntervalMs = Math.max(1000, refreshIntervalMs || 5000)
    this.alertsEnabled = alertsEnabled
    this.restart()
  }

  updateAlerts(alerts: StockAlert[]): void {
    this.alerts = alerts
  }

  getSnapshot(): QuotesPayload {
    return { lastUpdated: this.lastUpdated, quotes: { ...this.quotes }, symbols: [...this.symbols] }
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.scheduleNext(500)
  }

  stop(): void {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  restart(): void {
    if (!this.running) return
    if (this.timer) clearTimeout(this.timer)
    this.scheduleNext(300)
  }

  private scheduleNext(delayMs: number): void {
    if (!this.running) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.tick(), delayMs)
  }

  private async tick(): Promise<void> {
    if (!this.running) return
    const hasTargets = this.symbols.length > 0

    if (!hasTargets) {
      this.scheduleNext(30_000)
      return
    }

    if (!anyMarketOpen(this.symbols)) {
      this.closedRetryCount = 0
      this.scheduleNext(Math.max(1000, nextMarketOpen(this.symbols) - Date.now()))
      return
    }

    try {
      await this.fetchAll()
    } catch {
      // 单轮失败不影响后续调度
    }

    const allClosed = this.symbols.length > 0 && this.symbols.every((s) => this.quotes[s]?.status === '休市')
    if (allClosed) {
      this.closedRetryCount++
      if (this.closedRetryCount >= CLOSED_RETRY_LIMIT) {
        this.closedRetryCount = 0
        this.scheduleNext(Math.max(60_000, nextMarketOpen(this.symbols) - Date.now()))
        return
      }
    } else {
      this.closedRetryCount = 0
    }

    this.scheduleNext(this.refreshIntervalMs)
  }

  async fetchAll(force = false): Promise<QuotesPayload> {
    if (this.symbols.length === 0) return this.getSnapshot()
    if (this.fetching && !force) return this.getSnapshot()

    const cacheAge = Date.now() - this.lastUpdated
    if (!force && cacheAge < Math.min(this.refreshIntervalMs, MAX_CACHE_AGE_MS)) {
      return this.getSnapshot()
    }

    this.fetching = true
    try {
      let fetched: Record<string, Quote>
      try {
        fetched = await fetchTencentQuotes(this.symbols)
      } catch {
        fetched = {}
      }

      const missing = this.symbols.filter((s) => !fetched[s])
      for (const symbol of missing) {
        try {
          const q = await fetchEastmoneyQuote(symbol)
          if (q) fetched[symbol] = q
        } catch {
          // 备源也失败则跳过该股票
        }
      }

      if (Object.keys(fetched).length > 0) {
        this.quotes = { ...this.quotes, ...fetched }
        this.lastUpdated = Date.now()
        this.recordSamples(fetched)
        this.checkAlerts()
        const payload = this.getSnapshot()
        this.broadcast(payload)
        return payload
      }
      return this.getSnapshot()
    } finally {
      this.fetching = false
    }
  }

  private localDay(): string {
    const d = new Date()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${d.getFullYear()}-${m}-${dd}`
  }

  private recordSamples(fetched: Record<string, Quote>): void {
    const day = this.localDay()
    if (this.sampleDay !== day) {
      this.sampleDay = day
      this.samples.clear()
    }
    const now = Date.now()
    for (const symbol of Object.keys(fetched)) {
      const price = fetched[symbol].price
      if (!Number.isFinite(price)) continue
      let arr = this.samples.get(symbol)
      if (!arr) {
        arr = []
        this.samples.set(symbol, arr)
      }
      arr.push({ t: now, price })
    }
    const cutoff = now - 26 * 3600_000
    for (const arr of this.samples.values()) {
      while (arr.length > 0 && arr[0].t < cutoff) arr.shift()
    }
  }

  private findSampleAtOrBefore(symbol: string, timeMs: number): { t: number; price: number } | null {
    const arr = this.samples.get(symbol)
    if (!arr || arr.length === 0) return null
    let lo = 0
    let hi = arr.length - 1
    let found = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (arr[mid].t <= timeMs) {
        found = mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    return found >= 0 ? arr[found]! : null
  }

  private resolveChange(
    alert: StockAlert,
    quote: Quote
  ): { value: number; refPrice: number; refLabel: string; windowMin: number | null; windowStartAt: number | null } | null {
    const baseline = alert.baseline ?? 'prevClose'
    const windowMin =
      alert.windowMin && alert.windowMin > 0 && baseline !== 'prevClose' ? alert.windowMin : 0
    let ref: number | null = null
    let refLabel = baseline === 'prevClose' ? '昨收价' : baseline === 'open' ? '今开价' : '添加时价'
    let windowStartAt: number | null = null
    if (windowMin > 0) {
      const refTime = Date.now() - windowMin * 60_000
      const afterAnchor =
        baseline !== 'added' || !alert.addedAt || refTime >= alert.addedAt
      if (afterAnchor) {
        const found = this.findSampleAtOrBefore(alert.symbol, refTime)
        if (found) {
          ref = found.price
          windowStartAt = found.t
          refLabel = '窗口起点价'
        }
      }
      if (windowStartAt == null) {
        windowStartAt = baseline === 'added' && alert.addedAt ? alert.addedAt : refTime
      }
    }
    if (ref == null) {
      if (baseline === 'prevClose') ref = quote.previousClose
      else if (baseline === 'open') ref = quote.open
      else ref = alert.addedPrice ?? null
    }
    if (ref == null || ref <= 0) return null
    const value = ((quote.price - ref) / ref) * 100
    return { value, refPrice: ref, refLabel, windowMin: windowMin > 0 ? windowMin : null, windowStartAt }
  }

  private checkAlerts(): void {
    if (!this.alertsEnabled) return
    const today = this.localDay()
    let mutated = false
    for (const alert of this.alerts) {
      if (!alert.enabled) continue
      const quote = this.quotes[alert.symbol]
      if (!quote) continue

      if (alert.kind === 'changePercent') {
        const baseline = alert.baseline ?? 'prevClose'
        if (baseline === 'added') {
          if (alert.addedDay && alert.addedDay !== today) {
            alert.enabled = false
            alert.triggered = false
            mutated = true
            continue
          }
          if (alert.addedPrice == null || alert.addedPrice <= 0) continue
        }
      }

      if (alert.triggered) {
        if (alert.firedAt === today) continue
        alert.triggered = false
      }

      let value: number
      let detail: AlertFireDetail
      if (alert.kind === 'price') {
        value = quote.price
        detail = {
          value,
          refPrice: alert.threshold,
          refLabel: '阈值价',
          windowMin: null,
          windowStartAt: null
        }
      } else {
        const resolved = this.resolveChange(alert, quote)
        if (!resolved) continue
        value = resolved.value
        detail = {
          value,
          refPrice: resolved.refPrice,
          refLabel: resolved.refLabel,
          windowMin: resolved.windowMin,
          windowStartAt: resolved.windowStartAt
        }
      }
      const hit = alert.direction === 'gte' ? value >= alert.threshold : value <= alert.threshold
      if (hit) {
        alert.triggered = true
        alert.firedAt = today
        this.onAlertFire(alert, quote, detail)
      }
    }
    if (mutated) this.onAlertsMutated()
  }
}
