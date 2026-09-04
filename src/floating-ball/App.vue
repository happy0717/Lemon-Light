<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useDbStore } from '../shared/stores/db'
import { useQuoteStore } from '../shared/stores/quotes'
import { bridge } from '../shared/bridge'
import {
  formatChangePercent,
  formatPrice,
  hexToRgba,
  readableOnBackground,
  trendClass
} from '../shared/format'
import { computeHoldings, totalProfit } from '../shared/holdings'
import { MARKET_INDEXES } from '@shared/symbol'
import logoUrl from '../shared/assets/logo.png'

const BALL_X = 14
const BALL_Y = 14
const BALL_D = 56
const LONG_PRESS_MS = 420

const db = useDbStore()
const quotes = useQuoteStore()

const expanded = ref(false)
const carouselIndex = ref(0)
const interactive = ref(false)
const suppressClick = ref(false)
const dragging = ref(false)
const longPressActive = ref(false)
let hoverTimer: number | null = null
let carouselTimer: number | null = null
let pressTimer: number | null = null
let pressStarted = false
let pressPos = { screenX: 0, screenY: 0 }
let offBallCollapse: (() => void) | null = null

const watchSymbols = computed(() => db.db.watchlist)
const quoteList = computed(() =>
  watchSymbols.value.map((s) => quotes.state.quotes[s]).filter(Boolean)
)

const currentQuote = computed(() => {
  if (quoteList.value.length === 0) return null
  return quoteList.value[carouselIndex.value % quoteList.value.length]
})

function indexName(symbol: string): string {
  return MARKET_INDEXES.find((i) => i.symbol === symbol)?.name ?? symbol
}

const indexRows = computed(() =>
  db.db.settings.mainMarketIndexes.slice(0, 3).map((symbol) => ({
    symbol,
    name: indexName(symbol),
    q: quotes.state.quotes[symbol]
  }))
)

const holdingsVisible = computed(() => db.db.settings.holdingProfitVisible)
const holdingSummaries = computed(() => computeHoldings(db.db.holdings, quotes.state.quotes))
const totalPnl = computed(() => totalProfit(holdingSummaries.value))

const panelStyle = computed(() => {
  const appr = db.db.settings.ballPanelAppearance
  const bg = hexToRgba(appr.backgroundColor, appr.opacity / 100)
  const light = readableOnBackground(appr.backgroundColor) === '#0d0f13'
  return {
    background: bg,
    '--text-1': light ? '#101216' : '#e9ecf1',
    '--text-2': light ? '#4b525c' : '#a9b1bc',
    '--text-3': light ? '#8a919b' : '#6c747f'
  } as unknown as Record<string, string>
})

function scheduleCollapse(): void {
  cancelCollapse()
  hoverTimer = window.setTimeout(() => collapse(), 2000)
}

function cancelCollapse(): void {
  if (hoverTimer !== null) {
    clearTimeout(hoverTimer)
    hoverTimer = null
  }
}

async function expand(): Promise<void> {
  if (expanded.value) return
  expanded.value = true
  bridge.setBallExpanded(true)
}

async function collapse(): Promise<void> {
  if (!expanded.value) return
  expanded.value = false
  bridge.setBallExpanded(false)
}

function isInsideBall(x: number, y: number): boolean {
  const r = BALL_D / 2 - 2
  const dx = x - (BALL_X + BALL_D / 2)
  const dy = y - (BALL_Y + BALL_D / 2)
  return Math.sqrt(dx * dx + dy * dy) <= r
}

function onMouseMove(e: MouseEvent): void {
  const w = window.innerWidth
  const h = window.innerHeight
  const inside = expanded.value
    ? e.clientX >= 0 && e.clientX <= w && e.clientY >= 0 && e.clientY <= h
    : isInsideBall(e.clientX, e.clientY)

  if (inside) {
    cancelCollapse()
    if (!interactive.value) {
      interactive.value = true
      bridge.setBallIgnoreMouse(false)
    }
  } else {
    if (interactive.value) {
      interactive.value = false
      bridge.setBallIgnoreMouse(true)
    }
    if (expanded.value) scheduleCollapse()
  }
}

function clearPressTimer(): void {
  if (pressTimer !== null) {
    clearTimeout(pressTimer)
    pressTimer = null
  }
}

function onBallPointerDown(e: PointerEvent): void {
  if (e.button !== 0 || expanded.value) return
  suppressClick.value = false
  dragging.value = false
  pressStarted = true
  pressPos = { screenX: e.screenX, screenY: e.screenY }
  clearPressTimer()
  pressTimer = window.setTimeout(() => {
    longPressActive.value = true
    dragging.value = true
    suppressClick.value = true
    bridge.ballDragStart(e.screenX - window.screenX, e.screenY - window.screenY)
  }, LONG_PRESS_MS)
}

