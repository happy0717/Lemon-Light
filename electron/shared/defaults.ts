import type { AppSettings, Database } from './types'

export const DEFAULT_SETTINGS: AppSettings = {
  refreshIntervalMs: 5000,
  userName: '',
  mainMarketIndexes: ['sh000001', 'sz399001', 'sz399006'],
  bossKey: {
    enabled: false,
    accelerator: 'CommandOrControl+Shift+B'
  },
  floatingBall: {
    visible: true,
    position: null,
    badge: true,
    autoHideWhenClosed: false
  },
  bottomBanner: {
    visible: true,
    displayMode: 'primary',
    autoHide: false,
    scrollSpeed: 50,
    showMarketIndexes: true,
    marketIndexSymbols: ['sh000001', 'sz399001', 'sz399006'],
    layout: 'rows',
    rows: 1,
    fontSize: 13,
    fontFamily: '',
    fontWeight: 400,
    customPositions: {}
  },
  bannerAppearance: {
    backgroundColor: '#101216',
    opacity: 82
  },
  ballPanelAppearance: {
    backgroundColor: '#101216',
    opacity: 82
  },
  settingsAppearance: {
    backgroundColor: '#0a0c10'
  },
  alertsEnabled: true,
  holdingProfitVisible: true,
  alertLogRetentionDays: 30
}

export function createDefaultDatabase(): Database {
  return {
    watchlist: [],
    groups: [],
    alerts: [],
    alertLogs: [],
    holdings: { version: 2, trades: [], archives: [] },
    settings: structuredClone(DEFAULT_SETTINGS)
  }
}

export function mergeSettings(partial: Partial<AppSettings> | undefined): AppSettings {
  const base = structuredClone(DEFAULT_SETTINGS)
  if (!partial) return base
  const merged: AppSettings = { ...base, ...partial } as AppSettings
  merged.bossKey = { ...base.bossKey, ...(partial.bossKey ?? {}) }
  merged.floatingBall = { ...base.floatingBall, ...(partial.floatingBall ?? {}) }
  const banner = { ...base.bottomBanner, ...(partial.bottomBanner ?? {}) }
  delete (banner as { height?: number }).height
  merged.bottomBanner = banner

  const legacyPanel = (
    partial as Partial<{ panelAppearance?: { backgroundColor?: string; opacity?: number } }>
  ).panelAppearance
  if (legacyPanel) {
    merged.bannerAppearance = {
      backgroundColor: legacyPanel.backgroundColor ?? base.bannerAppearance.backgroundColor,
      opacity: legacyPanel.opacity ?? base.bannerAppearance.opacity
    }
    merged.ballPanelAppearance = { ...merged.bannerAppearance }
  } else {
    merged.bannerAppearance = { ...base.bannerAppearance, ...(partial.bannerAppearance ?? {}) }
    merged.ballPanelAppearance = {
      ...base.ballPanelAppearance,
      ...(partial.ballPanelAppearance ?? {})
    }
  }
  merged.settingsAppearance = { ...base.settingsAppearance, ...(partial.settingsAppearance ?? {}) }
  delete (merged as { panelAppearance?: unknown }).panelAppearance
  const retention = Number(merged.alertLogRetentionDays)
  merged.alertLogRetentionDays =
    Number.isFinite(retention) && retention > 0 ? Math.floor(retention) : 0
  return merged
}
