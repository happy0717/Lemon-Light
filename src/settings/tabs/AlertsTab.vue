<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDbStore } from '../../shared/stores/db'
import { useQuoteStore } from '../../shared/stores/quotes'
import { bridge } from '../../shared/bridge'
import type { AlertBaseline, AlertLogItem, StockAlert } from '@shared/types'

const db = useDbStore()
const quotes = useQuoteStore()

const form = ref({
  symbol: '',
  kind: 'price' as 'price' | 'changePercent',
  direction: 'gte' as 'gte' | 'lte',
  threshold: 0,
  note: '',
  baseline: 'open' as AlertBaseline,
  windowMin: 0
})

const testSent = ref(false)
const addMsg = ref('')

const baselineOptions: Array<{ value: AlertBaseline; label: string }> = [
  { value: 'prevClose', label: '昨收价（传统）' },
  { value: 'open', label: '今开价（每日基准）' },
  { value: 'added', label: '添加时价（当日有效）' }
]

const windowOptions = [
  { value: 0, label: '无窗口（整段统计）' },
  { value: 1, label: '1 分钟' },
  { value: 3, label: '3 分钟' },
  { value: 5, label: '5 分钟' },
  { value: 10, label: '10 分钟' },
  { value: 15, label: '15 分钟' },
  { value: 30, label: '30 分钟' },
  { value: 60, label: '60 分钟' },
  { value: 120, label: '120 分钟' },
  { value: 240, label: '全天（一个交易日）' }
]

function windowTail(min: number): string {
  return min >= 240 ? '全天' : `${min} 分钟`
}

