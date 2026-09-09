import type { Market } from '@shared/types'
import { detectMarket } from '@shared/symbol'

export type CurrencyCode = 'CNY' | 'HKD' | 'USD'

export const MARKET_CURRENCY: Record<Market, CurrencyCode> = {
  cn: 'CNY',
  hk: 'HKD',
  us: 'USD'
}

export const CURRENCY_LABEL: Record<CurrencyCode, string> = {
  CNY: '元',
  HKD: '港元',
  USD: '美元'
}

export const CURRENCY_SIGN: Record<CurrencyCode, string> = {
  CNY: '',
  HKD: 'HK$',
  USD: 'US$'
}

export const TAX_BPS: Record<Market, { buy: number; sell: number }> = {
  cn: { buy: 0, sell: 5 },
  hk: { buy: 10, sell: 10 },
  us: { buy: 0, sell: 0 }
}

export function marketOfSymbol(symbol: string): Market {
  return detectMarket(symbol)
}

export function currencyOfSymbol(symbol: string, quoteCurrency?: string): CurrencyCode {
  if (quoteCurrency === 'CNY' || quoteCurrency === 'HKD' || quoteCurrency === 'USD') {
    return quoteCurrency
  }
  return MARKET_CURRENCY[marketOfSymbol(symbol)] ?? 'CNY'
}

export function moneyText(value: number, currency: CurrencyCode): string {
  return `${CURRENCY_SIGN[currency]}${value.toFixed(2)}`
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export interface TradeFeeRuleLike {
  commissionBps: number
  minCommission: number
}

export function calcTradeFees(options: {
  market: Market
  type: 'buy' | 'sell'
  amount: number
  rule: TradeFeeRuleLike
}): { commission: number; tax: number } {
  const { market, type, amount, rule } = options
  if (!(amount > 0)) return { commission: 0, tax: 0 }
  let commission = (amount * rule.commissionBps) / 10000
  if (rule.minCommission > 0 && commission < rule.minCommission) commission = rule.minCommission
  const tax = (amount * TAX_BPS[market][type]) / 10000
  return { commission: round2(commission), tax: round2(tax) }
}
