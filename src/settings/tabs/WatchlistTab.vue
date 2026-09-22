<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import { useDbStore } from '../../shared/stores/db'
import { useQuoteStore } from '../../shared/stores/quotes'
import { bridge } from '../../shared/bridge'
import { formatChangePercent, formatPrice, trendClass } from '../../shared/format'
import type { SearchResultItem } from '@shared/types'
import { normalizeSymbol } from '@shared/symbol'

const db = useDbStore()
const quotes = useQuoteStore()

const keyword = ref('')
const searching = ref(false)
const searchResults = ref<SearchResultItem[]>([])

async function doSearch(): Promise<void> {
  const kw = keyword.value.trim()
  if (!kw) {
    searchResults.value = []
    return
  }
  const direct = normalizeSymbol(kw)
  if (direct && !db.db.watchlist.includes(direct)) {
    const snapshot = await quotes.refresh(true)
    void snapshot
  }
  searching.value = true
  try {
    searchResults.value = await bridge.searchStock(kw)
  } finally {
    searching.value = false
  }
}

async function addSymbol(symbol: string): Promise<void> {
  if (!db.db.watchlist.includes(symbol)) {
    await db.setWatchlist([...db.db.watchlist, symbol])
  }
  keyword.value = ''
  searchResults.value = []
  await quotes.refresh(true)
}

let searchTimer: number | null = null

watch(keyword, () => {
  if (searchTimer !== null) clearTimeout(searchTimer)
  if (!keyword.value.trim()) {
    searchResults.value = []
    return
  }
  searchTimer = window.setTimeout(() => void doSearch(), 260)
})

onBeforeUnmount(() => {
  if (searchTimer !== null) clearTimeout(searchTimer)
})

async function removeSymbol(symbol: string): Promise<void> {
  await db.setWatchlist(db.db.watchlist.filter((s) => s !== symbol))
}

const rows = computed(() =>
  db.db.watchlist.map((s) => ({ symbol: s, quote: quotes.state.quotes[s] }))
)

const dragIndex = ref<number | null>(null)
const dragOverIndex = ref<number | null>(null)

async function commitMove(from: number, to: number): Promise<void> {
  const list = [...db.db.watchlist]
  const [moved] = list.splice(from, 1)
  list.splice(to, 0, moved!)
  await db.setWatchlist(list)
}

