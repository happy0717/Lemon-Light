<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useDbStore } from '../../shared/stores/db'
import { useQuoteStore } from '../../shared/stores/quotes'
import { computeHoldings, totalProfit } from '../../shared/holdings'
import { formatChangePercent, trendClass } from '../../shared/format'
import type { HoldingTrade, Market } from '@shared/types'
import {
  CURRENCY_LABEL,
  CURRENCY_SIGN,
  calcTradeFees,
  currencyOfSymbol,
  marketOfSymbol,
  moneyText,
  round2
} from '../../shared/trade-fees'

const db = useDbStore()
const quotes = useQuoteStore()

const form = ref({
  symbol: '',
  type: 'buy' as 'buy' | 'sell',
  price: 0,
  shares: 0,
  tradeDate: new Date().toISOString().slice(0, 10),
  commission: 0,
  tax: 0,
  remark: ''
})
const commissionManual = ref(false)
const taxManual = ref(false)

const FEE_MARKETS: Array<{ market: Market; label: string; currency: string; taxNote: string }> = [
  { market: 'cn', label: 'A股', currency: '元', taxNote: '税费：仅卖出收印花税 0.05%' },
  { market: 'hk', label: '港股', currency: '港元', taxNote: '税费：买卖各收印花税 0.1%' },
  { market: 'us', label: '美股', currency: '美元', taxNote: '税费：无印花税' }
]

const watchOptions = computed(() =>
  db.db.watchlist.map((s) => ({ symbol: s, label: quotes.state.quotes[s]?.name ?? s }))
)

function curOf(symbol: string) {
  return currencyOfSymbol(symbol, quotes.state.quotes[symbol]?.currencyCode)
}

const formCurrency = computed(() => {
  const q = quotes.state.quotes[form.value.symbol]
  return currencyOfSymbol(form.value.symbol, q?.currencyCode)
})
const formCurLabel = computed(() => CURRENCY_LABEL[formCurrency.value])

function autoFee(): { commission: number; tax: number } {
  const f = form.value
  if (!f.symbol || !(f.price > 0) || !(f.shares > 0)) return { commission: 0, tax: 0 }
  return calcTradeFees({
    market: marketOfSymbol(f.symbol),
    type: f.type,
    amount: f.price * f.shares,
    rule: db.db.settings.tradeFees[marketOfSymbol(f.symbol)]
  })
}

function refillFees(resetManual: boolean): void {
  if (resetManual) {
    commissionManual.value = false
    taxManual.value = false
  }
  const keepC = form.value.commission
  const keepT = form.value.tax
  const fees = autoFee()
  if (!commissionManual.value) form.value.commission = fees.commission
  else form.value.commission = keepC
  if (!taxManual.value) form.value.tax = fees.tax
  else form.value.tax = keepT
}

function restoreAuto(kind: 'commission' | 'tax'): void {
  if (kind === 'commission') commissionManual.value = false
  else taxManual.value = false
  refillFees(false)
}

watch(
  () => [form.value.symbol, form.value.type] as const,
  () => refillFees(true)
)
watch(
  () => [form.value.price, form.value.shares] as const,
  () => refillFees(false)
)
watch(
  () => db.db.settings.tradeFees,
  () => refillFees(false),
  { deep: true }
)

