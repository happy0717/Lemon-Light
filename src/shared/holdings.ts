import type { HoldingTrade, Holdings, Quote } from '@shared/types'

export interface HoldingSummary {
  symbol: string
  shares: number
  costValue: number
  marketValue: number
  profit: number
  profitPercent: number
}

export function computeHoldings(holdings: Holdings, quotes: Record<string, Quote>): HoldingSummary[] {
  const bySymbol = new Map<string, { shares: number; cost: number }>()
  for (const trade of holdings.trades) {
    const entry = bySymbol.get(trade.symbol) ?? { shares: 0, cost: 0 }
    const value = trade.price * trade.shares + (trade.fee ?? 0)
    if (trade.type === 'buy') {
      entry.shares += trade.shares
      entry.cost += value
    } else {
      entry.shares -= trade.shares
      entry.cost -= value
    }
    bySymbol.set(trade.symbol, entry)
  }

  const summaries: HoldingSummary[] = []
  for (const [symbol, entry] of bySymbol) {
    if (entry.shares <= 0) continue
    const quote = quotes[symbol]
    const marketValue = quote ? entry.shares * quote.price : entry.cost
    const profit = marketValue - entry.cost
    summaries.push({
      symbol,
      shares: entry.shares,
      costValue: entry.cost,
      marketValue,
      profit,
      profitPercent: entry.cost > 0 ? (profit / entry.cost) * 100 : 0
    })
  }
  return summaries.sort((a, b) => Math.abs(b.profit) - Math.abs(a.profit))
}

export function totalProfit(summaries: HoldingSummary[]): { profit: number; percent: number } {
  let cost = 0
  let market = 0
  for (const s of summaries) {
    cost += s.costValue
    market += s.marketValue
  }
  return { profit: market - cost, percent: cost > 0 ? ((market - cost) / cost) * 100 : 0 }
}
