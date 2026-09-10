<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useDbStore } from '../../shared/stores/db'
import { useQuoteStore } from '../../shared/stores/quotes'
import type { BannerDisplayMode, BannerFontFamily, FloatingBallStockMode } from '@shared/types'
import { MARKET_INDEXES } from '@shared/symbol'

const db = useDbStore()
const quotes = useQuoteStore()

const banner = computed(() => db.db.settings.bottomBanner)
const ball = computed(() => db.db.settings.floatingBall)
const bannerAppr = computed(() => db.db.settings.bannerAppearance)
const ballPanelAppr = computed(() => db.db.settings.ballPanelAppearance)
const settingsAppr = computed(() => db.db.settings.settingsAppearance)
const boss = computed(() => db.db.settings.bossKey)
const recording = ref(false)
const pendingKey = ref('')

const PUNCT_KEYS = new Set([
  ')', '!', '@', '#', '$', '%', '^', '&', '*', '(', ':', ';', '+', '=', '<', ',', '_', '-',
  '>', '.', '?', '/', '~', '`', '{', ']', '[', '|', '\\', '}', '"'
])

const settingsPresets = [
  { name: '深空', color: '#0a0c10' },
  { name: '曜黑', color: '#1a1d23' },
  { name: '银灰', color: '#e9edf2' },
  { name: '暖白', color: '#f5efe3' }
]

async function patchBanner(partial: Partial<typeof banner.value>): Promise<void> {
  await db.patchSettings({ bottomBanner: { ...banner.value, ...partial } })
}

async function patchBall(partial: Partial<typeof ball.value>): Promise<void> {
  await db.patchSettings({ floatingBall: { ...ball.value, ...partial } })
}

async function patchBannerAppr(partial: Partial<typeof bannerAppr.value>): Promise<void> {
  await db.patchSettings({ bannerAppearance: { ...bannerAppr.value, ...partial } })
}

async function patchBallPanelAppr(partial: Partial<typeof ballPanelAppr.value>): Promise<void> {
  await db.patchSettings({ ballPanelAppearance: { ...ballPanelAppr.value, ...partial } })
}

async function patchSettingsAppr(partial: Partial<typeof settingsAppr.value>): Promise<void> {
  await db.patchSettings({ settingsAppearance: { ...settingsAppr.value, ...partial } })
}

async function patchBoss(partial: Partial<typeof boss.value>): Promise<void> {
  await db.patchSettings({ bossKey: { ...boss.value, ...partial } })
}

function normalizeRecordKey(e: KeyboardEvent): string | null {
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(e.key)) return e.key
  if (e.key === ' ') return 'Space'
  if (/^[a-zA-Z]$/.test(e.key)) return e.key.toUpperCase()
  if (/^[0-9]$/.test(e.key)) return e.key
  if (e.key.length === 1 && PUNCT_KEYS.has(e.key)) return e.key === '+' ? 'Plus' : e.key
  const special: Record<string, string> = {
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Insert: 'Insert',
    Delete: 'Delete'
  }
  return special[e.key] ?? null
}

function onRecordKeydown(e: KeyboardEvent): void {
  e.preventDefault()
  e.stopPropagation()
  if (e.key === 'Escape') {
    recording.value = false
    return
  }
  const mods: string[] = []
  if (e.ctrlKey || e.metaKey) mods.push('CommandOrControl')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  const key = normalizeRecordKey(e)
  if (!key) return
  if (!key.startsWith('F') && mods.length === 0) return
  pendingKey.value = [...mods, key].join('+')
  recording.value = false
  void patchBoss({ accelerator: pendingKey.value })
}

function acceleratorLabel(acc: string): string {
  if (!acc) return '未设置'
  return acc
    .split('+')
    .map((p) => {
      switch (p) {
        case 'CommandOrControl':
          return 'Ctrl'
        case 'Plus':
          return '+'
        case 'Space':
          return '空格'
        default:
          return p
      }
    })
    .join(' + ')
}

