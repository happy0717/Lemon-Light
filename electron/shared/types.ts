export interface Quote {
  symbol: string
  code: string
  name: string
  price: number
  previousClose: number
  open: number
  high: number
  low: number
  change: number
  changePercent: number
  volume: number
  amount: number
  tradeTime: string
  currencyCode: 'CNY' | 'HKD' | 'USD'
  marketLabel: string
  status: '开市' | '休市'
}

export interface QuotesPayload {
  lastUpdated: number
  quotes: Record<string, Quote>
  symbols: string[]
}

export interface SearchResultItem {
  symbol: string
  code: string
  name: string
  market: string
}

export interface DailyKline {
  date: string
  open: number
  close: number
  high: number
  low: number
  volume: number
  amount: number
}

export type Market = 'cn' | 'hk' | 'us'

export interface MarketSession {
  market: Market
  label: string
  open: boolean
}

export interface Group {
  id: string
  name: string
  color: string
  symbols: string[]
}

export type AlertKind = 'price' | 'changePercent'
export type AlertDirection = 'gte' | 'lte'
export type AlertBaseline = 'prevClose' | 'open' | 'added'

export interface StockAlert {
  id: string
  symbol: string
  kind: AlertKind
  direction: AlertDirection
  threshold: number
  enabled: boolean
  triggered: boolean
  firedAt?: string
  baseline?: AlertBaseline
  windowMin?: number
  addedPrice?: number
  addedDay?: string
  addedAt?: number
  note?: string
}

export interface AlertFireDetail {
  value: number
  refPrice: number | null
  refLabel: string
  windowMin: number | null
  windowStartAt: number | null
}

export interface AlertLogItem {
  id: string
  alertId: string
  symbol: string
  name: string
  behaviorText: string
  firedAt: number
  kind: AlertKind
  direction: AlertDirection
  threshold: number
  value: number
  refPrice: number | null
  price: number
  changePercent: number
}

export interface HoldingTrade {
  id: string
  symbol: string
  type: 'buy' | 'sell'
  price: number
  shares: number
  tradeDate: string
  createdAt: string
  fee?: number
  commission?: number
  tax?: number
  remark?: string
}

export interface HoldingArchive {
  id: string
  symbol: string
  archivedAt: string
  price: number
  shares: number
  tradeIds: string[]
  costValue: number
  marketValue: number
  realizedProfit: number
  profitPercent: number
}

export interface Holdings {
  version: number
  trades: HoldingTrade[]
  archives: HoldingArchive[]
}

export type BannerDisplayMode = 'primary' | 'mirror' | 'split'
export type BannerLayout = 'rows' | 'stacked' | 'dual'
export type FloatingBallStockMode = 'dayChange' | 'holdingPnl'
export type BannerFontFamily =
  | ''
  | 'Microsoft YaHei'
  | 'SimHei'
  | 'SimSun'
  | 'KaiTi'
  | 'Microsoft YaHei UI'

export interface BannerCustomPosition {
  x: number
  y: number
}

export interface TradeFeeRule {
  commissionBps: number
  minCommission: number
}

export interface AppSettings {
  refreshIntervalMs: number
  userName: string
  mainMarketIndexes: string[]
  bossKey: {
    enabled: boolean
    accelerator: string
  }
  floatingBall: {
    visible: boolean
    position: { x: number; y: number } | null
    badge: boolean
    autoHideWhenClosed: boolean
    stockMode: FloatingBallStockMode
  }
  bottomBanner: {
    visible: boolean
    displayMode: BannerDisplayMode
    autoHide: boolean
    scrollSpeed: number
    showMarketIndexes: boolean
    marketIndexSymbols: string[]
    layout: BannerLayout
    rows: number
    fontSize: number
    fontFamily: BannerFontFamily
    fontWeight: number
    customPositions: Record<string, BannerCustomPosition>
    showHoldingsPnl: boolean
    flipChangeAmount: boolean
  }
  bannerAppearance: {
    backgroundColor: string
    opacity: number
  }
  ballPanelAppearance: {
    backgroundColor: string
    opacity: number
  }
  settingsAppearance: {
    backgroundColor: string
  }
  alertsEnabled: boolean
  alertLogRetentionDays: number
  tradeFees: Record<Market, TradeFeeRule>
}

export interface Database {
  watchlist: string[]
  groups: Group[]
  alerts: StockAlert[]
  alertLogs: AlertLogItem[]
  holdings: Holdings
  settings: AppSettings
}

export interface BackupFile {
  app: 'lemon-light'
  version: string
  exportedAt: string
  data: {
    watchlist?: string[]
    groups?: Group[]
    alerts?: StockAlert[]
    holdings?: Holdings
    settings?: Partial<AppSettings>
  }
}
