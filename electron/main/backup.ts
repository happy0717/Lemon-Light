import { dialog } from 'electron'
import { promises as fs } from 'node:fs'
import type { Database, Group, Holdings, StockAlert } from '@shared/types'
import type { StorageService } from '@shared/storage'

export interface BackupPreview {
  ok: boolean
  error?: string
  source?: 'lemon-light'
  version?: string
  exportedAt?: string
  summary?: {
    watchlist: number
    groups: number
    alerts: number
    trades: number
    hasSettings: boolean
  }
  data?: BackupData
}

export interface BackupData {
  watchlist?: string[]
  groups?: Group[]
  alerts?: StockAlert[]
  holdings?: Holdings
  settings?: Partial<Database['settings']>
}

const BACKUP_APP = 'lemon-light'

export async function exportBackup(db: Database): Promise<string | null> {
  const stamp = new Date().toISOString().slice(0, 19).replaceAll(':', '-')
  const result = await dialog.showSaveDialog({
    title: '导出 Lemon Light 备份',
    defaultPath: `lemon-light-backup-${stamp}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })
  if (result.canceled || !result.filePath) return null
  const payload = {
    app: BACKUP_APP,
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    data: {
      watchlist: db.watchlist,
      groups: db.groups,
      alerts: db.alerts,
      holdings: db.holdings,
      settings: db.settings
    }
  }
  await fs.writeFile(result.filePath, JSON.stringify(payload, null, 2), 'utf-8')
  return result.filePath
}

export async function parseBackupFile(): Promise<BackupPreview> {
  const result = await dialog.showOpenDialog({
    title: '导入备份文件',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile']
  })
  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false, error: 'canceled' }
  }
  let raw: string
  try {
    raw = await fs.readFile(result.filePaths[0]!, 'utf-8')
  } catch (err) {
    return { ok: false, error: `无法读取文件: ${(err as Error).message}` }
  }
  return parseBackup(raw)
}

export function parseBackup(raw: string): BackupPreview {
  let json: Record<string, unknown>
  try {
    json = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return { ok: false, error: '无效的 JSON 文件' }
  }

  if (json.app !== BACKUP_APP) {
    return { ok: false, error: '无法识别的备份格式，请选择 Lemon Light 导出的备份文件' }
  }

  const data = (json.data ?? {}) as BackupData
  const holdings = data.holdings
  return {
    ok: true,
    source: BACKUP_APP,
    version: json.version as string,
    exportedAt: json.exportedAt as string,
    summary: {
      watchlist: data.watchlist?.length ?? 0,
      groups: data.groups?.length ?? 0,
      alerts: data.alerts?.length ?? 0,
      trades: holdings?.trades?.length ?? 0,
      hasSettings: Boolean(data.settings)
    },
    data
  }
}

export interface ApplyResult {
  ok: boolean
  message: string
}

export function applyBackup(
  backup: unknown,
  storage: StorageService,
  options: {
    watchlist?: boolean
    groups?: boolean
    alerts?: boolean
    holdings?: boolean
    settings?: boolean
  } = {}
): ApplyResult {
  const preview = backup as BackupPreview
  if (!preview?.ok || !preview.data) {
    return { ok: false, message: '无效的备份数据' }
  }

  const active = { watchlist: true, groups: true, alerts: true, holdings: true, settings: true }
  if (Object.keys(options).length > 0) {
    ;(Object.keys(active) as Array<keyof typeof active>).forEach((key) => {
      if (typeof options[key] === 'boolean') active[key] = options[key]
    })
  }

  const data = preview.data
  const db = storage.get()

  if (active.watchlist && data.watchlist) {
    db.watchlist = data.watchlist.filter((s) => typeof s === 'string')
  }
  if (active.groups && data.groups) {
    db.groups = data.groups
      .filter((g) => g && typeof g === 'object' && Array.isArray(g.symbols))
      .map((g) => ({
        id: String(g.id ?? `group-${Math.random().toString(36).slice(2)}`),
        name: String(g.name ?? '未命名分组'),
        color: typeof g.color === 'string' ? g.color : '#d9ab55',
        symbols: g.symbols.map(String).filter(Boolean)
      }))
  }
  if (active.alerts && data.alerts) {
    db.alerts = data.alerts
  }
  if (active.holdings && data.holdings) {
    db.holdings = {
      version: 2,
      trades: (data.holdings.trades ?? []).filter((t) => t.symbol && t.price > 0 && t.shares > 0),
      archives: data.holdings.archives ?? []
    }
  }
  if (active.settings && data.settings) {
    db.settings = { ...db.settings, ...data.settings } as Database['settings']
  }

  storage.replaceAll(db)
  return { ok: true, message: '导入完成' }
}