watch(recording, (on) => {
  if (on) window.addEventListener('keydown', onRecordKeydown, true)
  else window.removeEventListener('keydown', onRecordKeydown, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onRecordKeydown, true)
})

const displayModes: Array<{ value: BannerDisplayMode; label: string; desc: string }> = [
  { value: 'primary', label: '仅主屏', desc: '横幅只在主显示器显示' },
  { value: 'mirror', label: '多屏同步', desc: '每个显示器都显示完整横幅' },
  { value: 'split', label: '多屏分摊', desc: '自选股按屏数均分，每屏显示一段' }
]

const bannerLayouts: Array<{ value: string; label: string; desc: string }> = [
  {
    value: 'rows',
    label: '多行滚动',
    desc: '每行独立横向滚动，行数越多同时展示的股票越多'
  },
  {
    value: 'stacked',
    label: '信息堆叠',
    desc: '每只股票上下两行显示名称/价格/涨跌/市场状态，信息更丰富'
  },
  {
    value: 'dual',
    label: '双行分工',
    desc: '第一行滚动指数+自选股，第二行轮播有效预警或行情状态'
  }
]

const fontFamilies: Array<{ value: BannerFontFamily; label: string }> = [
  { value: '', label: '系统默认' },
  { value: 'Microsoft YaHei', label: '微软雅黑' },
  { value: 'SimHei', label: '黑体' },
  { value: 'SimSun', label: '宋体' },
  { value: 'KaiTi', label: '楷体' }
]

const ballStockModes: Array<{ value: FloatingBallStockMode; label: string; desc: string }> = [
  {
    value: 'dayChange',
    label: '当日涨幅',
    desc: '圆球与自选列表显示股票当日涨跌幅'
  },
  {
    value: 'holdingPnl',
    label: '持仓收益',
    desc: '折叠圆球显示全部持仓的总盈亏（金额在上、百分比在下）；展开列表逐只显示持仓股的收益金额与收益率'
  }
]

const fontWeights = [
  { value: 400, label: '标准' },
  { value: 600, label: '中等' },
  { value: 800, label: '加粗' }
]

function toggleIndexSymbol(symbol: string): void {
  const list = banner.value.marketIndexSymbols
  const next = list.includes(symbol)
    ? list.filter((s) => s !== symbol)
    : [...list, symbol]
  void patchBanner({ marketIndexSymbols: next })
}

function toggleMainIndex(symbol: string): void {
  const list = db.db.settings.mainMarketIndexes
  const next = list.includes(symbol) ? list.filter((s) => s !== symbol) : [...list, symbol]
  void db.patchSettings({ mainMarketIndexes: next })
}
</script>

