import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { Database } from './types'
import { createDefaultDatabase, mergeSettings } from './defaults'

export class StorageService extends EventEmitter {
  private db: Database
  private dbPath: string
  private writeTimer: NodeJS.Timeout | null = null

  constructor(userDataPath: string) {
    super()
    this.dbPath = join(userDataPath, 'lemon-light-db.json')
    this.db = createDefaultDatabase()
  }

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.dbPath, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<Database>
      this.db = {
        watchlist: Array.isArray(parsed.watchlist) ? parsed.watchlist : [],
        groups: Array.isArray(parsed.groups) ? parsed.groups : [],
        alerts: Array.isArray(parsed.alerts) ? parsed.alerts : [],
        alertLogs: Array.isArray(parsed.alertLogs) ? parsed.alertLogs : [],
        holdings:
          parsed.holdings && typeof parsed.holdings === 'object'
            ? { version: 2, trades: parsed.holdings.trades ?? [], archives: parsed.holdings.archives ?? [] }
            : { version: 2, trades: [], archives: [] },
        settings: mergeSettings(parsed.settings)
      }
    } catch {
      this.db = createDefaultDatabase()
    }
  }

  get(): Database {
    return this.db
  }

  set<K extends keyof Database>(key: K, value: Database[K]): void {
    this.db[key] = value
    this.persist()
    this.emit('changed', key)
  }

  patchSettings(partial: Partial<Database['settings']>): void {
    this.db.settings = mergeSettings({ ...this.db.settings, ...partial } as Database['settings'])
    this.persist()
    this.emit('changed', 'settings')
  }

  replaceAll(db: Database): void {
    this.db = {
      watchlist: db.watchlist,
      groups: db.groups,
      alerts: db.alerts,
      alertLogs: Array.isArray(db.alertLogs) ? db.alertLogs : [],
      holdings: db.holdings,
      settings: mergeSettings(db.settings)
    }
    this.persist()
    this.emit('changed', '*')
  }

  private persist(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer)
    this.writeTimer = setTimeout(() => {
      void (async () => {
        try {
          const tmp = `${this.dbPath}.tmp`
          await fs.writeFile(tmp, JSON.stringify(this.db, null, 2), 'utf-8')
          await fs.rename(tmp, this.dbPath)
        } catch (err) {
          console.error('[storage] persist failed:', err)
        }
      })()
    }, 300)
  }

  async flush(): Promise<void> {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }
    try {
      await fs.writeFile(this.dbPath, JSON.stringify(this.db, null, 2), 'utf-8')
    } catch (err) {
      console.error('[storage] flush failed:', err)
    }
  }
}
