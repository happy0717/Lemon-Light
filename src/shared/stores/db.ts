import { defineStore } from 'pinia'
import { reactive } from 'vue'
import type { Database } from '@shared/types'
import { createDefaultDatabase } from '@shared/defaults'
import { bridge } from '../bridge'

export interface DbChangedPayload {
  key: string
  db: Database
}

function toPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export const useDbStore = defineStore('db', () => {
  const db = reactive<Database>(createDefaultDatabase())
  let initialized = false
  const initCallbacks: Array<() => void> = []

  function applyRemote(fresh: Database): void {
    Object.assign(db, fresh)
  }

  async function refresh(): Promise<void> {
    applyRemote(await bridge.getDb())
  }

  async function init(): Promise<void> {
    if (initialized) return
    initialized = true
    applyRemote(await bridge.getDb())
    bridge.onDbChanged((payload?: DbChangedPayload) => {
      if (payload?.db) applyRemote(payload.db)
      else void refresh()
    })
    initCallbacks.forEach((cb) => cb())
  }

  function onReady(cb: () => void): void {
    if (initialized) cb()
    else initCallbacks.push(cb)
  }

  async function setWatchlist(symbols: string[]): Promise<void> {
    db.watchlist = symbols
    const fresh = await bridge.setDbKey('watchlist', toPlain(symbols))
    applyRemote(fresh)
  }

  async function setGroups(groups: Database['groups']): Promise<void> {
    db.groups = groups
    const fresh = await bridge.setDbKey('groups', toPlain(groups))
    applyRemote(fresh)
  }

  async function setAlerts(alerts: Database['alerts']): Promise<void> {
    db.alerts = alerts
    const fresh = await bridge.setDbKey('alerts', toPlain(alerts))
    applyRemote(fresh)
  }

  async function setHoldings(holdings: Database['holdings']): Promise<void> {
    db.holdings = holdings
    const fresh = await bridge.setDbKey('holdings', toPlain(holdings))
    applyRemote(fresh)
  }

  async function removeAlertLogs(ids: string[]): Promise<void> {
    const fresh = await bridge.removeAlertLogs(ids)
    applyRemote(fresh)
  }

  async function clearAlertLogs(): Promise<void> {
    const fresh = await bridge.clearAlertLogs()
    applyRemote(fresh)
  }

  async function patchSettings(partial: Partial<Database['settings']>): Promise<void> {
    Object.assign(db.settings, toPlain(partial))
    const fresh = await bridge.patchSettings(toPlain(partial))
    applyRemote(fresh)
  }

  return {
    db,
    init,
    onReady,
    setWatchlist,
    setGroups,
    setAlerts,
    setHoldings,
    removeAlertLogs,
    clearAlertLogs,
    patchSettings
  }
})
