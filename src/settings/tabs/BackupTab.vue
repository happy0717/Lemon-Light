<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { bridge } from '../../shared/bridge'
import type { BackupPreview } from '../../../electron/main/backup'
import type { UpdateInfo, UpdateProgress } from '../../../electron/main/updater'

const exportState = ref<'idle' | 'exporting'>('idle')
const exportResult = ref('')
const importPreview = ref<BackupPreview | null>(null)
const importResult = ref('')
const importing = ref(false)

const options = ref({
  watchlist: true,
  groups: true,
  alerts: true,
  holdings: true,
  settings: true
})

function toPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

async function doExport(): Promise<void> {
  exportState.value = 'exporting'
  exportResult.value = ''
  try {
    const path = await bridge.exportBackup()
    exportResult.value = path ? `已导出到：${path}` : '已取消导出'
  } catch (err) {
    exportResult.value = `导出失败：${(err as Error).message}`
  } finally {
    exportState.value = 'idle'
  }
}

async function pickFile(): Promise<void> {
  importResult.value = ''
  importPreview.value = null
  const preview = await bridge.pickBackupFile()
  if (preview.ok) {
    importPreview.value = preview
  } else if (preview.error !== 'canceled') {
    importResult.value = preview.error ?? '导入失败'
  }
}

async function doImport(): Promise<void> {
  if (!importPreview.value) return
  importing.value = true
  importResult.value = ''
  try {
    const result = await bridge.applyBackup(toPlain(importPreview.value), toPlain(options.value))
    importResult.value = result.ok ? `${result.message}，所有窗口已刷新` : (result.message || '导入失败')
    if (result.ok) importPreview.value = null
  } catch (err) {
    importResult.value = `导入失败：${(err as Error).message}`
  } finally {
    importing.value = false
  }
}

const sourceLabel: Record<string, string> = {
  'lemon-light': 'Lemon Light 桌面版'
}

const SLOGAN = '有酸有甜，照亮前路 —— 你 happy 我不 happy，有人快乐就有人哭泣。'

type UpdateState = 'idle' | 'checking' | 'latest' | 'available' | 'downloading' | 'done' | 'error'

const updateState = ref<UpdateState>('idle')
const updateInfo = ref<UpdateInfo | null>(null)
const currentVersion = ref('')
const updateMsg = ref('')
const progress = ref<UpdateProgress>({ received: 0, total: 0 })
let detachProgress: (() => void) | null = null

const updateBusy = computed(
  () => updateState.value === 'checking' || updateState.value === 'downloading'
)

const progressPercent = computed(() => {
  const { received, total } = progress.value
  if (!total) return 0
  return Math.min(100, Math.round((received / total) * 100))
})

const progressText = computed(() => {
  const { received, total } = progress.value
  const mb = (received / 1048576).toFixed(1)
  if (!total) return `🍋 正在榨汁… 已接收 ${mb} MB`
  return `🍋 正在榨汁… ${progressPercent.value}%（${mb} / ${(total / 1048576).toFixed(1)} MB）`
})

const updateButtonLabel = computed(() => {
  if (updateState.value === 'checking') return '检查中…'
  if (updateState.value === 'downloading') return '榨汁中…'
  if (updateState.value === 'available') {
    return updateInfo.value?.asset ? '一键更新' : '前往 Release 页面'
  }
  return '检查更新'
})

async function checkUpdate(): Promise<void> {
  updateState.value = 'checking'
  updateMsg.value = '🍋 正在扒拉 GitHub 的货架…'
  const result = await bridge.checkUpdate()
  currentVersion.value = result.currentVersion
  if (!result.ok) {
    updateState.value = 'error'
    updateMsg.value = `🍋 有点酸：${result.message}`
    return
  }
  updateInfo.value = result.info
  if (result.info.hasUpdate) {
    updateState.value = 'available'
    updateMsg.value = `🍋 新柠檬 v${result.info.latestVersion} 上架了！当前还是 v${result.currentVersion}，要不要一口闷？`
  } else {
    updateState.value = 'latest'
    updateMsg.value = `🍋 你已经喝上最新鲜的柠檬了（v${result.currentVersion}），暂时没有更酸的。${SLOGAN}`
  }
}