function onPointerMove(e: PointerEvent): void {
  if (!pressStarted) return
  if (dragging.value) {
    bridge.ballDragMove(e.screenX, e.screenY)
    return
  }
  if (
    Math.hypot(e.screenX - pressPos.screenX, e.screenY - pressPos.screenY) > 6
  ) {
    pressStarted = false
    clearPressTimer()
  }
}

function onPointerUp(): void {
  if (!pressStarted && !dragging.value) return
  pressStarted = false
  clearPressTimer()
  if (dragging.value) {
    dragging.value = false
    longPressActive.value = false
    bridge.ballDragEnd()
  }
}

function onBallClick(): void {
  if (suppressClick.value) {
    suppressClick.value = false
    return
  }
  void expand()
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') void collapse()
}

onMounted(async () => {
  await db.init()
  await quotes.init()
  offBallCollapse = bridge.onBallCollapse(() => {
    void collapse()
  })
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('keydown', onKeydown)
  carouselTimer = window.setInterval(() => {
    if (!expanded.value && quoteList.value.length > 1) {
      carouselIndex.value = (carouselIndex.value + 1) % quoteList.value.length
    }
  }, 4000)
})

onBeforeUnmount(() => {
  offBallCollapse?.()
  offBallCollapse = null
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('keydown', onKeydown)
  if (carouselTimer !== null) clearInterval(carouselTimer)
  cancelCollapse()
  clearPressTimer()
})
</script>

<template>
  <div class="root" :class="{ expanded }">
    <!-- 悬浮球 -->
    <button
      v-if="!expanded"
      class="ball"
      :class="[currentQuote ? trendClass(currentQuote.changePercent) : 'flat', { dragging, 'long-press': longPressActive }]"
      @pointerdown="onBallPointerDown"
      @click="onBallClick"
      title="长按拖动位置，单击展开面板"
    >
      <span class="ball-glow"></span>
      <span class="ball-inner">
        <template v-if="currentQuote">
          <span class="ball-name">{{ currentQuote.name }}</span>
          <span class="ball-price num">{{ formatPrice(currentQuote.price, currentQuote) }}</span>
          <span class="ball-change num">
            {{ formatChangePercent(currentQuote.changePercent) }}
          </span>
        </template>
        <template v-else>
          <img class="ball-logo" :src="logoUrl" alt="" draggable="false" />
        </template>
      </span>
    </button>

    <!-- 展开面板 -->
    <div v-else class="panel glass-panel fade-in" :style="panelStyle">
      <header class="panel-header">
        <div class="panel-title">
          <img class="panel-logo" :src="logoUrl" alt="" draggable="false" />
          <span class="wordmark">Lemon Light</span>
        </div>
        <div class="panel-actions">
          <button class="icon-btn" title="设置" @click="bridge.openSettings()">⚙</button>
          <button class="icon-btn" title="收起" @click="collapse()">✕</button>
        </div>
      </header>

      <div v-if="indexRows.length" class="index-row">
        <div
          v-for="row in indexRows"
          :key="row.symbol"
          class="index-item"
          :class="row.q ? trendClass(row.q.changePercent) : 'flat'"
        >
          <span class="index-name">{{ row.name }}</span>
          <span class="num index-change">{{ row.q ? formatChangePercent(row.q.changePercent) : '--' }}</span>
        </div>
      </div>

      <div class="list">
        <div v-if="quoteList.length === 0" class="empty">
          自选列表为空，请打开设置添加股票
        </div>
        <div
          v-for="q in quoteList"
          :key="q.symbol"
          class="row"
          :class="trendClass(q.changePercent)"
        >
          <span class="row-name">{{ q.name }}</span>
          <span class="row-price num">{{ formatPrice(q.price, q) }}</span>
          <span class="row-change num">{{ formatChangePercent(q.changePercent) }}</span>
        </div>
      </div>

      <footer v-if="holdingsVisible && holdingSummaries.length" class="pnl">
        <span class="pnl-label">持仓盈亏</span>
        <span class="num pnl-value" :class="trendClass(totalPnl.profit)">
          {{ totalPnl.profit > 0 ? '+' : '' }}{{ totalPnl.profit.toFixed(0) }}
          ({{ formatChangePercent(totalPnl.percent) }})
        </span>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.root {
  width: 100vw;
  height: 100vh;
  position: relative;
  background: transparent;
}