function norm(value: number): number {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

function commitFeeRule(market: Market): void {
  const rule = db.db.settings.tradeFees[market]
  void db.patchSettings({
    tradeFees: {
      ...db.db.settings.tradeFees,
      [market]: { commissionBps: norm(rule.commissionBps), minCommission: norm(rule.minCommission) }
    }
  })
}

async function addTrade(): Promise<void> {
  const f = form.value
  if (!f.symbol || !(f.price > 0) || !(f.shares > 0)) return
  const trade: HoldingTrade = {
    id: `trade-${f.symbol}-${Date.now()}`,
    symbol: f.symbol,
    type: f.type,
    price: Number(f.price),
    shares: Number(f.shares),
    tradeDate: f.tradeDate,
    createdAt: new Date().toISOString(),
    commission: round2(Math.max(Number(f.commission) || 0, 0)),
    tax: round2(Math.max(Number(f.tax) || 0, 0)),
    remark: f.remark.trim() || undefined
  }
  await db.setHoldings({ ...db.db.holdings, trades: [...db.db.holdings.trades, trade] })
  form.value.price = 0
  form.value.shares = 0
  form.value.commission = 0
  form.value.tax = 0
  form.value.remark = ''
  commissionManual.value = false
  taxManual.value = false
}

async function removeTrade(id: string): Promise<void> {
  await db.setHoldings({
    ...db.db.holdings,
    trades: db.db.holdings.trades.filter((t) => t.id !== id)
  })
}

function feesOf(trade: HoldingTrade): { commission: number; tax: number } {
  return { commission: trade.commission ?? trade.fee ?? 0, tax: trade.tax ?? 0 }
}

const totalFees = computed(() => {
  let commission = 0
  let tax = 0
  for (const t of db.db.holdings.trades) {
    const ft = feesOf(t)
    commission += ft.commission
    tax += ft.tax
  }
  return { commission, tax, total: commission + tax }
})

function signedMoney(value: number, symbol: string): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${moneyText(value, curOf(symbol))}`
}

function priceText(value: number, symbol: string): string {
  const v = Number(value)
  const text = Math.abs(v - Math.round(v)) < 1e-9 ? v.toFixed(2) : v.toFixed(3)
  return `${CURRENCY_SIGN[curOf(symbol)]}${text}`
}

const summaries = computed(() => computeHoldings(db.db.holdings, quotes.state.quotes))
const total = computed(() => totalProfit(summaries.value))
</script>

<template>
  <section class="tab">
    <h2 class="tab-title">持仓盈亏</h2>
    <p class="tab-desc">根据交易记录自动计算 · 行情实时估值</p>

    <div class="summary-row">
      <div class="summary-card">
        <span class="sc-label">总盈亏（元）</span>
        <span class="num sc-value" :class="trendClass(total.profit)">
          {{ total.profit > 0 ? '+' : '' }}{{ total.profit.toFixed(2) }}
        </span>
      </div>
      <div class="summary-card">
        <span class="sc-label">收益率</span>
        <span class="num sc-value" :class="trendClass(total.percent)">
          {{ formatChangePercent(total.percent) }}
        </span>
      </div>
      <div class="summary-card">
        <span class="sc-label">持仓股票</span>
        <span class="num sc-value">{{ summaries.length }}</span>
      </div>
    </div>
    <p class="fee-stat">
      累计费用：佣金 {{ moneyText(totalFees.commission, formCurrency) }} · 税费
      {{ moneyText(totalFees.tax, formCurrency) }}，已计入持仓成本与盈亏
    </p>

    <div class="add-form glass-panel">
      <div class="af-row">
        <label class="af-cell">
          <span class="af-label">股票</span>
          <select v-model="form.symbol" class="field select">
            <option value="" disabled>选择股票</option>
            <option v-for="opt in watchOptions" :key="opt.symbol" :value="opt.symbol">
              {{ opt.label }} ({{ opt.symbol }})
            </option>
          </select>
        </label>
        <label class="af-cell">
          <span class="af-label">方向</span>
          <select v-model="form.type" class="field select slim">
            <option value="buy">买入</option>
            <option value="sell">卖出</option>
          </select>
        </label>
        <label class="af-cell">
          <span class="af-label">成交价（{{ formCurLabel }}/股）</span>
          <input
            v-model.number="form.price"
            type="number"
            step="0.001"
            min="0"
            class="field"
            placeholder="0.000"
          />
        </label>
        <label class="af-cell">
          <span class="af-label">数量（股）</span>
          <input v-model.number="form.shares" type="number" step="100" min="0" class="field" placeholder="100" />
        </label>
        <label class="af-cell">
          <span class="af-label">成交日期</span>
          <input v-model="form.tradeDate" type="date" class="field" />
        </label>
      </div>
      <div class="af-row af-fees">
        <label class="af-cell">
          <span class="af-label">
            佣金（{{ formCurLabel }}）
            <span v-if="!commissionManual" class="af-badge">自动</span>
            <button v-else type="button" class="af-link" @click="restoreAuto('commission')">
              恢复自动
            </button>
          </span>
          <input
            v-model.number="form.commission"
            type="number"
            step="0.01"
            min="0"
            class="field slim"
            placeholder="0.00"
            @input="commissionManual = true"
          />
        </label>
        <label class="af-cell">
          <span class="af-label">
            税费（{{ formCurLabel }}）
            <span v-if="!taxManual" class="af-badge">自动</span>
            <button v-else type="button" class="af-link" @click="restoreAuto('tax')">恢复自动</button>
          </span>
          <input
            v-model.number="form.tax"
            type="number"
            step="0.01"
            min="0"
            class="field slim"
            placeholder="0.00"
            @input="taxManual = true"
          />
        </label>
        <div class="af-cell af-submit">
          <button class="btn primary" @click="addTrade">记录交易</button>
        </div>
      </div>
    </div>

    <div class="fee-panel glass-panel">
      <div class="fee-head">
        <span class="fee-title">费用与税费规则</span>
        <span class="fee-sub">录入交易时按此自动填充佣金与税费，可分别手动修改</span>
      </div>
      <div class="fee-rows">
        <div v-for="m in FEE_MARKETS" :key="m.market" class="fee-row">
          <span class="fr-market">{{ m.label }}（{{ m.currency }}）</span>
          <span class="fr-item">
            <span class="fr-label">佣金费率</span>
            <input
              v-model.number="db.db.settings.tradeFees[m.market].commissionBps"
              type="number"
              step="0.1"
              min="0"
              class="field fr-input"
              @change="commitFeeRule(m.market)"
            />
            <span class="fr-unit">万分之</span>
          </span>
          <span class="fr-item">
            <span class="fr-label">最低佣金</span>
            <input
              v-model.number="db.db.settings.tradeFees[m.market].minCommission"
              type="number"
              step="0.01"
              min="0"
              class="field fr-input"
              @change="commitFeeRule(m.market)"
            />
            <span class="fr-unit">{{ m.currency }}</span>
          </span>
          <span class="fr-note">{{ m.taxNote }}（0 = 不设最低）</span>
        </div>
      </div>
    </div>

    <h3 class="section-title">当前持仓</h3>
    <div class="table">
      <div class="t-row t-head">
        <span class="t-name">名称</span>
        <span class="t-sym">代码</span>
        <span class="t-shares">持仓（股）</span>
        <span class="t-cost">成本（元）</span>
        <span class="t-market">市值（元）</span>
        <span class="t-profit">盈亏（元）</span>
        <span class="t-pct">收益率</span>
      </div>
      <div v-if="summaries.length === 0" class="empty">暂无持仓</div>
      <div v-for="s in summaries" :key="s.symbol" class="t-row">
        <span class="t-name">{{ quotes.state.quotes[s.symbol]?.name ?? s.symbol }}</span>
        <span class="t-sym num">{{ s.symbol }}</span>
        <span class="num t-shares">{{ s.shares }}</span>
        <span class="num t-cost">{{ moneyText(s.costValue, curOf(s.symbol)) }}</span>
        <span class="num t-market">{{ moneyText(s.marketValue, curOf(s.symbol)) }}</span>
        <span class="num t-profit" :class="trendClass(s.profit)">
          {{ signedMoney(s.profit, s.symbol) }}
        </span>
        <span class="num t-pct" :class="trendClass(s.profitPercent)">
          {{ formatChangePercent(s.profitPercent) }}
        </span>
      </div>
    </div>

    <h3 class="section-title">交易记录（{{ db.db.holdings.trades.length }}）</h3>
    <div class="table">
      <div class="t-row t-head">
        <span class="t-type">方向</span>
        <span class="t-name">名称</span>
        <span class="t-shares">股数</span>
        <span class="t-price">成交价</span>
        <span class="t-date">日期</span>
        <span class="t-fee">佣金</span>
        <span class="t-fee">税费</span>
        <button class="t-del head-space" disabled aria-hidden="true"></button>
      </div>
      <div v-if="db.db.holdings.trades.length === 0" class="empty">暂无记录</div>
      <div v-for="t in [...db.db.holdings.trades].reverse()" :key="t.id" class="t-row">
        <span class="t-type" :class="t.type">{{ t.type === 'buy' ? '买入' : '卖出' }}</span>
        <span class="t-name">{{ quotes.state.quotes[t.symbol]?.name ?? t.symbol }}</span>
        <span class="num t-shares">{{ t.shares }}</span>
        <span class="num t-price">{{ priceText(t.price, t.symbol) }}</span>
        <span class="num t-date">{{ t.tradeDate }}</span>
        <span class="num t-fee">{{ feesOf(t).commission > 0 ? moneyText(feesOf(t).commission, curOf(t.symbol)) : '--' }}</span>
        <span class="num t-fee">{{ feesOf(t).tax > 0 ? moneyText(feesOf(t).tax, curOf(t.symbol)) : '--' }}</span>
        <button class="t-del" @click="removeTrade(t.id)">删除</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.tab-title {
  font-size: 20px;
  font-weight: 800;
}

.tab-desc {
  font-size: 12px;
  color: var(--text-3);
  margin: 6px 0 18px;
}

.summary-row {
  display: flex;
  gap: 12px;
  margin-bottom: 6px;
}

.summary-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px 18px;
  border-radius: var(--radius-m);
  border: 1px solid var(--stroke);
  background: var(--bg-1);
}

.sc-label {
  font-size: 11px;
  color: var(--text-3);
}

.sc-value {
  font-size: 22px;
  font-weight: 800;
}

.sc-value.up { color: var(--up); }
.sc-value.down { color: var(--down); }

.fee-stat {
  font-size: 11px;
  color: var(--text-3);
  margin: 0 2px 14px;
  line-height: 1.7;
}

.add-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border-radius: var(--radius-m);
  margin-bottom: 10px;
}

.af-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: flex-end;
}

.af-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 0 0 auto;
}

.af-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-3);
}

.af-badge {
  font-size: 10px;
  line-height: 1;
  padding: 2px 5px;
  border-radius: 999px;
  color: var(--gold);
  background: color-mix(in srgb, var(--gold) 14%, transparent);
}

.af-link {
  border: none;
  background: none;
  padding: 0;
  font-size: 11px;
  color: var(--gold);
  cursor: pointer;
  font-family: var(--sans);
  text-decoration: underline;
}

.field {
  padding: 8px 12px;
  border-radius: var(--radius-s);
  border: 1px solid var(--stroke-strong);
  background: var(--bg-2);
  color: var(--text-1);
  font-size: 13px;
  font-family: var(--sans);
  outline: none;
  color-scheme: dark;
}

.field:focus { border-color: var(--gold); }

.select { min-width: 170px; }
.select.slim, .field.slim { min-width: 110px; }

.af-submit {
  margin-left: auto;
}

.btn.primary {
  padding: 8px 18px;
  border-radius: var(--radius-s);
  border: none;
  background: linear-gradient(135deg, var(--gold), var(--gold-deep));
  color: #14100a;
  font-weight: 700;
  font-size: 13px;
  cursor: pointer;
  font-family: var(--sans);
}

.fee-panel {
  padding: 12px 14px;
  border-radius: var(--radius-m);
  margin-bottom: 4px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.fee-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.fee-title {
  font-size: 13px;
  font-weight: 700;
}

.fee-sub {
  font-size: 11px;
  color: var(--text-3);
}

.fee-rows {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 20px;
}

.fee-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.fr-market {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-2);
}

.fr-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.fr-label {
  font-size: 11px;
  color: var(--text-3);
}

.fr-input {
  width: 86px;
  padding: 5px 8px;
}

.fr-unit {
  font-size: 11px;
  color: var(--text-3);
  white-space: nowrap;
}

.fr-note {
  font-size: 11px;
  color: var(--text-3);
}

.section-title {
  margin: 22px 0 10px;
  font-size: 15px;
  font-weight: 700;
}

.table {
  border: 1px solid var(--stroke);
  border-radius: var(--radius-m);
  background: var(--bg-1);
  margin-bottom: 8px;
  overflow: hidden;
}

.t-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--stroke);
  font-size: 13px;
  white-space: nowrap;
}

.t-row:last-child { border-bottom: none; }

.t-head {
  padding: 6px 14px;
  font-size: 11px;
  color: var(--text-3);
  background: var(--bg-2);
}

.t-head span { color: inherit; }
.t-head button { pointer-events: none; }

.t-type {
  width: 36px;
  font-size: 11px;
  padding: 2px 0;
  text-align: center;
  border-radius: 5px;
}

.t-type.buy {
  color: var(--up);
  background: var(--up-soft);
}

.t-type.sell {
  color: var(--down);
  background: var(--down-soft);
}

.t-name {
  width: 88px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.t-sym {
  width: 64px;
  font-size: 11px;
  color: var(--text-3);
}

.t-shares { width: 64px; color: var(--text-2); }
.t-price { width: 82px; color: var(--text-2); }
.t-date { width: 92px; color: var(--text-2); font-size: 12px; }
.t-cost { width: 84px; color: var(--text-2); }
.t-market { width: 84px; color: var(--text-2); }
.t-profit { width: 84px; font-weight: 700; }
.t-pct { width: 64px; }
.t-fee { width: 74px; color: var(--text-2); }

.t-profit.up { color: var(--up); }
.t-profit.down { color: var(--down); }
.t-pct.up { color: var(--up); }
.t-pct.down { color: var(--down); }

.t-del {
  margin-left: auto;
  padding: 2px 10px;
  border-radius: 5px;
  border: none;
  background: transparent;
  color: var(--text-3);
  font-size: 11px;
  cursor: pointer;
  font-family: var(--sans);
}

.t-del.head-space {
  visibility: hidden;
}

.t-del:hover { color: var(--up); }

.empty {
  padding: 32px;
  text-align: center;
  color: var(--text-3);
  font-size: 12px;
}
</style>