function onRowDown(e: PointerEvent, index: number): void {
  if (e.button !== 0) return
  let started = false
  const startX = e.clientX
  const startY = e.clientY
  const move = (ev: PointerEvent) => {
    if (!started && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 5) {
      started = true
      dragIndex.value = index
    }
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    if (started && dragOverIndex.value !== null && dragOverIndex.value !== dragIndex.value) {
      void commitMove(dragIndex.value, dragOverIndex.value)
    }
    dragIndex.value = null
    dragOverIndex.value = null
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

const newGroupName = ref('')
const groupColors = ['#d9ab55', '#e5484d', '#26a878', '#5b8bd9', '#a06bd9', '#d97bb0']

async function addGroup(): Promise<void> {
  const name = newGroupName.value.trim()
  if (!name) return
  const group = {
    id: `group-${Date.now()}`,
    name,
    color: groupColors[db.db.groups.length % groupColors.length]!,
    symbols: []
  }
  await db.setGroups([...db.db.groups, group])
  newGroupName.value = ''
}

async function removeGroup(groupId: string): Promise<void> {
  await db.setGroups(db.db.groups.filter((g) => g.id !== groupId))
  if (hiddenGroupIds.value.includes(groupId)) {
    await patchBanner({
      hiddenGroupIds: hiddenGroupIds.value.filter((id) => id !== groupId)
    })
  }
}

async function toggleGroupSymbol(groupId: string, symbol: string): Promise<void> {
  const groups = db.db.groups.map((g) => {
    if (g.id !== groupId) return g
    const symbols = g.symbols.includes(symbol)
      ? g.symbols.filter((s) => s !== symbol)
      : [...g.symbols, symbol]
    return { ...g, symbols }
  })
  await db.setGroups(groups)
}

const hiddenGroupIds = computed(() => db.db.settings.bottomBanner.hiddenGroupIds ?? [])

async function patchBanner(
  partial: Partial<typeof db.db.settings.bottomBanner>
): Promise<void> {
  await db.patchSettings({
    bottomBanner: { ...db.db.settings.bottomBanner, ...partial }
  })
}

async function toggleGroupFilter(groupId: string): Promise<void> {
  const current = hiddenGroupIds.value
  const next = current.includes(groupId)
    ? current.filter((id) => id !== groupId)
    : [...current, groupId]
  await patchBanner({ hiddenGroupIds: next })
}

async function applyGroupOrder(): Promise<void> {
  const list = db.db.watchlist
  const placed = new Set<string>()
  const ordered: string[] = []
  for (const g of db.db.groups) {
    for (const s of list) {
      if (g.symbols.includes(s) && !placed.has(s)) {
        placed.add(s)
        ordered.push(s)
      }
    }
  }
  for (const s of list) {
    if (!placed.has(s)) ordered.push(s)
  }
  if (ordered.length === list.length && ordered.every((s, i) => s === list[i])) return
  await db.setWatchlist(ordered)
}
</script>

<template>
  <section class="tab">
    <h2 class="tab-title">自选与分组</h2>
    <p class="tab-desc">数量无限制 · 拖动行可调整顺序（悬浮球与横幅同步生效）</p>

    <div class="search-box">
      <input
        v-model="keyword"
        class="search-input"
        placeholder="输入代码 / 名称 / 拼音，实时联想推荐"
        @keyup.enter="doSearch"
      />
      <button class="btn primary" :disabled="searching" @click="doSearch">搜索</button>
    </div>

    <div v-if="searchResults.length" class="search-results glass-panel">
      <button
        v-for="item in searchResults"
        :key="item.symbol"
        class="result-row"
        @click="addSymbol(item.symbol)"
      >
        <span class="result-market">{{ item.market }}</span>
        <span class="result-name">{{ item.name }}</span>
        <span class="result-code num">{{ item.code }}</span>
        <span class="result-add">+ 添加</span>
      </button>
    </div>

    <div class="list-head">
      <span>共 {{ rows.length }} 只</span>
    </div>

    <div class="stock-list">
      <div v-if="rows.length === 0" class="empty">
        列表为空，通过上方搜索添加自选股
      </div>
      <div
        v-for="(row, i) in rows"
        :key="row.symbol"
        class="stock-row"
        :class="{
          dragging: dragIndex === i,
          'over-before': dragOverIndex === i && dragIndex !== null && dragIndex < i,
          'over-after':
            dragOverIndex === i && dragIndex !== null && dragIndex > i && i === rows.length - 1
        }"
        @pointerdown="onRowDown($event, i)"
        @pointerenter="dragIndex !== null && (dragOverIndex = i)"
      >
        <span class="grip">⣿</span>
        <span class="s-name">{{ row.quote?.name ?? row.symbol }}</span>
        <span class="s-code num">{{ row.symbol }}</span>
        <span class="s-price num" :class="row.quote ? trendClass(row.quote.changePercent) : ''">
          {{ row.quote ? formatPrice(row.quote.price, row.quote) : '--' }}
        </span>
        <span class="s-change num" :class="row.quote ? trendClass(row.quote.changePercent) : ''">
          {{ row.quote ? formatChangePercent(row.quote.changePercent) : '--' }}
        </span>
        <div class="group-chips">
          <button
            v-for="g in db.db.groups"
            :key="g.id"
            class="chip"
            :class="{ on: g.symbols.includes(row.symbol) }"
            :style="g.symbols.includes(row.symbol) ? { borderColor: g.color, color: g.color } : {}"
            :title="g.name"
            @pointerdown.stop
            @click="toggleGroupSymbol(g.id, row.symbol)"
          >
            {{ g.name.slice(0, 2) }}
          </button>
        </div>
        <button class="del" @pointerdown.stop @click="removeSymbol(row.symbol)">移除</button>
      </div>
    </div>

    <div class="section-head">
      <h3 class="section-title">分组管理</h3>
      <button
        class="btn ghost"
        :disabled="db.db.groups.length === 0"
        title="把已分组的股票按分组顺序整理到自选列表最前，同组股票相邻显示；会覆盖你手动调整的顺序，请谨慎点击。"
        @click="applyGroupOrder"
      >
        ↻ 整理展示顺序
      </button>
    </div>
    <p class="group-hint">
      开关默认全部开启：关闭某个分组只是把该分组内的股票从横幅隐藏，未分组的股票始终显示，新建分组也默认开启。「整理展示顺序」只调整自选列表的排列，不改变分组内容。
    </p>
    <div class="group-add">
      <input
        v-model="newGroupName"
        class="search-input slim"
        placeholder="新分组名称"
        @keyup.enter="addGroup"
      />
      <button class="btn" @click="addGroup">添加分组</button>
    </div>
    <div class="group-list">
      <div v-if="db.db.groups.length === 0" class="empty slim">暂无分组</div>
      <div v-for="g in db.db.groups" :key="g.id" class="group-row">
        <button
          class="group-switch"
          :class="{ on: !hiddenGroupIds.includes(g.id) }"
          role="switch"
          :aria-checked="!hiddenGroupIds.includes(g.id)"
          :title="`显示「${g.name}」分组：关闭后该分组内的股票会从横幅隐藏（未分组的股票不受影响）`"
          @click="toggleGroupFilter(g.id)"
        >
          <span class="knob"></span>
        </button>
        <span class="group-color" :style="{ background: g.color }"></span>
        <span class="group-name">{{ g.name }}</span>
        <span class="group-count num">{{ g.symbols.length }} 只</span>
        <button class="del" @click="removeGroup(g.id)">删除分组</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.tab-title {
  font-size: 20px;
  font-weight: 800;
  letter-spacing: 0.02em;
}

.tab-desc {
  font-size: 12px;
  color: var(--text-3);
  margin: 6px 0 18px;
}

.search-box {
  display: flex;
  gap: 8px;
}

.search-input {
  flex: 1;
  padding: 10px 14px;
  border-radius: var(--radius-m);
  border: 1px solid var(--stroke-strong);
  background: var(--bg-2);
  color: var(--text-1);
  font-size: 13px;
  font-family: var(--sans);
  outline: none;
  transition: border-color 0.15s ease;
}

.search-input:focus {
  border-color: var(--gold);
}

.search-input.slim {
  max-width: 240px;
}

.btn {
  padding: 8px 18px;
  border-radius: var(--radius-m);
  border: 1px solid var(--stroke-strong);
  background: var(--bg-2);
  color: var(--text-1);
  font-size: 13px;
  cursor: pointer;
  font-family: var(--sans);
}

.btn.primary {
  background: linear-gradient(135deg, var(--gold), var(--gold-deep));
  border-color: transparent;
  color: #14100a;
  font-weight: 700;
}

.btn:disabled {
  opacity: 0.5;
}

.search-results {
  margin-top: 8px;
  border-radius: var(--radius-m);
  overflow: hidden;
}

.result-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 9px 14px;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--stroke);
  color: var(--text-1);
  font-size: 13px;
  cursor: pointer;
  font-family: var(--sans);
}

