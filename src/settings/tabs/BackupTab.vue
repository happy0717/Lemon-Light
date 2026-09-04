<script setup lang="ts">
import { ref } from 'vue'
import { bridge } from '../../shared/bridge'
import type { BackupPreview } from '../../../electron/main/backup'

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
</style>