function localDay(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${dd}`
}

const watchOptions = computed(() =>
  db.db.watchlist.map((s) => ({
    symbol: s,
    label: quotes.state.quotes[s]?.name ?? s
  }))
)

function fmtValue(symbol: string, kind: 'price' | 'changePercent'): string {
  const q = quotes.state.quotes[symbol]
  if (!q) return ''
  if (kind === 'price') return String(q.price)
  return `${q.changePercent >= 0 ? '+' : ''}${q.changePercent.toFixed(2)}%`
}

function basePercent(alert: Pick<StockAlert, 'symbol' | 'kind' | 'baseline' | 'addedPrice' | 'addedDay'>): number | null {
  if (alert.kind !== 'changePercent') return null
  const q = quotes.state.quotes[alert.symbol]
  if (!q) return null
  const baseline = alert.baseline ?? 'prevClose'
  if (baseline === 'open') {
    return q.open > 0 ? ((q.price - q.open) / q.open) * 100 : null
  }
  if (baseline === 'added') {
    if (!alert.addedPrice || alert.addedPrice <= 0) return null
    if (alert.addedDay && alert.addedDay !== localDay()) return null
    return ((q.price - alert.addedPrice) / alert.addedPrice) * 100
  }
  return q.changePercent
}

function isRolling(alert: Pick<StockAlert, 'kind' | 'windowMin'>): boolean {
  return alert.kind === 'changePercent' && Boolean(alert.windowMin && alert.windowMin > 0)
}

function isHit(alert: Pick<StockAlert, 'symbol' | 'kind' | 'direction' | 'threshold' | 'baseline' | 'addedPrice' | 'addedDay' | 'windowMin'>): boolean | null {
  const q = quotes.state.quotes[alert.symbol]
  if (!q) return null
  if (isRolling(alert)) return null
  if (alert.kind === 'price') {
    return alert.direction === 'gte' ? q.price >= alert.threshold : q.price <= alert.threshold
  }
  const pct = basePercent(alert)
  if (pct === null) return null
  return alert.direction === 'gte' ? pct >= alert.threshold : pct <= alert.threshold
}

const formLive = computed(() => {
  const symbol = form.value.symbol
  const q = quotes.state.quotes[symbol]
  if (!q || form.value.threshold === 0) return null
  const probe = {
    symbol,
    kind: form.value.kind,
    direction: form.value.direction,
    threshold: form.value.threshold,
    baseline: form.value.baseline,
    addedPrice: q.price,
    addedDay: localDay(),
    windowMin: form.value.windowMin
  }
  if (form.value.kind === 'changePercent' && form.value.baseline === 'added') {
    return { rolling: isRolling(probe), hit: false, hint: `将以添加时现价 ${q.price} 为基准（仅当日有效）` }
  }
  const hit = isHit(probe)
  if (hit === null) return { rolling: true, hit: false, hint: `开市期间每 5 秒滚动统计，达到阈值立即告警` }
  const current =
    form.value.kind === 'price'
      ? fmtValue(symbol, 'price')
      : `${basePercent(probe)?.toFixed(2)}%`
  return {
    rolling: false,
    hint: hit
      ? `当前 ${current}，已满足条件——添加后开市期间约 5 秒内就会提醒（同规则每日至多一次）`
      : `当前 ${current}，尚未满足，行情达到条件后自动提醒`
  }
})

function liveOf(alert: StockAlert): { text: string; hit: boolean } {
  const q = quotes.state.quotes[alert.symbol]
  if (!q) return { text: '', hit: false }
  if (isRolling(alert)) {
    const wt = alert.windowMin && alert.windowMin >= 240 ? '全天' : `近${alert.windowMin} 分钟`
    return { text: `${wt}滚动中`, hit: false }
  }
  if (alert.kind === 'price') {
    const hit = isHit(alert)
    if (hit === null) return { text: '', hit: false }
    return { text: `当前 ${q.price} · ${hit ? '已满足' : '未满足'}`, hit }
  }
  const pct = basePercent(alert)
  if (pct === null) return { text: '', hit: false }
  const hit = alert.direction === 'gte' ? pct >= alert.threshold : pct <= alert.threshold
  return { text: `当前 ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}% · ${hit ? '已满足' : '未满足'}`, hit }
}

async function sendTestNotice(): Promise<void> {
  const ok = await bridge.testAlert()
  testSent.value = ok
  setTimeout(() => (testSent.value = false), 3000)
}

async function addAlert(): Promise<void> {
  const symbol = form.value.symbol
  if (!symbol || form.value.threshold === 0) return
  const q = quotes.state.quotes[symbol]
  if (form.value.kind === 'changePercent' && form.value.baseline === 'added' && !q) {
    addMsg.value = '当前无该股行情，无法以“添加时价”为基准，请稍后再试'
    return
  }
  const alert: StockAlert = {
    id: `alert-${Date.now()}`,
    symbol,
    kind: form.value.kind,
    direction: form.value.direction,
    threshold: Number(form.value.threshold),
    enabled: true,
    triggered: false,
    note: form.value.note.trim() || undefined
  }
  if (form.value.kind === 'changePercent') {
    alert.baseline = form.value.baseline
    if (form.value.baseline !== 'prevClose' && form.value.windowMin > 0) {
      alert.windowMin = form.value.windowMin
    }
    if (form.value.baseline === 'added' && q) {
      alert.addedPrice = q.price
      alert.addedDay = localDay()
      alert.addedAt = Date.now()
    }
  }
  await db.setAlerts([...db.db.alerts, alert])
  form.value.threshold = 0
  form.value.note = ''
  addMsg.value = ''
}

async function toggleAlert(alert: StockAlert): Promise<void> {
  await db.setAlerts(
    db.db.alerts.map((a) => {
      if (a.id !== alert.id) return a
      const next = { ...a, enabled: !a.enabled, triggered: false }
      if (next.enabled) delete (next as { firedAt?: string }).firedAt
      return next
    })
  )
}

async function removeAlert(id: string): Promise<void> {
  await db.setAlerts(db.db.alerts.filter((a) => a.id !== id))
}

async function toggleAlertsEnabled(): Promise<void> {
  await db.patchSettings({ alertsEnabled: !db.db.settings.alertsEnabled })
}

function describeAlert(alert: StockAlert): string {
  const kind = alert.kind === 'price' ? '价格' : '涨跌幅'
  const dir = alert.direction === 'gte' ? '≥' : '≤'
  const unit = alert.kind === 'price' ? '' : '%'
  let text = `${kind} ${dir} ${alert.threshold}${unit}`
  if (alert.kind === 'changePercent') {
    const parts: string[] = []
    if (alert.windowMin && alert.windowMin > 0) {
      const wt = alert.windowMin >= 240 ? '全天' : `近${alert.windowMin} 分钟`
      parts.push(`${wt}滚动窗口`)
    }
    const baseline = alert.baseline ?? 'prevClose'
    if (baseline === 'open') parts.push('今开基准')
    else if (baseline === 'added') parts.push('添加时价·当日')
    if (parts.length > 0) text += ` · ${parts.join(' · ')}`
  }
  return text
}

function alertStatus(alert: StockAlert): { text: string; cls: string } {
  if (alert.triggered) return { text: '已触发', cls: 'hit' }
  if (!alert.enabled) return { text: '已暂停', cls: 'paused' }
  return { text: '监控中', cls: 'on' }
}

const retentionPresets = [
  { value: 0, label: '永久保留（不自动清除）' },
  { value: 1, label: '保留 1 天' },
  { value: 3, label: '保留 3 天' },
  { value: 7, label: '保留 7 天' },
  { value: 15, label: '保留 15 天' },
  { value: 30, label: '保留 30 天' },
  { value: 90, label: '保留 90 天' }
]

const retentionOptions = computed(() => {
  const cur = Number(db.db.settings.alertLogRetentionDays ?? 30)
  const presets = [...retentionPresets]
  if (cur > 0 && !presets.some((p) => p.value === cur)) {
    presets.splice(1, 0, { value: cur, label: `保留 ${cur} 天（自定义）` })
  }
  return presets
})

const clearConfirming = ref(false)

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function fmtLogTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

function fmtSignedPct(v: number): string {
  if (!Number.isFinite(v)) return '--'
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}

function retentionLabel(): string {
  const days = Number(db.db.settings.alertLogRetentionDays ?? 30)
  if (days <= 0) return '永久保留'
  return `${days} 天后自动清除`
}

async function changeRetention(): Promise<void> {
  await db.patchSettings({
    alertLogRetentionDays: Number(db.db.settings.alertLogRetentionDays ?? 30)
  })
}

async function removeLog(id: string): Promise<void> {
  await db.removeAlertLogs([id])
}

async function clearLogs(): Promise<void> {
  if (!clearConfirming.value) {
    clearConfirming.value = true
    setTimeout(() => (clearConfirming.value = false), 3000)
    return
  }
  clearConfirming.value = false
  await db.clearAlertLogs()
}

function logKindBadge(log: AlertLogItem): { text: string; cls: string } {
  const dir = log.direction === 'gte' ? '上涨预警' : '下跌预警'
  return { text: `${dir}${log.kind === 'price' ? '·价格' : ''}`, cls: log.direction === 'gte' ? 'up' : 'down' }
}
</script>

<template>
  <section class="tab">
    <h2 class="tab-title">价格预警</h2>
    <p class="tab-desc">
      触发后弹应用内浮窗提示并发送 Windows 系统通知 · 总开关：
      <button class="switch" :class="{ on: db.db.settings.alertsEnabled }" @click="toggleAlertsEnabled">
        {{ db.db.settings.alertsEnabled ? '已开启' : '已关闭' }}
      </button>
      <button class="test-btn" @click="sendTestNotice">
        {{ testSent ? '已发送，请看屏幕提示' : '发送测试提示' }}
      </button>
    </p>

    <div class="add-form glass-panel">
      <select v-model="form.symbol" class="field select">
        <option value="" disabled>选择股票</option>
        <option v-for="opt in watchOptions" :key="opt.symbol" :value="opt.symbol">
          {{ opt.label }} ({{ opt.symbol }})
        </option>
      </select>
      <select v-model="form.kind" class="field select slim">
        <option value="price">价格</option>
        <option value="changePercent">涨跌幅</option>
      </select>
      <select v-if="form.kind === 'changePercent'" v-model="form.baseline" class="field select slim">
        <option v-for="opt in baselineOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
      </select>
      <select v-if="form.kind === 'changePercent' && form.baseline !== 'prevClose'" v-model="form.windowMin" class="field select slim">
        <option v-for="opt in windowOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
      </select>
      <select v-model="form.direction" class="field select slim">
        <option value="gte">达到以上</option>
        <option value="lte">跌破以下</option>
      </select>
      <input v-model.number="form.threshold" type="number" step="0.01" class="field" placeholder="阈值" />
      <input v-model="form.note" class="field" placeholder="备注（可选）" />
      <button class="btn primary" @click="addAlert">添加预警</button>
    </div>
    <p v-if="addMsg" class="mini-tip">{{ addMsg }}</p>
    <p v-if="formLive" class="mini-tip" :class="!formLive.rolling && formLive.hit ? 'ok' : ''">
      {{ formLive.hint }}
    </p>

    <div class="alert-list">
      <div v-if="db.db.alerts.length === 0" class="empty">暂无预警规则</div>
      <div v-for="alert in db.db.alerts" :key="alert.id" class="alert-row">
        <span class="a-name">{{ quotes.state.quotes[alert.symbol]?.name ?? alert.symbol }}</span>
        <span class="a-sym num">{{ alert.symbol }}</span>
        <span class="a-rule">{{ describeAlert(alert) }}</span>
        <span v-if="liveOf(alert).text" class="a-live" :class="liveOf(alert).hit ? 'yes' : 'no'">
          {{ liveOf(alert).text }}
        </span>
        <span v-if="alert.note" class="a-note">{{ alert.note }}</span>
        <span class="a-status" :class="alertStatus(alert).cls">{{ alertStatus(alert).text }}</span>
        <button class="a-btn" @click="toggleAlert(alert)">
          {{ alert.enabled ? '暂停' : '启用' }}
        </button>
        <button class="a-btn danger" @click="removeAlert(alert.id)">删除</button>
      </div>
    </div>

    <div class="log-section">
      <div class="log-head">
        <h3 class="log-title">告警记录</h3>
        <span class="log-count">{{ db.db.alertLogs.length }} 条 · {{ retentionLabel() }}</span>
        <div class="log-tools">
          <span class="log-retention-label">自动清除：</span>
          <select
            v-model.number="db.db.settings.alertLogRetentionDays"
            class="field select log-retention"
            @change="changeRetention"
          >
            <option v-for="opt in retentionOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
          <button class="a-btn" :class="{ danger: clearConfirming }" @click="clearLogs">
            {{ clearConfirming ? '再次点击确认清空' : '清空全部' }}
          </button>
        </div>
      </div>
      <p class="list-tip">
        每次预警触发时自动记录一条行为日志，便于复盘触发时的统计窗口、基准价、涨跌幅与阈值关系；
        记录按上方设置的周期自动清除（最短 1 天，选「永久保留」则不清除），也可手动单条删除。
      </p>
      <div class="log-list">
        <div v-if="db.db.alertLogs.length === 0" class="empty">暂无告警记录</div>
        <div v-for="log in db.db.alertLogs" :key="log.id" class="log-item">
          <div class="log-meta">
            <span class="log-time num">{{ fmtLogTime(log.firedAt) }}</span>
            <span class="log-name">{{ log.name }}</span>
            <span class="a-sym num">{{ log.symbol }}</span>
            <span class="log-badge" :class="logKindBadge(log).cls">{{ logKindBadge(log).text }}</span>
            <span class="log-pct" :class="log.changePercent >= 0 ? 'up' : 'down'">
              {{ log.changePercent >= 0 ? '+' : '' }}{{ log.changePercent.toFixed(2) }}%
            </span>
          </div>
          <div class="log-behavior">{{ log.behaviorText }}</div>
          <div class="log-foot">
            <span class="log-value num">
              {{ log.kind === 'price' ? `触发价 ${log.value}` : `涨跌幅 ${fmtSignedPct(log.value)}` }}
              <template v-if="log.refPrice !== null"> · 基准价 {{ log.refPrice }}</template>
              <template v-if="log.kind === 'changePercent'"> · 阈值 {{ log.threshold }}%</template>
            </span>
            <button class="a-btn danger" @click="removeLog(log.id)">删除</button>
          </div>
        </div>
      </div>
    </div>

    <p class="list-tip">
      涨跌幅统计：基准「昨收价」「今开价（每交易日自动换基准，长期有效）」或「添加时价（仅当日有效，次日自动暂停）」；
      统计窗口为滚动窗口（1 分钟～一个交易日），开市期间每 5 秒滚动计算、达到阈值立即告警，未达则持续统计；
      无窗口时按「从基准时刻至今」累计涨跌幅。仅对应市场开市期间检测；同规则每日至多提醒一次，次日自动重新布防。
      系统通知可能被 Windows 通知设置拦截，应用内顶部浮窗不受影响，可先用「发送测试提示」验证。
    </p>
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
  display: flex;
  align-items: center;
  gap: 10px;
}

.switch {
  padding: 2px 12px;
  border-radius: 999px;
  border: 1px solid var(--stroke-strong);
  background: transparent;
  color: var(--text-3);
  font-size: 11px;
  cursor: pointer;
  font-family: var(--sans);
}

.switch.on {
  border-color: var(--down);
  color: var(--down);
  background: var(--down-soft);
}

.test-btn {
  padding: 3px 12px;
  border-radius: 6px;
  border: 1px solid var(--gold);
  background: transparent;
  color: var(--gold-bright);
  font-size: 11px;
  cursor: pointer;
  font-family: var(--sans);
}

.mini-tip {
  font-size: 12px;
  color: var(--text-3);
  margin: -6px 0 12px;
  line-height: 1.6;
}

.mini-tip.ok {
  color: var(--down);
}

.a-live {
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 999px;
  white-space: nowrap;
}

.a-live.yes {
  color: var(--down);
  background: var(--down-soft);
}

.a-live.no {
  color: var(--text-3);
  background: rgba(255, 255, 255, 0.05);
}

.list-tip {
  font-size: 11px;
  color: var(--text-3);
  line-height: 1.7;
  margin: 12px 2px 0;
}

.add-form {
  display: flex;
  gap: 8px;
  padding: 14px;
  border-radius: var(--radius-m);
  margin-bottom: 16px;
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
}

.field:focus {
  border-color: var(--gold);
}

.select {
  min-width: 180px;
}

.select.slim {
  min-width: 110px;
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

.alert-list {
  border: 1px solid var(--stroke);
  border-radius: var(--radius-m);
  background: var(--bg-1);
}

.alert-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--stroke);
  font-size: 13px;
}

.alert-row:last-child {
  border-bottom: none;
}

.a-name {
  width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.a-sym {
  width: 76px;
  font-size: 11px;
  color: var(--text-3);
}

.a-rule {
  width: 300px;
  color: var(--gold-bright);
  font-size: 12px;
}

.a-note {
  flex: 1;
  color: var(--text-3);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.a-status {
  font-size: 11px;
  padding: 2px 10px;
  border-radius: 999px;
}

.a-status.on {
  color: var(--down);
  background: var(--down-soft);
}

.a-status.paused {
  color: var(--text-3);
  background: rgba(255, 255, 255, 0.05);
}

.a-status.hit {
  color: var(--up);
  background: var(--up-soft);
}

.a-btn {
  padding: 3px 12px;
  border-radius: 6px;
  border: 1px solid var(--stroke-strong);
  background: transparent;
  color: var(--text-2);
  font-size: 11px;
  cursor: pointer;
  font-family: var(--sans);
}

.a-btn.danger:hover {
  color: var(--up);
  border-color: rgba(229, 72, 77, 0.5);
}

.empty {
  padding: 32px;
  text-align: center;
  color: var(--text-3);
  font-size: 12px;
}

.log-section {
  margin-top: 22px;
  border: 1px solid var(--stroke);
  border-radius: var(--radius-m);
  background: var(--bg-1);
  padding: 14px 16px;
}

.log-head {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.log-title {
  font-size: 15px;
  font-weight: 800;
}

.log-count {
  font-size: 11px;
  color: var(--text-3);
}

.log-tools {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.log-retention-label {
  font-size: 12px;
  color: var(--text-3);
}

.log-retention {
  min-width: 190px;
  padding: 5px 10px;
  font-size: 12px;
}

.log-list {
  margin-top: 6px;
  max-height: 320px;
  overflow-y: auto;
  border: 1px solid var(--stroke);
  border-radius: var(--radius-s);
}

.log-item {
  padding: 10px 14px;
  border-bottom: 1px solid var(--stroke);
}

.log-item:last-child {
  border-bottom: none;
}

.log-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.log-time {
  font-size: 11px;
  color: var(--text-3);
}

.log-name {
  font-size: 13px;
  font-weight: 700;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-badge {
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 999px;
  white-space: nowrap;
}

.log-badge.up {
  color: var(--up);
  background: var(--up-soft);
}

.log-badge.down {
  color: var(--down);
  background: var(--down-soft);
}

.log-pct {
  font-size: 12px;
  font-weight: 700;
  margin-left: auto;
}

.log-pct.up {
  color: var(--up);
}

.log-pct.down {
  color: var(--down);
}

.log-behavior {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-2);
  padding: 8px 10px;
  border-radius: var(--radius-s);
  background: rgba(255, 255, 255, 0.04);
  border-left: 3px solid var(--gold);
}

.log-foot {
  margin-top: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.log-value {
  font-size: 11px;
  color: var(--text-3);
}
</style>