.result-row:last-child {
  border-bottom: none;
}

.result-row:hover {
  background: rgba(217, 171, 85, 0.08);
}

.result-market {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: var(--bg-3);
  color: var(--gold);
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.result-code {
  color: var(--text-3);
  font-size: 12px;
}

.result-add {
  margin-left: auto;
  color: var(--gold);
  font-size: 12px;
  font-weight: 600;
}

.list-head {
  display: flex;
  justify-content: space-between;
  margin: 18px 0 8px;
  font-size: 12px;
  color: var(--text-3);
}

.stock-list {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--stroke);
  border-radius: var(--radius-m);
  background: var(--bg-1);
  overflow: hidden;
}

.stock-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 14px;
  border-bottom: 1px solid var(--stroke);
  cursor: grab;
  transition: background 0.12s ease;
}

.stock-row:last-child {
  border-bottom: none;
}

.stock-row:hover {
  background: rgba(255, 255, 255, 0.03);
}

.stock-row.dragging {
  opacity: 0.4;
}

.stock-row.over-before {
  box-shadow: inset 2px 0 0 var(--gold);
}

.stock-row.over-after {
  box-shadow: inset -2px 0 0 var(--gold);
}

.grip {
  color: var(--text-3);
  font-size: 12px;
  cursor: grab;
}

.s-name {
  width: 110px;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.s-code {
  width: 80px;
  font-size: 11px;
  color: var(--text-3);
}

.s-price {
  width: 70px;
  font-size: 13px;
  font-weight: 600;
}

.s-change {
  width: 70px;
  font-size: 12px;
  font-weight: 600;
}

.group-chips {
  flex: 1;
  display: flex;
  gap: 5px;
  justify-content: flex-end;
  flex-wrap: wrap;
}

.chip {
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--stroke-strong);
  background: transparent;
  color: var(--text-3);
  font-size: 10px;
  cursor: pointer;
  font-family: var(--sans);
}

.chip.on {
  background: rgba(255, 255, 255, 0.05);
}

.del {
  padding: 3px 10px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--text-3);
  font-size: 11px;
  cursor: pointer;
  font-family: var(--sans);
}

.del:hover {
  color: var(--up);
  background: var(--up-soft);
}

.empty {
  padding: 32px;
  text-align: center;
  color: var(--text-3);
  font-size: 12px;
}

.empty.slim {
  padding: 16px;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 24px 0 8px;
}

.section-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
}

.group-hint {
  margin: 0 0 12px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-3);
}

.btn.ghost {
  background: transparent;
  color: var(--text-2);
}

.btn.ghost:not(:disabled):hover {
  border-color: var(--gold);
  color: var(--gold);
}

.group-switch {
  position: relative;
  width: 34px;
  height: 18px;
  flex-shrink: 0;
  padding: 0;
  border-radius: 999px;
  border: 1px solid var(--stroke-strong);
  background: var(--bg-3);
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.group-switch .knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--text-3);
  transition: transform 0.15s ease, background 0.15s ease;
}

.group-switch.on {
  background: rgba(217, 171, 85, 0.22);
  border-color: var(--gold);
}

.group-switch.on .knob {
  transform: translateX(16px);
  background: var(--gold);
}

.group-add {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.group-list {
  border: 1px solid var(--stroke);
  border-radius: var(--radius-m);
  background: var(--bg-1);
}

.group-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 14px;
  border-bottom: 1px solid var(--stroke);
}

.group-row:last-child {
  border-bottom: none;
}

.group-color {
  width: 10px;
  height: 10px;
  border-radius: 3px;
}

.group-name {
  flex: 1;
  font-size: 13px;
}

.group-count {
  font-size: 12px;
  color: var(--text-3);
}
</style>