<template>
  <section class="tab">
    <h2 class="tab-title">外观与行为</h2>
    <p class="tab-desc">所有改动即时生效</p>

    <h3 class="section-title">底部横幅</h3>
    <div class="card">
      <div class="row-line">
        <span class="line-label">显示横幅</span>
        <button class="switch" :class="{ on: banner.visible }" @click="patchBanner({ visible: !banner.visible })">
          {{ banner.visible ? '开' : '关' }}
        </button>
      </div>

      <div class="row-line">
        <span class="line-label">横幅背景色</span>
        <input
          type="color"
          :value="bannerAppr.backgroundColor"
          class="color-input"
          @input="patchBannerAppr({ backgroundColor: ($event.target as HTMLInputElement).value })"
        />
        <span class="num">{{ bannerAppr.backgroundColor }}</span>
      </div>

      <div class="row-line">
        <span class="line-label">横幅不透明度</span>
        <input
          type="range"
          min="40"
          max="100"
          :value="bannerAppr.opacity"
          class="slider"
          @change="patchBannerAppr({ opacity: Number(($event.target as HTMLInputElement).value) })"
        />
        <span class="num slider-value">{{ bannerAppr.opacity }}%</span>
      </div>

      <div class="row-line">
        <span class="line-label">显示模式</span>
        <div class="mode-group">
          <button
            v-for="m in displayModes"
            :key="m.value"
            class="mode-btn"
            :class="{ active: banner.displayMode === m.value }"
            :title="m.desc"
            @click="patchBanner({ displayMode: m.value })"
          >
            {{ m.label }}
          </button>
        </div>
      </div>
      <p class="mode-desc">{{ displayModes.find((m) => m.value === banner.displayMode)?.desc }}</p>

      <div class="row-line">
        <span class="line-label">交易时段自动显隐</span>
        <button class="switch" :class="{ on: banner.autoHide }" @click="patchBanner({ autoHide: !banner.autoHide })">
          {{ banner.autoHide ? '开' : '关' }}
        </button>
      </div>
      <p class="mode-desc">开启后每日开盘前 5 分钟即提前显示（可观察竞价/开盘价），收盘后 30 分钟内保持显示尾盘价，其余休市时段自动隐藏。</p>

      <div class="row-line">
        <span class="line-label">滚动速度</span>
        <input
          type="range"
          min="10"
          max="100"
          :value="banner.scrollSpeed"
          class="slider"
          @change="patchBanner({ scrollSpeed: Number(($event.target as HTMLInputElement).value) })"
        />
        <span class="num slider-value">{{ banner.scrollSpeed }}</span>
      </div>

      <div class="row-line">
        <span class="line-label">显示布局</span>
        <select
          class="select"
          :value="banner.layout"
          @change="patchBanner({ layout: ($event.target as HTMLSelectElement).value as typeof banner.layout })"
        >
          <option v-for="l in bannerLayouts" :key="l.value" :value="l.value">
            {{ l.label }}
          </option>
        </select>
      </div>
      <p class="mode-desc">
        {{ bannerLayouts.find((l) => l.value === banner.layout)?.desc }}
      </p>

      <div v-if="banner.layout === 'rows'" class="row-line">
        <span class="line-label">行数</span>
        <div class="mode-group">
          <button
            v-for="n in [1, 2, 3]"
            :key="n"
            class="mode-btn"
            :class="{ active: banner.rows === n }"
            @click="patchBanner({ rows: n })"
          >
            {{ n }} 行
          </button>
        </div>
      </div>

      <div class="row-line">
        <span class="line-label">字号</span>
        <input
          type="range"
          min="10"
          max="22"
          :value="banner.fontSize"
          class="slider"
          @change="patchBanner({ fontSize: Number(($event.target as HTMLInputElement).value) })"
        />
        <span class="num slider-value">{{ banner.fontSize }}px</span>
      </div>

      <div class="row-line">
        <span class="line-label">字重</span>
        <div class="mode-group">
          <button
            v-for="w in fontWeights"
            :key="w.value"
            class="mode-btn"
            :class="{ active: banner.fontWeight === w.value }"
            @click="patchBanner({ fontWeight: w.value })"
          >
            {{ w.label }}
          </button>
        </div>
      </div>

      <div class="row-line">
        <span class="line-label">字体</span>
        <select
          class="select"
          :value="banner.fontFamily"
          @change="
            patchBanner({
              fontFamily: ($event.target as HTMLSelectElement).value as typeof banner.fontFamily
            })
          "
        >
          <option v-for="f in fontFamilies" :key="f.value" :value="f.value">
            {{ f.label }}
          </option>
        </select>
      </div>

      <p class="tip">
        长按横幅空白处（或左侧把手）可拖动横幅到桌面任意位置并记忆；双击左侧把手回到底部。
      </p>

      <div class="row-line">
        <span class="line-label">显示指数</span>
        <button
          class="switch"
          :class="{ on: banner.showMarketIndexes }"
          @click="patchBanner({ showMarketIndexes: !banner.showMarketIndexes })"
        >
          {{ banner.showMarketIndexes ? '开' : '关' }}
        </button>
      </div>

      <div v-if="banner.showMarketIndexes" class="chips-line">
        <span class="chips-label">横幅指数：</span>
        <button
          v-for="idx in MARKET_INDEXES"
          :key="idx.symbol"
          class="chip"
          :class="{ on: banner.marketIndexSymbols.includes(idx.symbol) }"
          @click="toggleIndexSymbol(idx.symbol)"
        >
          {{ idx.name }}
        </button>
      </div>

      <div class="row-line">
        <span class="line-label">股票后持仓盈亏</span>
        <button
          class="switch"
          :class="{ on: banner.showHoldingsPnl }"
          @click="patchBanner({ showHoldingsPnl: !banner.showHoldingsPnl })"
        >
          {{ banner.showHoldingsPnl ? '开' : '关' }}
        </button>
      </div>
      <p class="mode-desc">
        开启后，在「持仓盈亏」页录入过交易的股票，会在当日涨跌之后追加显示
        <b>持仓盈亏金额 | 收益率</b>（按最新价与含佣金税费的持仓成本实时估算），并随盈亏方向变色。
        未记录持仓的股票不受影响。请注意：当日涨幅反映当天价格变动，持仓盈亏是自买入以来的累计结果，两者含义不同，不要混淆。默认关闭。
      </p>

      <div class="row-line">
        <span class="line-label">涨跌幅/涨跌额翻转</span>
        <button
          class="switch"
          :class="{ on: banner.flipChangeAmount }"
          @click="patchBanner({ flipChangeAmount: !banner.flipChangeAmount })"
        >
          {{ banner.flipChangeAmount ? '开' : '关' }}
        </button>
      </div>
      <p class="mode-desc">
        开启后，横幅内每只股票的涨跌字段会<b>每 2 秒在「涨跌幅」与「涨跌额」之间翻转</b>
        （例如 +9.41% ⇄ +0.08），三种布局统一生效，颜色随当日涨跌保持一致。默认关闭：rows / dual
        仅显示涨跌幅，堆叠布局显示「涨跌额 + 涨跌幅」。
      </p>

      <div class="row-line">
        <span class="line-label">鼠标穿透</span>
        <button
          class="switch"
          :class="{ on: banner.clickThrough }"
          @click="patchBanner({ clickThrough: !banner.clickThrough })"
        >
          {{ banner.clickThrough ? '开' : '关' }}
        </button>
      </div>
      <p class="mode-desc">
        开启后鼠标可<b>穿透横幅</b>，直接点击横幅下方的窗口与桌面图标，横幅不再遮挡操作。
        此时横幅仅能通过<b>左侧把手</b>长按拖动、双击复位；条目拖拽排序在穿透期间不可用。
        关闭后横幅整体恢复可交互。默认开启。
      </p>
    </div>

    <h3 class="section-title">悬浮球</h3>
    <div class="card">
      <div class="row-line">
        <span class="line-label">显示悬浮球</span>
        <button class="switch" :class="{ on: ball.visible }" @click="patchBall({ visible: !ball.visible })">
          {{ ball.visible ? '开' : '关' }}
        </button>
      </div>
      <div class="row-line">
        <span class="line-label">休市自动隐藏</span>
        <button
          class="switch"
          :class="{ on: ball.autoHideWhenClosed }"
          @click="patchBall({ autoHideWhenClosed: !ball.autoHideWhenClosed })"
        >
          {{ ball.autoHideWhenClosed ? '开' : '关' }}
        </button>
      </div>
      <div class="row-line">
        <span class="line-label">个股显示</span>
        <div class="mode-group">
          <button
            v-for="m in ballStockModes"
            :key="m.value"
            class="mode-btn"
            :class="{ active: ball.stockMode === m.value }"
            @click="patchBall({ stockMode: m.value })"
          >
            {{ m.label }}
          </button>
        </div>
      </div>
      <p class="mode-desc">
        {{ ballStockModes.find((m) => m.value === ball.stockMode)?.desc }}。
        选择「持仓收益」后：折叠圆球展示的是<b>全部持仓合计的总盈亏</b>（金额在上、百分比在下，金额 ≥1 万时以「万」缩写），
        与圆球当前轮播到哪只股票无关；展开面板的列表则对录过持仓的股票逐只显示收益金额与收益率，
        未记录持仓的自选股自动回退显示当日涨幅；尚未录入任何持仓时圆球维持当日涨幅。数值均按最新行情实时估算并随盈亏方向变色。
      </p>
      <div class="row-line">
        <span class="line-label">面板背景色</span>
        <input
          type="color"
          :value="ballPanelAppr.backgroundColor"
          class="color-input"
          @input="patchBallPanelAppr({ backgroundColor: ($event.target as HTMLInputElement).value })"
        />
        <span class="num">{{ ballPanelAppr.backgroundColor }}</span>
      </div>
      <div class="row-line">
        <span class="line-label">面板不透明度</span>
        <input
          type="range"
          min="40"
          max="100"
          :value="ballPanelAppr.opacity"
          class="slider"
          @change="patchBallPanelAppr({ opacity: Number(($event.target as HTMLInputElement).value) })"
        />
        <span class="num slider-value">{{ ballPanelAppr.opacity }}%</span>
      </div>
      <p class="tip">长按悬浮球即可拖动位置，松开后自动记忆；单击悬浮球展开完整面板，移开后自动收起。休市自动隐藏开启后，自选覆盖的市场全部休市（含午休与周末）时悬浮球自动隐藏；每日开盘前 5 分钟即提前显示以观察竞价/开盘价，收盘后 30 分钟内保持显示尾盘价。面板背景色只作用于展开面板，与底部横幅配色相互独立。</p>
    </div>

    <h3 class="section-title">老板键</h3>
    <div class="card">
      <div class="row-line">
        <span class="line-label">启用老板键</span>
        <button
          class="switch"
          :class="{ on: boss.enabled }"
          @click="patchBoss({ enabled: !boss.enabled })"
        >
          {{ boss.enabled ? '开' : '关' }}
        </button>
      </div>
      <div class="row-line">
        <span class="line-label">快捷键</span>
        <button
          class="mode-btn record-btn"
          :class="{ active: recording }"
          @click="recording = !recording"
        >
          {{ recording ? '请按下组合键…（Esc 取消）' : acceleratorLabel(boss.accelerator) }}
        </button>
        <span v-if="recording" class="recording-hint">录制中：支持字母 / 数字 / 功能键及 - + = 等符号，需搭配 Ctrl、Alt、Shift，或单独的功能键</span>
      </div>
      <p class="tip">全局生效：按下快捷键即可一键隐藏底部横幅与悬浮球，再次按下恢复（不会改动上面的显示开关，可与休市自动隐藏叠加）。托盘菜单提供相同入口。</p>
    </div>

    <h3 class="section-title">设置页外观</h3>
    <div class="card">
      <div class="row-line">
        <span class="line-label">背景色</span>
        <input
          type="color"
          :value="settingsAppr.backgroundColor"
          class="color-input"
          @input="patchSettingsAppr({ backgroundColor: ($event.target as HTMLInputElement).value })"
        />
        <span class="num">{{ settingsAppr.backgroundColor }}</span>
      </div>
      <div class="row-line">
        <span class="line-label">预设配色</span>
        <div class="chips-line wrap">
          <button
            v-for="p in settingsPresets"
            :key="p.color"
            class="chip"
            :class="{ on: settingsAppr.backgroundColor === p.color }"
            @click="patchSettingsAppr({ backgroundColor: p.color })"
          >
            <span class="preset-dot" :style="{ background: p.color }"></span>
            {{ p.name }}
          </button>
        </div>
      </div>
      <p class="tip">只改变设置页窗口本身的配色；文字、卡片、边框颜色会根据所选背景的明暗自动适配。</p>
    </div>

    <h3 class="section-title">行情与数据</h3>
    <div class="card">
      <div class="row-line">
        <span class="line-label">刷新间隔</span>
        <div class="mode-group">
          <button
            v-for="ms in [1000, 3000, 5000, 10000, 30000]"
            :key="ms"
            class="mode-btn"
            :class="{ active: db.db.settings.refreshIntervalMs === ms }"
            @click="db.patchSettings({ refreshIntervalMs: ms })"
          >
            {{ ms / 1000 }}s
          </button>
        </div>
      </div>
      <div class="row-line">
        <span class="line-label">悬浮球面板指数</span>
        <div class="chips-line wrap">
          <button
            v-for="idx in MARKET_INDEXES"
            :key="idx.symbol"
            class="chip"
            :class="{ on: db.db.settings.mainMarketIndexes.includes(idx.symbol) }"
            @click="toggleMainIndex(idx.symbol)"
          >
            {{ idx.name }}
          </button>
        </div>
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