async function runUpdate(): Promise<void> {
  const info = updateInfo.value
  if (!info) return
  if (!info.asset) {
    await bridge.openReleasePage()
    updateMsg.value = '🍋 这版没带安装包，已在浏览器里打开 Release 页面，自取~'
    return
  }

  updateState.value = 'downloading'
  progress.value = { received: 0, total: info.asset.size }
  updateMsg.value = progressText.value

  const download = await bridge.downloadUpdate(info.asset.url, info.asset.name)
  if (!download.ok) {
    updateState.value = 'error'
    updateMsg.value = `🍋 没榨出来：${download.message}`
    return
  }

  const install = await bridge.installUpdate(download.path ?? '')
  if (!install.ok) {
    updateState.value = 'error'
    updateMsg.value = `🍋 有点酸：${install.message}`
    return
  }

  updateState.value = 'done'
  updateMsg.value = `🍋 ${install.message}。${SLOGAN}`
}

async function primaryUpdateAction(): Promise<void> {
  if (updateBusy.value) return
  if (updateState.value === 'available') await runUpdate()
  else await checkUpdate()
}

onMounted(() => {
  detachProgress = bridge.onUpdateProgress((payload) => {
    progress.value = payload
    if (updateState.value === 'downloading') updateMsg.value = progressText.value
  })
})

onBeforeUnmount(() => {
  detachProgress?.()
  detachProgress = null
})
</script>

<template>
  <section class="tab">
    <h2 class="tab-title">备份</h2>
    <p class="tab-desc">明文 JSON · 全部配置一键备份，换机迁移更放心</p>

    <div class="backup-card">
      <h3 class="bk-title">导出备份</h3>
      <p class="bk-desc">导出全部数据：自选股、分组、预警、持仓交易记录与外观设置。</p>
      <button class="btn primary" :disabled="exportState === 'exporting'" @click="doExport">
        {{ exportState === 'exporting' ? '导出中…' : '选择位置并导出' }}
      </button>
      <p v-if="exportResult" class="bk-result">{{ exportResult }}</p>
    </div>

    <div class="backup-card">
      <h3 class="bk-title">导入备份</h3>
      <p class="bk-desc">支持导入 Lemon Light 导出的备份文件，仅限本应用自有格式。</p>
      <button class="btn" @click="pickFile">选择备份文件</button>

      <div v-if="importPreview" class="preview glass-panel">
        <div class="pv-head">
          <span class="pv-badge">{{ sourceLabel[importPreview.source ?? ''] ?? importPreview.source }}</span>
          <span class="pv-version num" v-if="importPreview.version">v{{ importPreview.version }}</span>
          <span class="pv-date" v-if="importPreview.exportedAt">
            {{ new Date(importPreview.exportedAt).toLocaleString('zh-CN') }}
          </span>
        </div>

        <div class="pv-summary num" v-if="importPreview.summary">
          自选 {{ importPreview.summary.watchlist }} 只 · 分组 {{ importPreview.summary.groups }} 个 ·
          预警 {{ importPreview.summary.alerts }} 条 · 交易 {{ importPreview.summary.trades }} 笔
        </div>

        <div class="pv-options">
          <label class="opt"><input v-model="options.watchlist" type="checkbox" /> 自选股</label>
          <label class="opt"><input v-model="options.groups" type="checkbox" /> 分组</label>
          <label class="opt"><input v-model="options.alerts" type="checkbox" /> 预警</label>
          <label class="opt"><input v-model="options.holdings" type="checkbox" /> 持仓</label>
          <label class="opt"><input v-model="options.settings" type="checkbox" /> 设置</label>
        </div>

        <button class="btn primary" :disabled="importing" @click="doImport">
          {{ importing ? '导入中…' : '确认导入（覆盖所选数据）' }}
        </button>
      </div>

      <p v-if="importResult" class="bk-result">{{ importResult }}</p>
    </div>

    <div class="backup-card">
      <h3 class="bk-title">检查更新</h3>
      <p class="bk-desc">
        去 GitHub Releases 看看有没有新柠檬，发现新版本可以一键下载并启动安装包。
      </p>
      <p class="slogan">🍋 {{ SLOGAN }}</p>

      <div class="up-row">
        <button class="btn primary" :disabled="updateBusy" @click="primaryUpdateAction">
          {{ updateButtonLabel }}
        </button>
        <button class="link-btn" type="button" @click="bridge.openReleasePage()">
          在浏览器打开 Releases
        </button>
        <span v-if="currentVersion" class="up-current num">当前 v{{ currentVersion }}</span>
      </div>

      <p v-if="updateMsg" class="bk-result">{{ updateMsg }}</p>

      <div v-if="updateState === 'downloading'" class="up-bar">
        <div class="up-bar-fill" :style="{ width: `${progressPercent}%` }"></div>
      </div>

      <div v-if="updateInfo?.hasUpdate && updateInfo.notes" class="up-notes">
        <div class="up-notes-head">
          <span>{{ updateInfo.releaseName }}</span>
          <span v-if="updateInfo.publishedAt" class="up-notes-date num">
            {{ new Date(updateInfo.publishedAt).toLocaleDateString('zh-CN') }}
          </span>
        </div>
        <pre class="up-notes-body">{{ updateInfo.notes }}</pre>
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