.ball {
  position: absolute;
  top: v-bind('`${BALL_Y}px`');
  left: v-bind('`${BALL_X}px`');
  width: v-bind('`${BALL_D}px`');
  height: v-bind('`${BALL_D}px`');
  border-radius: 50%;
  border: 1px solid var(--stroke-strong);
  background: radial-gradient(circle at 32% 28%, #232833 0%, #101319 62%, #0a0c0f 100%);
  box-shadow:
    0 2px 8px rgba(0, 0, 0, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.09);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  outline: none;
  cursor: grab;
  touch-action: none;
}

.ball:hover {
  cursor: grab;
}

.ball.dragging,
.ball.long-press {
  cursor: grabbing;
  border-color: var(--gold);
  box-shadow:
    0 0 0 2px rgba(217, 171, 85, 0.35),
    0 2px 8px rgba(0, 0, 0, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.09);
}

.ball.dragging .ball-inner {
  opacity: 0.35;
}

.ball-glow {
  position: absolute;
  inset: -8px;
  border-radius: 50%;
  filter: blur(8px);
  opacity: 0.45;
  animation: breathe 3.2s ease-in-out infinite;
  pointer-events: none;
}

.ball.up .ball-glow {
  background: radial-gradient(circle, rgba(229, 72, 77, 0.55), transparent 70%);
}

.ball.down .ball-glow {
  background: radial-gradient(circle, rgba(38, 168, 120, 0.55), transparent 70%);
}

.ball.flat .ball-glow {
  background: radial-gradient(circle, rgba(217, 171, 85, 0.4), transparent 70%);
}

.ball-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  line-height: 1.15;
  transition: opacity 0.15s ease;
}

.ball-name {
  font-size: 9px;
  color: var(--text-2);
  max-width: 44px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ball-price {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.ball.up .ball-price { color: var(--up); }
.ball.down .ball-price { color: var(--down); }
.ball.flat .ball-price { color: var(--gold); }

.ball-change {
  font-size: 9px;
  font-weight: 600;
}

.ball.up .ball-change { color: var(--up); }
.ball.down .ball-change { color: var(--down); }
.ball.flat .ball-change { color: var(--flat); }

.ball-logo {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: contain;
  pointer-events: none;
  user-select: none;
}

.panel {
  position: absolute;
  inset: 0;
  border-radius: var(--radius-l);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 10px;
  -webkit-app-region: drag;
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.wordmark {
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 0.05em;
  background: linear-gradient(135deg, #fff7da 0%, #ffe28a 35%, #ffc73f 62%, #f2a93d 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  white-space: nowrap;
}

.panel-logo {
  width: 18px;
  height: 18px;
  border-radius: 5px;
  object-fit: contain;
  pointer-events: none;
  user-select: none;
}

.panel-actions {
  display: flex;
  gap: 6px;
  -webkit-app-region: no-drag;
}

.icon-btn {
  width: 26px;
  height: 26px;
  border-radius: 7px;
  border: 1px solid var(--stroke);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-2);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.icon-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-1);
}

.index-row {
  display: flex;
  gap: 6px;
  padding: 0 16px 10px;
}

.index-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px 4px;
  border-radius: var(--radius-s);
  background: rgba(255, 255, 255, 0.035);
}

.index-name {
  font-size: 10px;
  color: var(--text-3);
}

.index-change {
  font-size: 12px;
  font-weight: 700;
}

.index-item.up .index-change { color: var(--up); }
.index-item.down .index-change { color: var(--down); }
.index-item.flat .index-change { color: var(--flat); }

.list {
  flex: 1;
  overflow-y: auto;
  padding: 2px 8px;
}

.empty {
  padding: 28px 16px;
  text-align: center;
  font-size: 12px;
  color: var(--text-3);
  line-height: 1.8;
}

.row {
  display: flex;
  align-items: center;
  padding: 7px 10px;
  border-radius: var(--radius-s);
  gap: 8px;
}

.row:hover {
  background: rgba(255, 255, 255, 0.05);
}

.row-name {
  flex: 1;
  font-size: 12px;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-price {
  font-size: 13px;
  font-weight: 600;
}

.row-change {
  width: 64px;
  text-align: right;
  font-size: 12px;
  font-weight: 600;
}

.row.up .row-price, .row.up .row-change { color: var(--up); }
.row.down .row-price, .row.down .row-change { color: var(--down); }
.row.flat .row-price, .row.flat .row-change { color: var(--flat); }

.pnl {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-top: 1px solid var(--stroke);
  background: rgba(0, 0, 0, 0.25);
}

.pnl-label {
  font-size: 11px;
  color: var(--text-3);
}

.pnl-value {
  font-size: 14px;
  font-weight: 700;
}

.pnl-value.up { color: var(--up); }
.pnl-value.down { color: var(--down); }
.pnl-value.flat { color: var(--flat); }
</style>