.section-title {
  margin: 22px 0 10px;
  font-size: 15px;
  font-weight: 700;
}

.card {
  border: 1px solid var(--stroke);
  border-radius: var(--radius-m);
  background: var(--bg-1);
  padding: 6px 16px;
}

.row-line {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 11px 0;
  border-bottom: 1px solid var(--stroke);
  flex-wrap: wrap;
}

.row-line:last-child {
  border-bottom: none;
}

.line-label {
  width: 140px;
  font-size: 13px;
  color: var(--text-2);
  flex-shrink: 0;
}

.switch {
  padding: 3px 16px;
  border-radius: 999px;
  border: 1px solid var(--stroke-strong);
  background: transparent;
  color: var(--text-3);
  font-size: 12px;
  cursor: pointer;
  font-family: var(--sans);
  transition: all 0.15s ease;
}

.switch.on {
  border-color: var(--gold);
  color: var(--gold-bright);
  background: rgba(217, 171, 85, 0.12);
}

.mode-group {
  display: flex;
  gap: 6px;
}

.mode-btn {
  padding: 6px 14px;
  border-radius: var(--radius-s);
  border: 1px solid var(--stroke-strong);
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
  cursor: pointer;
  font-family: var(--sans);
  transition: all 0.15s ease;
}

.mode-btn.active {
  border-color: var(--gold);
  color: var(--gold-bright);
  background: rgba(217, 171, 85, 0.12);
}

