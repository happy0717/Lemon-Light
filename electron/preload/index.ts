import { contextBridge, ipcRenderer } from 'electron'
import type { Database, Quote, QuotesPayload, SearchResultItem, DailyKline, AppSettings } from '@shared/types'
import type { BackupPreview } from '../main/backup'

const api = {
  getDb: (): Promise<Database> => ipcRenderer.invoke('db:get'),
  setDbKey: <K extends keyof Database>(key: K, value: Database[K]): Promise<Database> =>
    ipcRenderer.invoke('db:set', key, value),
  patchSettings: (partial: Partial<AppSettings>): Promise<Database> =>
    ipcRenderer.invoke('db:patch-settings', partial),

  fetchQuotes: (force = false): Promise<QuotesPayload> => ipcRenderer.invoke('quotes:fetch', force),
  getQuoteSnapshot: (): Promise<QuotesPayload> => ipcRenderer.invoke('quotes:snapshot'),
  testAlert: (): Promise<boolean> => ipcRenderer.invoke('alerts:test'),
  removeAlertLogs: (ids: string[]): Promise<Database> =>
    ipcRenderer.invoke('alerts:logs-delete', ids),
  clearAlertLogs: (): Promise<Database> => ipcRenderer.invoke('alerts:logs-clear'),
  onQuotesSync: (cb: (payload: QuotesPayload) => void): (() => void) => {
    const listener = (_e: unknown, payload: QuotesPayload) => cb(payload)
    ipcRenderer.on('quotes:sync', listener)
    return () => ipcRenderer.removeListener('quotes:sync', listener)
  },

  onDbChanged: (cb: (payload: { key: string; db: Database }) => void): (() => void) => {
    const listener = (_e: unknown, payload: { key: string; db: Database }) => cb(payload)
    ipcRenderer.on('db:changed', listener)
    return () => ipcRenderer.removeListener('db:changed', listener)
  },

  onBallCollapse: (cb: () => void): (() => void) => {
    const listener = () => cb()
    ipcRenderer.on('ball:collapse', listener)
    return () => ipcRenderer.removeListener('ball:collapse', listener)
  },

  searchStock: (keyword: string): Promise<SearchResultItem[]> =>
    ipcRenderer.invoke('search:stock', keyword),
  getDailyKline: (symbol: string): Promise<DailyKline[]> =>
    ipcRenderer.invoke('kline:daily', symbol),

  exportBackup: (): Promise<string | null> => ipcRenderer.invoke('backup:export'),
  pickBackupFile: (): Promise<BackupPreview> => ipcRenderer.invoke('backup:pick-file'),
  applyBackup: (
    backup: unknown,
    options: {
      watchlist?: boolean
      groups?: boolean
      alerts?: boolean
      holdings?: boolean
      settings?: boolean
    }
  ): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('backup:apply', backup, options),

  saveBallPosition: (pos: { x: number; y: number }): void =>
    ipcRenderer.send('ball:position', pos),
  setBallIgnoreMouse: (ignore: boolean): void =>
    ipcRenderer.send('ball:set-ignore-mouse', ignore),
  setBallExpanded: (expanded: boolean): void => ipcRenderer.send('ball:set-expanded', expanded),
  openSettings: (): void => ipcRenderer.send('app:open-settings'),
  quitApp: (): void => ipcRenderer.send('app:quit'),

  ballDragStart: (offsetX: number, offsetY: number): void =>
    ipcRenderer.send('ball:drag-start', offsetX, offsetY),
  ballDragMove: (clientX: number, clientY: number): void =>
    ipcRenderer.send('ball:drag-move', clientX, clientY),
  ballDragEnd: (): void => ipcRenderer.send('ball:drag-end'),

  reportBannerContentHeight: (did: string, height: number): void =>
    ipcRenderer.send('banner:content-height', did, height),
  bannerDragStart: (did: string, offsetX: number, offsetY: number): void =>
    ipcRenderer.send('banner:drag-start', did, offsetX, offsetY),
  bannerDragMove: (did: string, clientX: number, clientY: number): void =>
    ipcRenderer.send('banner:drag-move', did, clientX, clientY),
  bannerDragEnd: (did: string): void => ipcRenderer.send('banner:drag-end', did),
  bannerReset: (did: string): void => ipcRenderer.send('banner:reset', did)
}

export type LemonLightApi = typeof api

contextBridge.exposeInMainWorld('lemonLight', api)
