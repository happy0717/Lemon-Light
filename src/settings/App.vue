<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useDbStore } from '../shared/stores/db'
import { useQuoteStore } from '../shared/stores/quotes'
import { bridge } from '../shared/bridge'
import { readableOnBackground } from '../shared/format'
import logoUrl from '../shared/assets/logo.png'
import WatchlistTab from './tabs/WatchlistTab.vue'
import AlertsTab from './tabs/AlertsTab.vue'
import HoldingsTab from './tabs/HoldingsTab.vue'
import AppearanceTab from './tabs/AppearanceTab.vue'
import BackupTab from './tabs/BackupTab.vue'

const db = useDbStore()
const quotes = useQuoteStore()
const activeTab = ref('watchlist')

const tabs = [
  { key: 'watchlist', label: '自选与分组', icon: '☰' },
  { key: 'alerts', label: '价格预警', icon: '⚡' },
  { key: 'holdings', label: '持仓盈亏', icon: '◆' },
  { key: 'appearance', label: '外观与行为', icon: '◐' },
  { key: 'backup', label: '备份', icon: '⇄' }
]

function shiftHex(hex: string, dr: number, dg: number, db_: number): string {
  let h = hex.replace('#', '').trim()
  if (!h) h = '0a0c10'
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('')
  }
  const n = parseInt(h.slice(0, 6), 16)
  if (Number.isNaN(n)) return hex
  const r = Math.min(255, Math.max(0, ((n >> 16) & 255) + dr))
  const g = Math.min(255, Math.max(0, ((n >> 8) & 255) + dg))
  const b = Math.min(255, Math.max(0, (n & 255) + db_))
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

const shellStyle = computed(() => {
  const bg = db.db.settings.settingsAppearance.backgroundColor || '#0a0c10'
  const light = readableOnBackground(bg) === '#0d0f13'
  return {
    '--bg-0': bg,
    '--bg-1': shiftHex(bg, light ? 10 : 6, light ? 10 : 7, light ? 12 : 9),
    '--bg-2': shiftHex(bg, light ? 18 : 12, light ? 18 : 14, light ? 22 : 18),
    '--bg-3': shiftHex(bg, light ? 26 : 18, light ? 26 : 21, light ? 32 : 27),
    '--stroke': light ? 'rgba(0, 0, 0, 0.09)' : 'rgba(255, 255, 255, 0.07)',
    '--stroke-strong': light ? 'rgba(0, 0, 0, 0.16)' : 'rgba(255, 255, 255, 0.14)',
    '--text-1': light ? '#1b1f26' : '#e9ecf1',
    '--text-2': light ? '#4d5560' : '#9aa2ad',
    '--text-3': light ? '#747c87' : '#5c646f',
    '--side-bg': light ? 'rgba(255, 255, 255, 0.6)' : 'rgba(13, 15, 19, 0.6)'
  } as Record<string, string>
})

onMounted(async () => {
  await db.init()
  await quotes.init()
})
</script>

<template>
  <div class="shell" :style="shellStyle">
    <nav class="side">
      <div class="brand">
        <img class="brand-logo" :src="logoUrl" alt="" draggable="false" />
        <div class="brand-text">
          <span class="brand-name">Lemon Light</span>
          <span class="brand-tag">有酸有甜 · 照亮前路</span>
        </div>
      </div>
      <div class="nav-list">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="nav-item"
          :class="{ active: activeTab === tab.key }"
          @click="activeTab = tab.key"
        >
          <span class="nav-icon">{{ tab.icon }}</span>
          {{ tab.label }}
        </button>
      </div>
      <div class="side-footer">
        <button class="quit-btn" @click="bridge.quitApp()">退出程序</button>
      </div>
    </nav>
    <main class="content">
      <WatchlistTab v-if="activeTab === 'watchlist'" />
      <AlertsTab v-else-if="activeTab === 'alerts'" />
      <HoldingsTab v-else-if="activeTab === 'holdings'" />
      <AppearanceTab v-else-if="activeTab === 'appearance'" />
      <BackupTab v-else-if="activeTab === 'backup'" />
    </main>
  </div>
</template>

<style scoped>
.shell {
  width: 100vw;
  height: 100vh;
  display: flex;
  background:
    radial-gradient(1200px 500px at 85% -10%, rgba(217, 171, 85, 0.06), transparent 60%),
    radial-gradient(800px 400px at -10% 110%, rgba(38, 168, 120, 0.04), transparent 60%),
    var(--bg-0);
}

.side {
  width: 200px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--stroke);
  background: var(--side-bg, rgba(13, 15, 19, 0.6));
  padding: 20px 12px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 6px 18px;
}

.brand-logo {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  object-fit: contain;
  user-select: none;
  flex-shrink: 0;
}

.brand-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.brand-name {
  font-size: 15px;
  font-weight: 900;
  letter-spacing: 0.05em;
  line-height: 1.15;
  background: linear-gradient(135deg, #fff7da 0%, #ffe28a 35%, #ffc73f 62%, #f2a93d 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  white-space: nowrap;
}

.brand-tag {
  margin-top: 2px;
  font-size: 9px;
  letter-spacing: 0.08em;
  color: var(--text-3);
  white-space: nowrap;
}

.nav-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-s);
  border: none;
  background: transparent;
  color: var(--text-2);
  font-size: 13px;
  font-family: var(--sans);
  cursor: pointer;
  text-align: left;
  transition: all 0.15s ease;
}

.nav-item:hover {
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-1);
}

.nav-item.active {
  background: linear-gradient(135deg, rgba(217, 171, 85, 0.16), rgba(217, 171, 85, 0.05));
  color: var(--gold-bright);
  box-shadow: inset 2px 0 0 var(--gold);
}

.nav-icon {
  font-size: 13px;
  opacity: 0.8;
}

.side-footer {
  padding-top: 12px;
}

.quit-btn {
  width: 100%;
  padding: 8px;
  border-radius: var(--radius-s);
  border: 1px solid var(--stroke);
  background: transparent;
  color: var(--text-3);
  font-size: 12px;
  cursor: pointer;
  font-family: var(--sans);
  transition: all 0.15s ease;
}

.quit-btn:hover {
  color: var(--up);
  border-color: rgba(229, 72, 77, 0.4);
}

.content {
  flex: 1;
  overflow-y: auto;
  padding: 28px 32px;
}
</style>
