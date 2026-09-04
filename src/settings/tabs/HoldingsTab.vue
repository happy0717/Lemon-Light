<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDbStore } from '../../shared/stores/db'
import { useQuoteStore } from '../../shared/stores/quotes'
import { computeHoldings, totalProfit } from '../../shared/holdings'
import { formatChangePercent, formatPrice, trendClass } from '../../shared/format'
import type { HoldingTrade } from '@shared/types'

const db = useDbStore()
const quotes = useQuoteStore()

const form = ref({
  symbol: '',
  type: 'buy' as 'buy' | 'sell',
  price: 0,
  shares: 0,
  tradeDate: new Date().toISOString().slice(0, 10),
  fee: 0,
  remark: ''
})

const watchOptions = computed(() =>
  db.db.watchlist.map((s) => ({ symbol: s, label: quotes.state.quotes[s]?.name ?? s }))
)

async function addTrade(): Promise<void> {
  const f = form.value
  if (!f.symbol || f.price <= 0 || f.shares <= 0) return
  const trade: HoldingTrade = {
    id: `trade-${f.symbol}-${Date.now()}`,
    symbol: f.symbol,
    type: f.type,
    price: Number(f.price),
    shares: Number(f.shares),
    tradeDate: f.tradeDate,
    createdAt: new Date().toISOString(),
    fee: Number(f.fee) || 0,
    remark: f.remark.trim() || undefined
  }
  await db.setHoldings({ ...db.db.holdings, trades: [...db.db.holdings.trades, trade] })
  form.value.price = 0
  form.value.shares = 0
  form.value.fee = 0
  form.value.remark = ''
}

async function removeTrade(id: string): Promise<void> {
  await db.setHoldings({
    ...db.db.holdings,
    trades: db.db.holdings.trades.filter((t) => t.id !== id)
  })
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
        <span class="sc-label">总盈亏</span>
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

    <div class="add-form glass-panel">
      <select v-model="form.symbol" class="field select">
        <option value="" disabled>选择股票</option>
        <option v-for="opt in watchOptions" :key="opt.symbol" :value="opt.symbol">
          {{ opt.label }} ({{ opt.symbol }})
        </option>
      </select>
      <select v-model="form.type" class="field select slim">
        <option value="buy">买入</option>
        <option value="sell">卖出</option>
      </select>
      <input v-model.number="form.price" type="number" step="0.001" class="field" placeholder="价格" />
      <input v-model.number="form.shares" type="number" step="100" class="field" placeholder="股数" />
      <input v-model="form.tradeDate" type="date" class="field" />
      <input v-model.number="form.fee" type="number" step="0.01" class="field slim" placeholder="费用" />
      <button class="btn primary" @click="addTrade">记录交易</button>
    </div>

    <h3 class="section-title">当前持仓</h3>
    <div class="table">
      <div v-if="summaries.length === 0" class="empty">暂无持仓</div>
      <div v-for="s in summaries" :key="s.symbol" class="t-row">
        <span class="t-name">{{ quotes.state.quotes[s.symbol]?.name ?? s.symbol }}</span>
        <span class="t-sym num">{{ s.symbol }}</span>
        <span class="num t-shares">{{ s.shares }}</span>
        <span class="num t-cost">{{ s.costValue.toFixed(2) }}</span>
        <span class="num t-market">{{ s.marketValue.toFixed(2) }}</span>
        <span class="num t-profit" :class="trendClass(s.profit)">
          {{ s.profit > 0 ? '+' : '' }}{{ s.profit.toFixed(2) }}
        </span>
        <span class="num t-pct" :class="trendClass(s.profitPercent)">
          {{ formatChangePercent(s.profitPercent) }}
        </span>
      </div>
    </div>

    <h3 class="section-title">交易记录（{{ db.db.holdings.trades.length }}）</h3>
    <div class="table">
      <div v-if="db.db.holdings.trades.length === 0" class="empty">暂无记录</div>
      <div v-for="t in [...db.db.holdings.trades].reverse()" :key="t.id" class="t-row">
        <span class="t-type" :class="t.type">{{ t.type === 'buy' ? '买入' : '卖出' }}</span>
        <span class="t-name">{{ quotes.state.quotes[t.symbol]?.name ?? t.symbol }}</span>
        <span class="num t-shares">{{ t.shares }}</span>
        <span class="num t-cost">{{ t.price.toFixed(3) }}</span>
        <span class="num t-market">{{ t.tradeDate }}</span>
        <span class="num t-market">{{ t.fee > 0 ? t.fee.toFixed(2) : '--' }}</span>
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
  margin-bottom: 18px;
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

.add-form {
  display: flex;
  gap: 8px;
  padding: 14px;
  border-radius: var(--radius-m);
  margin-bottom: 8px;
  flex-wrap: wrap;
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
.select.slim, .field.slim { min-width: 100px; }

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
}

.t-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 9px 14px;
  border-bottom: 1px solid var(--stroke);
  font-size: 13px;
}

.t-row:last-child { border-bottom: none; }

.t-type {
  width: 38px;
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
  width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.t-sym {
  width: 72px;
  font-size: 11px;
  color: var(--text-3);
}

.t-shares { width: 70px; color: var(--text-2); }
.t-cost { width: 90px; color: var(--text-2); }
.t-market { width: 90px; color: var(--text-2); font-size: 12px; }
.t-profit { width: 90px; font-weight: 700; }
.t-pct { width: 70px; }

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

.t-del:hover { color: var(--up); }

.empty {
  padding: 32px;
  text-align: center;
  color: var(--text-3);
  font-size: 12px;
}
</style>
