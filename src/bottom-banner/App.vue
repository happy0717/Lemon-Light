<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useDbStore } from '../shared/stores/db'
import { useQuoteStore } from '../shared/stores/quotes'
import { bridge } from '../shared/bridge'
import {
  formatChangePercent,
  formatPrice,
  trendClass,
  hexToRgba,
  readableOnBackground
} from '../shared/format'
import { computeHoldings } from '../shared/holdings'
import { anyMarketOpen, anyMarketOverlayShown } from '@shared/market-hours'
import { MARKET_INDEXES } from '@shared/symbol'
import type { Quote } from '@shared/types'

const LONG_PRESS_MS = 420

const db = useDbStore()
const quotes = useQuoteStore()

const params = new URLSearchParams(window.location.search)
const screenIndex = Number(params.get('screen') ?? '0')
const screenTotal = Math.max(1, Number(params.get('total') ?? '1'))
const displayKey = params.get('did') ?? '0'

const hidden = ref(false)
const dragActive = ref(false)
let autoHideTimer: number | null = null
let pressTimer: number | null = null
let pressStarted = false
let pressPos = { screenX: 0, screenY: 0 }
let resizeObserver: ResizeObserver | null = null
const contentEl = ref<HTMLElement | null>(null)

const bannerSettings = computed(() => db.db.settings.bottomBanner)
const layout = computed(() => bannerSettings.value.layout)
const fontSize = computed(() => bannerSettings.value.fontSize || 13)
const fontWeight = computed(() => bannerSettings.value.fontWeight || 400)
const fontFamily = computed(() => bannerSettings.value.fontFamily || '')

const isSplit = computed(() => bannerSettings.value.displayMode === 'split')
const showIndexesHere = computed(() => !isSplit.value || screenIndex === 0)

function indexName(symbol: string): string {
  return MARKET_INDEXES.find((i) => i.symbol === symbol)?.name ?? symbol
}

const indexRows = computed(() =>
  bannerSettings.value.marketIndexSymbols.map((symbol) => ({
    symbol,
    name: indexName(symbol),
    q: quotes.state.quotes[symbol]
  }))
)

const screenSymbols = computed(() => {
  const list = db.db.watchlist
  if (!isSplit.value || screenTotal <= 1) return list
  const per = Math.ceil(list.length / screenTotal)
  const start = screenIndex * per
  return list.slice(start, start + per)
})

function toQuotes(symbols: string[]): Quote[] {
  return symbols.map((s) => quotes.state.quotes[s]).filter(Boolean) as Quote[]
}

const stockQuotes = computed(() => toQuotes(screenSymbols.value))

const showHoldingsPnl = computed(() => bannerSettings.value.showHoldingsPnl)
const holdingPnlMap = computed(() => {
  const map = new Map<string, { profit: number; percent: number }>()
  for (const s of computeHoldings(db.db.holdings, quotes.state.quotes)) {
    map.set(s.symbol, { profit: s.profit, percent: s.profitPercent })
  }
  return map
})

function pnlOf(symbol: string): { profit: number; percent: number } | null {
  if (!showHoldingsPnl.value) return null
  return holdingPnlMap.value.get(symbol) ?? null
}