.mode-desc {
  font-size: 11px;
  color: var(--text-3);
  padding: 4px 0 10px 154px;
  margin: 0;
}

.slider {
  flex: 1;
  max-width: 260px;
  accent-color: var(--gold);
}

.slider-value {
  width: 46px;
  font-size: 12px;
  color: var(--text-2);
}

.select {
  min-width: 150px;
  padding: 6px 10px;
  border-radius: var(--radius-s);
  border: 1px solid var(--stroke-strong);
  background: var(--bg-2);
  color: var(--text-1);
  font-size: 12px;
  font-family: var(--sans);
  cursor: pointer;
  outline: none;
}

.select:focus {
  border-color: var(--gold);
}

.color-input {
  width: 44px;
  height: 30px;
  border: 1px solid var(--stroke-strong);
  border-radius: 7px;
  background: var(--bg-2);
  cursor: pointer;
}

.chips-line {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.chips-line.wrap {
  flex: 1;
}

.chips-label {
  font-size: 12px;
  color: var(--text-3);
}

.chip {
  padding: 3px 12px;
  border-radius: 999px;
  border: 1px solid var(--stroke-strong);
  background: transparent;
  color: var(--text-3);
  font-size: 11px;
  cursor: pointer;
  font-family: var(--sans);
  transition: all 0.15s ease;
}

.chip.on {
  border-color: var(--gold);
  color: var(--gold-bright);
  background: rgba(217, 171, 85, 0.12);
}

.preset-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-right: 5px;
  vertical-align: -1px;
  border: 1px solid var(--stroke-strong);
}

.tip {
  font-size: 11px;
  color: var(--text-3);
  line-height: 1.7;
  padding: 8px 0;
  margin: 0;
}

.record-btn {
  min-width: 220px;
  font-variant-ligatures: none;
}

.recording-hint {
  font-size: 11px;
  color: var(--gold);
  flex: 1;
  min-width: 180px;
}
</style>
