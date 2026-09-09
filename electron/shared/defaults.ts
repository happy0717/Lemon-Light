import type { AppSettings, Database, Market } from './types'

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
    autoHideWhenClosed: false,
    stockMode: 'dayChange'
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
    customPositions: {},
    showHoldingsPnl: false,
    flipChangeAmount: false
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
  alertLogRetentionDays: 30,
  tradeFees: {
    cn: { commissionBps: 2.5, minCommission: 5 },
    hk: { commissionBps: 3, minCommission: 3 },
    us: { commissionBps: 0, minCommission: 0 }
  }
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

  const tfBase = { ...base.tradeFees, ...(partial.tradeFees ?? {}) }
  for (const m of Object.keys(base.tradeFees) as Market[]) {
    tfBase[m] = { ...base.tradeFees[m], ...(tfBase[m] ?? {}) }
    const rule = tfBase[m]
    rule.commissionBps = clampNonNegative(Number(rule.commissionBps))
    rule.minCommission = clampNonNegative(Number(rule.minCommission))
  }
  merged.tradeFees = tfBase
  return merged
}

function clampNonNegative(value: number): number {
  if (!Number.isFinite(value)) return 0
  return value >= 0 ? value : 0
}