function signMoney(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}`
}

function pnlText(symbol: string): string {
  const p = pnlOf(symbol)
  return p ? `盈亏 ${signMoney(p.profit)} | ${formatChangePercent(p.percent)}` : ''
}

const rowLines = computed(() => {
  const all = stockQuotes.value
  if (all.length === 0) {
    return [{ key: 'empty', index: true, items: [] as Quote[], scroll: false, static: true }]
  }
  const n = Math.min(3, Math.max(1, bannerSettings.value.rows || 1))
  const per = Math.ceil(all.length / n)
  const lines: Array<{
    key: string
    index: boolean
    items: Quote[]
    scroll: boolean
    static: boolean
  }> = []
  for (let i = 0; i < n; i++) {
    const slice = all.slice(i * per, i * per + per)
    if (slice.length === 0 && i > 0) continue
    lines.push({
      key: `r${i}`,
      index: i === 0,
      items: slice,
      scroll: slice.length > 12,
      static: slice.length <= 12
    })
  }
  return lines
})

const stackedLine = computed(() => {
  const all = stockQuotes.value
  return {
    items: all,
    scroll: all.length > 9,
    empty: all.length === 0
  }
})

const reorderEnabled = computed(
  () => layout.value === 'rows' && rowLines.value.length === 1 && rowLines.value[0]?.static === true
)

const alertTexts = computed(() => {
  return db.db.alerts
    .filter((a) => a.enabled && !a.triggered)
    .map((a) => {
      const q = quotes.state.quotes[a.symbol]
      const name = q?.name ?? a.symbol
      const op = a.direction === 'gte' ? '突破' : '跌破'
      const value = a.kind === 'price' ? `${a.threshold} 元` : `${a.threshold}%`
      return {
        text: `⚡ ${name} ${a.kind === 'price' ? '价格' : '涨跌幅'} ${op} ${value}`,
        symbol: a.symbol
      }
    })
})

const marketStatusText = computed(() => {
  const symbols = [...db.db.watchlist, ...bannerSettings.value.marketIndexSymbols]
  const state = anyMarketOpen(symbols) ? '开市' : '休市'
  const time = quotes.state.lastUpdated
    ? new Date(quotes.state.lastUpdated).toLocaleTimeString('zh-CN', { hour12: false })
    : '--'
  return `行情 ${time} · ${state} · 双击左侧把手回到底部`
})

const dualMeta = computed(() => {
  const alerts = alertTexts.value
  return {
    items: alerts.length > 0 ? alerts.map((a) => a.text) : [marketStatusText.value],
    scroll: alerts.length > 8
  }
})

const scrollDuration = computed(() => {
  const speed = bannerSettings.value.scrollSpeed
  return `${Math.max(8, 64 - speed * 0.56) * 6}s`
})

const bannerStyle = computed(() => {
  const appr = db.db.settings.bannerAppearance
  const bg = hexToRgba(appr.backgroundColor, appr.opacity / 100)
  const light = readableOnBackground(appr.backgroundColor) === '#0d0f13'
  const ff = fontFamily.value
    ? `"${fontFamily.value}", var(--sans)`
    : 'var(--sans)'
  return {
    background: bg,
    '--bf': `${fontSize.value}px`,
    '--bw': String(fontWeight.value),
    '--ff': ff,
    '--mt': scrollDuration.value,
    '--text-1': light ? '#101216' : '#e9ecf1',
    '--text-2': light ? '#4b525c' : '#a9b1bc',
    '--text-3': light ? '#8a919b' : '#6c747f'
  } as unknown as Record<string, string>
})

function evalAutoHide(): void {
  if (!bannerSettings.value.autoHide) {
    hidden.value = false
    return
  }
  const symbols = [...db.db.watchlist, ...bannerSettings.value.marketIndexSymbols]
  hidden.value = !anyMarketOverlayShown(symbols)
}

function reportHeight(): void {
  const el = contentEl.value
  if (!el) return
  bridge.reportBannerContentHeight(displayKey, Math.ceil(el.getBoundingClientRect().height))
}

function clearPressTimer(): void {
  if (pressTimer !== null) {
    clearTimeout(pressTimer)
    pressTimer = null
  }
}

function beginBannerDrag(e: PointerEvent): void {
  dragActive.value = true
  bridge.bannerDragStart(
    displayKey,
    Math.round(e.screenX - window.screenX),
    Math.round(e.screenY - window.screenY)
  )
}

function onAreaPointerDown(e: PointerEvent, fromGrip = false): void {
  if (e.button !== 0) return
  const target = e.target as HTMLElement
  if (!fromGrip) {
    if (target.closest('.pill-wrap') || target.closest('.drag-hint')) return
  }
  pressStarted = true
  pressPos = { screenX: e.screenX, screenY: e.screenY }
  clearPressTimer()
  pressTimer = window.setTimeout(() => beginBannerDrag(e), LONG_PRESS_MS)
}

function onPointerMove(e: PointerEvent): void {
  if (dragActive.value) {
    bridge.bannerDragMove(displayKey, Math.round(e.screenX), Math.round(e.screenY))
    return
  }
  if (!pressStarted) return
  if (Math.hypot(e.screenX - pressPos.screenX, e.screenY - pressPos.screenY) > 6) {
    pressStarted = false
    clearPressTimer()
  }
}

function onPointerUp(): void {
  pressStarted = false
  clearPressTimer()
  if (dragActive.value) {
    dragActive.value = false
    bridge.bannerDragEnd(displayKey)
  }
}

function onReset(): void {
  bridge.bannerReset(displayKey)
}

async function commitOrder(from: number, to: number): Promise<void> {
  const full = [...db.db.watchlist]
  if (isSplit.value && screenTotal > 1) {
    const per = Math.ceil(full.length / screenTotal)
    const start = screenIndex * per
    const segment = full.slice(start, start + per)
    const [moved] = segment.splice(from, 1)
    segment.splice(to, 0, moved!)
    full.splice(start, segment.length, ...segment)
  } else {
    const [moved] = full.splice(from, 1)
    full.splice(to, 0, moved!)
  }
  await db.setWatchlist(full)
}

const dragging = ref<number | null>(null)
const dragOver = ref<number | null>(null)
let dragStart: { x: number; y: number } | null = null

function onPillDown(e: PointerEvent, index: number): void {
  if (e.button !== 0) return
  dragStart = { x: e.clientX, y: e.clientY }
  dragging.value = null
  const move = (ev: PointerEvent) => {
    if (!dragStart) return
    const dx = ev.clientX - dragStart.x
    const dy = ev.clientY - dragStart.y
    if (dragging.value === null && Math.hypot(dx, dy) > 5) {
      dragging.value = index
    }
  }
  const up = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    if (dragging.value !== null && dragOver.value !== null && dragOver.value !== dragging.value) {
      void commitOrder(dragging.value, dragOver.value)
    }
    dragStart = null
    dragging.value = null
    dragOver.value = null
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

function onPillEnter(index: number): void {
  if (dragging.value !== null) dragOver.value = index
}

function changeAmount(q: Quote): string {
  return `${q.change > 0 ? '+' : ''}${q.change.toFixed(2)}`
}

function trend(q: Quote): string {
  return trendClass(q.changePercent)
}

function marketTag(q: Quote): string {
  return `${q.marketLabel} · ${q.status}`
}

onMounted(async () => {
  await db.init()
  await quotes.init()
  evalAutoHide()
  autoHideTimer = window.setInterval(evalAutoHide, 60_000)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  requestAnimationFrame(reportHeight)
  requestAnimationFrame(() => {
    if (contentEl.value) {
      resizeObserver = new ResizeObserver(reportHeight)
      resizeObserver.observe(contentEl.value)
    }
  })
})

watch(
  () => [
    bannerSettings.value.autoHide,
    bannerSettings.value.visible,
    db.db.watchlist.join(','),
    bannerSettings.value.marketIndexSymbols.join(',')
  ],
  () => evalAutoHide()
)

onBeforeUnmount(() => {
  if (autoHideTimer !== null) clearInterval(autoHideTimer)
  clearPressTimer()
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  resizeObserver?.disconnect()
})
</script>

<template>
  <div
    ref="contentEl"
    class="banner"
    :class="[{ hidden, dragging: dragActive }, `layout-${layout}`]"
    :style="bannerStyle"
    @pointerdown="onAreaPointerDown"
  >
    <div
      class="grip"
      :class="{ active: dragActive }"
      title="长按拖动横幅位置 · 双击回到底部"
      @pointerdown.stop="onAreaPointerDown($event, true)"
      @dblclick.stop="onReset"
    >
      <i></i><i></i><i></i>
    </div>
    <div v-if="dragActive" class="drag-hint">松开固定位置 · 双击左侧把手回到底部</div>

    <div class="stage">
      <!-- 多行滚动 -->
      <template v-if="layout === 'rows'">
        <div v-for="line in rowLines" :key="line.key" class="banner-line">
          <div
            v-if="line.index && showIndexesHere && bannerSettings.showMarketIndexes && indexRows.length"
            class="index-strip"
          >
            <span v-for="row in indexRows" :key="row.symbol" class="idx" :class="row.q ? trend(row.q) : 'flat'">
              {{ row.name }}
              <span class="num">{{ row.q ? formatChangePercent(row.q.changePercent) : '--' }}</span>
            </span>
            <span class="divider"></span>
          </div>

          <div class="line-scroll" :class="{ scroll: line.scroll }">
            <div class="line-track">
              <div v-for="copy in line.scroll ? 2 : 1" :key="`c${copy}`" class="copy" :class="{ dup: copy > 1 }">
                <template v-if="line.items.length">
                  <div
                    v-for="(q, i) in line.items"
                    :key="`${copy}-${q.symbol}`"
                    class="pill-wrap"
                    :class="{
                      dragging: dragging === i && copy === 1,
                      'drag-over-before':
                        dragOver === i && dragging !== null && dragging < i && copy === 1,
                      'drag-over-after':
                        dragOver === i &&
                        dragging !== null &&
                        dragging > i &&
                        i === line.items.length - 1 &&
                        copy === 1
                    }"
                    :title="reorderEnabled ? `${q.name} ${q.symbol}（拖动调整顺序）` : `${q.name} ${q.symbol}`"
                    @pointerdown="reorderEnabled && copy === 1 ? onPillDown($event, i) : undefined"
                    @pointerenter="reorderEnabled && copy === 1 ? onPillEnter(i) : undefined"
                  >
                    <span class="p-name">{{ q.name }}</span>
                    <span class="p-price num" :class="trend(q)">{{ formatPrice(q.price, q) }}</span>
                    <span class="p-change num" :class="trend(q)">
                      {{ formatChangePercent(q.changePercent) }}
                    </span>
                    <span v-if="pnlOf(q.symbol)" class="p-pnl num" :class="trendClass(pnlOf(q.symbol)!.percent)">
                      {{ pnlText(q.symbol) }}
                    </span>
                  </div>
                </template>
                <span v-else-if="line.index" class="empty-hint">
                  自选列表为空 · 打开设置添加
                </span>
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- 信息堆叠 -->
      <template v-else-if="layout === 'stacked'">
        <div class="banner-line">
          <div v-if="showIndexesHere && bannerSettings.showMarketIndexes && indexRows.length" class="index-strip">
            <span v-for="row in indexRows" :key="row.symbol" class="idx" :class="row.q ? trend(row.q) : 'flat'">
              {{ row.name }}
              <span class="num">{{ row.q ? formatChangePercent(row.q.changePercent) : '--' }}</span>
            </span>
            <span class="divider"></span>
          </div>
          <div class="line-scroll" :class="{ scroll: stackedLine.scroll }">
            <div class="line-track stacked">
              <div
                v-for="copy in stackedLine.scroll ? 2 : 1"
                :key="`c${copy}`"
                class="copy"
                :class="{ dup: copy > 1 }"
              >
                <div
                  v-for="q in stackedLine.items"
                  :key="`${copy}-${q.symbol}`"
                  class="cell"
                  :class="trend(q)"
                >
                  <div class="cell-top">
                    <span class="c-name" :title="`${q.name} ${q.symbol}`">{{ q.name }}</span>
                    <span class="c-price num">{{ formatPrice(q.price, q) }}</span>
                  </div>
                  <div class="cell-bot">
                    <span class="c-chg num">
                      {{ changeAmount(q) }}
                      {{ formatChangePercent(q.changePercent) }}
                    </span>
                    <span class="c-tag">{{ marketTag(q) }}</span>
                  </div>
                  <div v-if="pnlOf(q.symbol)" class="cell-pnl num" :class="trendClass(pnlOf(q.symbol)!.percent)">
                    {{ pnlText(q.symbol) }}
                  </div>
                </div>
                <span v-if="stackedLine.empty" class="empty-hint">自选列表为空 · 打开设置添加</span>
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- 双行分工 -->
      <template v-else>
        <div class="banner-line">
          <div v-if="showIndexesHere && bannerSettings.showMarketIndexes && indexRows.length" class="index-strip">
            <span v-for="row in indexRows" :key="row.symbol" class="idx" :class="row.q ? trend(row.q) : 'flat'">
              {{ row.name }}
              <span class="num">{{ row.q ? formatChangePercent(row.q.changePercent) : '--' }}</span>
            </span>
            <span class="divider"></span>
          </div>
          <div class="line-scroll" :class="{ scroll: rowLines[0]?.scroll }">
            <div class="line-track">
              <div
                v-for="copy in rowLines[0]?.scroll ? 2 : 1"
                :key="`c${copy}`"
                class="copy"
                :class="{ dup: copy > 1 }"
              >
                <div
                  v-for="q in stockQuotes"
                  :key="`${copy}-${q.symbol}`"
                  class="pill-wrap"
                  :class="trend(q)"
                >
                  <span class="p-name">{{ q.name }}</span>
                  <span class="p-price num">{{ formatPrice(q.price, q) }}</span>
                  <span class="p-change num">{{ formatChangePercent(q.changePercent) }}</span>
                  <span v-if="pnlOf(q.symbol)" class="p-pnl num" :class="trendClass(pnlOf(q.symbol)!.percent)">
                    {{ pnlText(q.symbol) }}
                  </span>
                </div>
                <span v-if="stockQuotes.length === 0" class="empty-hint">自选列表为空</span>
              </div>
            </div>
          </div>
        </div>

        <div class="banner-line meta-line">
          <span class="meta-icon">⚡</span>
          <div class="line-scroll" :class="{ scroll: dualMeta.scroll }">
            <div class="line-track meta">
              <div v-for="copy in dualMeta.scroll ? 2 : 1" :key="`c${copy}`" class="copy" :class="{ dup: copy > 1 }">
                <span
                  v-for="(text, ti) in dualMeta.items"
                  :key="`${copy}-${ti}`"
                  class="meta-item"
                >
                  {{ text }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.banner {
  width: 100vw;
  position: relative;
  display: flex;
  align-items: stretch;
  font-family: var(--ff);
  font-weight: var(--bw);
  background: var(--glass);
  backdrop-filter: blur(20px) saturate(1.4);
  -webkit-backdrop-filter: blur(20px) saturate(1.4);
  border-top: 1px solid var(--stroke);
  box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.35);
  opacity: 1;
  transform: translateY(0);
  transition: opacity 0.4s ease, transform 0.4s ease;
  padding-left: 30px;
  cursor: default;
  user-select: none;
}

.banner.hidden {
  opacity: 0;
  transform: translateY(18px);
  pointer-events: none;
}

.banner.dragging {
  outline: 1px dashed rgba(217, 171, 85, 0.75);
  outline-offset: -1px;
}

.grip {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 28px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  cursor: grab;
  opacity: 0.28;
  transition: opacity 0.15s ease;
  background: rgba(127, 127, 127, 0.04);
}

.grip:hover {
  opacity: 1;
  background: rgba(217, 171, 85, 0.08);
}

.grip.active {
  opacity: 1;
  cursor: grabbing;
  background: rgba(217, 171, 85, 0.12);
}

.grip i {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: currentColor;
}

.drag-hint {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  padding: 6px 14px;
  border-radius: 999px;
  background: rgba(13, 15, 19, 0.9);
  color: var(--gold-bright);
  font-size: calc(var(--bf) * 0.9);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
  z-index: 20;
  pointer-events: none;
  white-space: nowrap;
}

.stage {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.banner-line {
  display: flex;
  align-items: center;
  min-width: 0;
  padding: calc(var(--bf) * 0.12) 0;
  gap: 8px;
}

.banner-line.meta-line {
  border-top: 1px dashed var(--stroke);
  padding: calc(var(--bf) * 0.08) 8px;
}

.meta-icon {
  font-size: calc(var(--bf) * 0.85);
  color: var(--text-3);
  flex-shrink: 0;
}

.index-strip {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  padding-left: 2px;
}

.idx {
  font-size: calc(var(--bf) * 0.88);
  color: var(--text-2);
  white-space: nowrap;
}

.idx .num {
  font-size: calc(var(--bf) * 0.88);
  font-weight: 700;
  margin-left: 3px;
}

.idx.up .num { color: var(--up); }
.idx.down .num { color: var(--down); }
.idx.flat .num { color: var(--flat); }

.divider {
  width: 1px;
  height: calc(var(--bf) * 1.6);
  background: var(--stroke-strong);
  flex-shrink: 0;
}

.line-scroll {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.line-scroll.scroll .line-track {
  animation: marquee var(--mt) linear infinite;
}

.line-scroll.scroll:hover .line-track {
  animation-play-state: paused;
}

.line-track {
  display: inline-flex;
  align-items: center;
  width: max-content;
}

.copy {
  display: inline-flex;
  align-items: center;
  min-width: 0;
}

.copy > .pill-wrap,
.copy > .cell,
.copy > .meta-item {
  margin-right: calc(var(--bf) * 0.18);
}

.copy + .copy {
  margin-left: calc(var(--bf) * 0.18);
}

.line-scroll:not(.scroll) .copy.dup {
  display: none;
}

.pill-wrap {
  display: inline-flex;
  align-items: baseline;
  gap: calc(var(--bf) * 0.5);
  padding: calc(var(--bf) * 0.32) calc(var(--bf) * 0.85);
  border-radius: 999px;
  white-space: nowrap;
  transition: background 0.15s ease, opacity 0.15s ease;
  background: transparent;
}

.pill-wrap:hover {
  background: rgba(255, 255, 255, 0.06);
}

.pill-wrap.dragging {
  opacity: 0.35;
  cursor: grabbing;
}

.pill-wrap.drag-over-before {
  box-shadow: -2px 0 0 var(--gold);
}

.pill-wrap.drag-over-after {
  box-shadow: 2px 0 0 var(--gold);
}

.p-name {
  font-size: calc(var(--bf) * 0.95);
  color: var(--text-2);
  max-width: 8.5em;
  overflow: hidden;
  text-overflow: ellipsis;
}

.p-price {
  font-size: calc(var(--bf) * 1.02);
  font-weight: 600;
}

.p-change {
  font-size: calc(var(--bf) * 0.9);
  font-weight: 500;
}

.p-pnl {
  font-size: calc(var(--bf) * 0.8);
  font-weight: 600;
}

.p-pnl.up { color: var(--up); }
.p-pnl.down { color: var(--down); }
.p-pnl.flat { color: var(--flat); }

.p-price.up, .p-change.up { color: var(--up); }
.p-price.down, .p-change.down { color: var(--down); }
.p-price.flat, .p-change.flat { color: var(--flat); }

.line-track.stacked {
  align-items: stretch;
  gap: calc(var(--bf) * 0.6);
}

.cell {
  display: inline-flex;
  flex-direction: column;
  gap: calc(var(--bf) * 0.12);
  padding: calc(var(--bf) * 0.28) calc(var(--bf) * 0.8);
  border-radius: calc(var(--bf) * 0.55);
  border: 1px solid var(--stroke);
  background: rgba(255, 255, 255, 0.035);
  white-space: nowrap;
}

.cell-top {
  display: flex;
  align-items: baseline;
  gap: calc(var(--bf) * 0.6);
}

.c-name {
  font-size: calc(var(--bf) * 0.95);
  color: var(--text-1);
  max-width: 9em;
  overflow: hidden;
  text-overflow: ellipsis;
}

.c-price {
  font-size: calc(var(--bf) * 1.02);
  font-weight: 700;
}

.cell-bot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: calc(var(--bf) * 0.8);
}

.c-chg {
  font-size: calc(var(--bf) * 0.86);
  font-weight: 600;
}

.c-tag {
  font-size: calc(var(--bf) * 0.78);
  color: var(--text-3);
}

.cell.up .c-price, .cell.up .c-chg { color: var(--up); }
.cell.down .c-price, .cell.down .c-chg { color: var(--down); }
.cell.flat .c-price, .cell.flat .c-chg { color: var(--flat); }

.cell-pnl {
  font-size: calc(var(--bf) * 0.78);
  font-weight: 600;
  align-self: flex-start;
}

.cell-pnl.up { color: var(--up); }
.cell-pnl.down { color: var(--down); }
.cell-pnl.flat { color: var(--flat); }

.meta-item {
  font-size: calc(var(--bf) * 0.85);
  color: var(--text-3);
  white-space: nowrap;
  padding-right: calc(var(--bf) * 1);
}

.empty-hint {
  font-size: calc(var(--bf) * 0.95);
  color: var(--text-3);
  padding: calc(var(--bf) * 0.3) calc(var(--bf) * 0.6);
}
</style>