.backup-card {
  border: 1px solid var(--stroke);
  border-radius: var(--radius-m);
  background: var(--bg-1);
  padding: 20px;
  margin-bottom: 16px;
}

.bk-title {
  font-size: 15px;
  font-weight: 700;
  margin-bottom: 6px;
}

.bk-desc {
  font-size: 12px;
  color: var(--text-3);
  margin-bottom: 14px;
  line-height: 1.7;
}

.btn {
  padding: 9px 22px;
  border-radius: var(--radius-s);
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
  opacity: 0.55;
  cursor: default;
}

.bk-result {
  margin-top: 12px;
  font-size: 12px;
  color: var(--gold-bright);
  word-break: break-all;
}

.preview {
  margin-top: 14px;
  border-radius: var(--radius-m);
  padding: 16px;
}

.pv-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.pv-badge {
  padding: 2px 10px;
  border-radius: 999px;
  background: rgba(217, 171, 85, 0.14);
  color: var(--gold-bright);
  font-size: 11px;
  font-weight: 600;
}

.pv-version {
  font-size: 11px;
  color: var(--text-3);
}

.pv-date {
  font-size: 11px;
  color: var(--text-3);
  margin-left: auto;
}

.pv-summary {
  font-size: 12px;
  color: var(--text-2);
  margin-bottom: 12px;
}

.pv-options {
  display: flex;
  gap: 16px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}

.opt {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-2);
  cursor: pointer;
}

.opt input {
  accent-color: var(--gold);
}

.slogan {
  font-size: 12px;
  color: var(--gold-bright);
  line-height: 1.7;
  margin-bottom: 14px;
}

.up-row {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.link-btn {
  border: none;
  background: none;
  padding: 0;
  color: var(--text-3);
  font-size: 12px;
  font-family: var(--sans);
  cursor: pointer;
  text-decoration: underline;
  text-decoration-color: var(--stroke-strong);
  text-underline-offset: 3px;
}

.link-btn:hover {
  color: var(--gold-bright);
}

.up-current {
  font-size: 11px;
  color: var(--text-3);
  margin-left: auto;
}

.up-bar {
  margin-top: 12px;
  height: 6px;
  border-radius: 999px;
  background: var(--bg-2);
  overflow: hidden;
}

.up-bar-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(135deg, var(--gold), var(--gold-deep));
  transition: width 0.2s ease;
}

.up-notes {
  margin-top: 14px;
  border: 1px solid var(--stroke);
  border-radius: var(--radius-s);
  overflow: hidden;
}

.up-notes-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: var(--bg-2);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
}

.up-notes-date {
  margin-left: auto;
  font-size: 11px;
  font-weight: 400;
  color: var(--text-3);
}

.up-notes-body {
  margin: 0;
  padding: 12px;
  max-height: 220px;
  overflow: auto;
  font-family: var(--sans);
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-2);
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
