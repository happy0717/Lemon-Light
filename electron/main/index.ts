import { app, BrowserWindow, globalShortcut, ipcMain, Notification, screen } from 'electron'
import { join } from 'node:path'
import { StorageService } from '@shared/storage'
import { QuoteService } from '@shared/quote-service'
import { searchTencent, fetchTencentDailyKline } from '@shared/sources/tencent'
import { searchEastmoney } from '@shared/sources/eastmoney'
import type { AlertFireDetail, AlertLogItem, AppSettings, Database, Quote, StockAlert } from '@shared/types'
import { anyMarketOpen, anyMarketOverlayShown } from '@shared/market-hours'
import { FloatingBallWindow, BannerWindow, estimateBannerHeight, setWindowShowGate } from './windows'
import { createTray, refreshTrayMenu } from './tray'
import { exportBackup, parseBackupFile, applyBackup } from './backup'

if (process.env.LEMON_LIGHT_USER_DATA) {
  app.setPath('userData', process.env.LEMON_LIGHT_USER_DATA)
} else if (process.env.PORTABLE_EXECUTABLE_DIR) {
  app.setPath('userData', join(process.env.PORTABLE_EXECUTABLE_DIR, 'LemonLightData'))
}

app.setAppUserModelId('com.lemonlight.desktop')

let settingsWindow: BrowserWindow | null = null
const ballWindow = new FloatingBallWindow((pos) => onBallPositionSaved(pos))
const bannerWindows: BannerWindow[] = []

let bossHide = false
let desiredBallShown = true
let desiredBannerShown = true

function setQuitting(value: boolean): void {
  ;(app as unknown as { isQuitting?: boolean }).isQuitting = value
}

function isQuitting(): boolean {
  return Boolean((app as unknown as { isQuitting?: boolean }).isQuitting)
}

const storage = new StorageService(app.getPath('userData'))
const quoteService = new QuoteService()

function currentSettings(): AppSettings {
  return storage.get().settings
}

function allQuoteSymbols(): string[] {
  const db = storage.get()
  const { settings } = db
  const symbols = [...db.watchlist, ...settings.mainMarketIndexes]
  if (settings.bottomBanner.showMarketIndexes) {
    symbols.push(...settings.bottomBanner.marketIndexSymbols)
  }
  db.groups.forEach((g) => symbols.push(...g.symbols))
  return [...new Set(symbols)]
}

function recomputeOverlayDesired(): void {
  const settings = currentSettings()
  const marketOpen = anyMarketOverlayShown(allQuoteSymbols())
  desiredBallShown =
    !bossHide &&
    settings.floatingBall.visible &&
    !(settings.floatingBall.autoHideWhenClosed && !marketOpen)
  desiredBannerShown = !bossHide && settings.bottomBanner.visible
}

function applyOverlayVisibility(): void {
  recomputeOverlayDesired()
  if (!desiredBallShown && ballWindow.isShownOnScreen()) {
    const wc = ballWindow.win?.webContents
    if (wc && !wc.isDestroyed()) wc.send('ball:collapse')
  }
  ballWindow.setShown(desiredBallShown)
  for (const banner of bannerWindows) banner.setShown(desiredBannerShown)
}

function setBossHide(hidden: boolean): void {
  if (bossHide === hidden) return
  bossHide = hidden
  applyOverlayVisibility()
  refreshTrayMenu()
}

function toggleBossHide(): void {
  setBossHide(!bossHide)
}

function refreshBossKeyShortcut(): void {
  globalShortcut.unregisterAll()
  const cfg = currentSettings().bossKey
  if (!cfg.enabled || !cfg.accelerator) return
  try {
    const ok = globalShortcut.register(cfg.accelerator, () => toggleBossHide())
    if (!ok) {
      new Notification({
        title: 'Lemon Light',
        body: `老板键 ${cfg.accelerator} 注册失败，可能被其他程序占用`
      }).show()
    }
  } catch (err) {
    console.warn('[bossKey] register failed:', err)
  }
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

function broadcastDbChanged(key: string): void {
  broadcast('db:changed', { key, db: storage.get() })
}

function onBallPositionSaved(pos: { x: number; y: number }): void {
  const settings = currentSettings()
  storage.patchSettings({
    floatingBall: { ...settings.floatingBall, position: pos }
  })
}

function createSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show()
    settingsWindow.focus()
    return
  }
  settingsWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 880,
    minHeight: 600,
    show: false,
    backgroundColor: '#0b0d10',
    title: 'Lemon Light · 设置',
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false
    }
  })
  const isQuittingNow = () => isQuitting()
  setQuitting(false)
  settingsWindow.on('close', (e) => {
    if (!isQuittingNow()) {
      e.preventDefault()
      settingsWindow?.hide()
    }
  })
  settingsWindow.once('ready-to-show', () => settingsWindow?.show())
  if (process.env['ELECTRON_RENDERER_URL']) {
    settingsWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/settings/index.html`)
  } else {
    settingsWindow.loadFile(join(__dirname, '../renderer/settings/index.html'))
  }
}

function manageBannerWindows(): void {
  const settings = currentSettings().bottomBanner
  bannerWindows.forEach((w) => w.destroy())
  bannerWindows.length = 0
  if (!settings.visible) {
    applyOverlayVisibility()
    return
  }

  const height = estimateBannerHeight(settings)
  const displays = screen.getAllDisplays()
  if (settings.displayMode === 'primary') {
    const primary = screen.getPrimaryDisplay()
    const key = String(primary.id)
    const banner = new BannerWindow(primary.id, 0, 1, key, settings.customPositions[key] ?? null)
    banner.create(height)
    banner.setClickThrough(settings.clickThrough)
    bannerWindows.push(banner)
  } else {
    const sorted = [...displays].sort((a, b) => a.bounds.x - b.bounds.x)
    sorted.forEach((d, index) => {
      const key = String(d.id)
      const banner = new BannerWindow(d.id, index, sorted.length, key, settings.customPositions[key] ?? null)
      banner.create(height)
      banner.setClickThrough(settings.clickThrough)
      bannerWindows.push(banner)
    })
  }
  applyOverlayVisibility()
}

function findBannerByDisplayKey(key: string): BannerWindow | null {
  return bannerWindows.find((w) => w.displayKey === key && w.win && !w.win.isDestroyed()) ?? null
}

function syncFloatingBall(): void {
  const { floatingBall } = currentSettings()
  if (floatingBall.visible) {
    ballWindow.create(currentSettings(), () => desiredBallShown)
  } else {
    ballWindow.destroy()
  }
  applyOverlayVisibility()
}

function syncQuoteTargets(): void {
  quoteService.updateSymbols(allQuoteSymbols())
}

function applyAllSettings(): void {
  const settings = currentSettings()
  quoteService.updateSettings(settings.refreshIntervalMs, settings.alertsEnabled)
  syncQuoteTargets()
  syncFloatingBall()
  manageBannerWindows()
  refreshBossKeyShortcut()
  applyOverlayVisibility()
  broadcastDbChanged('*')
}

function applySmartChanges(prev: AppSettings, next: AppSettings): void {
  quoteService.updateSettings(next.refreshIntervalMs, next.alertsEnabled)
  syncQuoteTargets()

  const prevIndexes = `${prev.mainMarketIndexes.join(',')}|${prev.bottomBanner.marketIndexSymbols.join(',')}|${prev.bottomBanner.showMarketIndexes}`
  const nextIndexes = `${next.mainMarketIndexes.join(',')}|${next.bottomBanner.marketIndexSymbols.join(',')}|${next.bottomBanner.showMarketIndexes}`
  if (prevIndexes !== nextIndexes) {
    void quoteService.fetchAll(true)
  }

  const ballToggled = prev.floatingBall.visible !== next.floatingBall.visible
  if (ballToggled) syncFloatingBall()

  const bannerRebuild =
    prev.bottomBanner.visible !== next.bottomBanner.visible ||
    prev.bottomBanner.displayMode !== next.bottomBanner.displayMode
  if (bannerRebuild) manageBannerWindows()

  if (prev.bottomBanner.clickThrough !== next.bottomBanner.clickThrough) {
    for (const banner of bannerWindows) banner.setClickThrough(next.bottomBanner.clickThrough)
  }

  const bossKeyChanged = JSON.stringify(prev.bossKey ?? {}) !== JSON.stringify(next.bossKey ?? {})
  if (bossKeyChanged) refreshBossKeyShortcut()

  if (prev.alertLogRetentionDays !== next.alertLogRetentionDays) {
    const db = storage.get()
    storage.set('alertLogs', pruneAlertLogs(db.alertLogs, next.alertLogRetentionDays ?? 0))
  }

  applyOverlayVisibility()
  broadcastDbChanged('settings')
}

let alertToastWin: BrowserWindow | null = null
let alertToastTimer: ReturnType<typeof setTimeout> | null = null

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function showSystemNotification(alert: StockAlert, quote: Quote): void {
  const kindText = alert.kind === 'price' ? '价格' : '涨跌幅'
  const dirText = alert.direction === 'gte' ? '突破' : '跌破'
  const unit = alert.kind === 'price' ? '' : '%'
  const n = new Notification({
    title: `Lemon Light · ${quote.name} ${kindText}预警`,
    body: `${quote.name}(${quote.symbol}) 现价 ${quote.price}，${dirText} ${alert.threshold}${unit}`,
    silent: false
  })
  n.show()
}

function showAlertToast(alert: StockAlert, quote: Quote): void {
  if (alertToastTimer) {
    clearTimeout(alertToastTimer)
    alertToastTimer = null
  }
  if (!alertToastWin || alertToastWin.isDestroyed()) {
    alertToastWin = new BrowserWindow({
      width: 560,
      height: 92,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      hasShadow: false,
      thickFrame: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
  }
  const kindText = alert.kind === 'price' ? '价格预警' : '涨跌幅预警'
  const dirText = alert.direction === 'gte' ? '突破' : '跌破'
  const unit = alert.kind === 'price' ? '' : '%'
  const delta = Number.isFinite(quote.changePercent) ? quote.changePercent : 0
  const accent = delta >= 0 ? '#e5484d' : '#1f9d63'
  const now = new Date()
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  const priceText = Number.isFinite(quote.price) ? String(quote.price) : '--'
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:transparent;font-family:"Microsoft YaHei UI","Microsoft YaHei",sans-serif;-webkit-user-select:none}
    .toast{display:flex;gap:12px;align-items:center;padding:13px 16px;border-radius:14px;background:rgba(16,18,23,0.97);border:1px solid rgba(255,255,255,0.12);border-left:4px solid ${accent};box-shadow:0 10px 30px rgba(0,0,0,0.5);animation:pop .22s ease}
    .mark{flex-shrink:0;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;color:#fff;background:${accent}}
    .main{flex:1;min-width:0}
    .t1{color:#f4f6f8;font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .t2{color:#a9b2bd;font-size:12px;margin-top:5px}
    .price{flex-shrink:0;text-align:right;font-variant-numeric:tabular-nums}
    .p1{color:#fff;font-size:17px;font-weight:700}
    .p2{color:${accent};font-size:12px;margin-top:3px}
    @keyframes pop{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}
  </style></head><body><div class="toast">
    <div class="mark">⚡</div>
    <div class="main">
      <div class="t1">${escapeHtml(quote.name)}（${escapeHtml(quote.symbol)}）· ${kindText}</div>
      <div class="t2">${dirText} ${alert.threshold}${unit} · ${hh}:${mm}:${ss}</div>
    </div>
    <div class="price">
      <div class="p1">${priceText}</div>
      <div class="p2">${delta >= 0 ? '+' : ''}${delta.toFixed(2)}%</div>
    </div>
  </div></body></html>`
  const wa = screen.getPrimaryDisplay().workArea
  alertToastWin.setBounds({
    x: Math.round(wa.x + (wa.width - 560) / 2),
    y: wa.y + 12,
    width: 560,
    height: 92
  })
  void alertToastWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  alertToastWin.webContents.once('did-finish-load', () => {
    if (alertToastWin && !alertToastWin.isDestroyed()) {
      alertToastWin.setIgnoreMouseEvents(true, { forward: true })
      alertToastWin.showInactive()
    }
  })
  alertToastTimer = setTimeout(() => {
    if (alertToastWin && !alertToastWin.isDestroyed()) alertToastWin.hide()
  }, 8000)
}

function showAlertVisual(alert: StockAlert, quote: Quote): void {
  showSystemNotification(alert, quote)
  showAlertToast(alert, quote)
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function fmtLogTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

function fmtMinute(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function fmtPriceNum(v: number): string {
  if (!Number.isFinite(v)) return '--'
  return String(parseFloat(v.toFixed(3)))
}

function fmtSignPct(v: number): string {
  if (!Number.isFinite(v)) return '--'
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}

function alertBehaviorText(alert: StockAlert, quote: Quote, detail: AlertFireDetail): string {
  const name = `${quote.name}（${alert.symbol}）`
  const up = alert.direction === 'gte'
  if (alert.kind === 'price') {
    return `检测到 ${name} 现价 ${fmtPriceNum(detail.value)}，已${up ? '突破' : '跌破'}设定的价格阈值 ${alert.threshold} 元`
  }
  const moveWord = detail.value >= 0 ? '涨至' : '跌至'
  const changeWord = up ? '涨幅' : '跌幅'
  const thresholdWord = `已${up ? '超过' : '跌破'}设定阈值 ${fmtSignPct(alert.threshold)}`
  const pricePath = `价格由 ${fmtPriceNum(detail.refPrice ?? 0)} ${moveWord} ${fmtPriceNum(quote.price)}`
  if (detail.windowMin && detail.windowMin > 0) {
    const win = detail.windowMin >= 240 ? '全天' : `${detail.windowMin} 分钟`
    const startTs = detail.windowStartAt ?? Date.now() - detail.windowMin * 60_000
    const range = `${fmtMinute(startTs)} 至 ${fmtMinute(Date.now())}`
    return `检测到 ${name} 在时间窗口${win}（${range}）内，${pricePath}，${changeWord} ${fmtSignPct(detail.value)}，${thresholdWord}`
  }
  return `检测到 ${name} 基于${detail.refLabel}（${fmtPriceNum(detail.refPrice ?? 0)}）${moveWord} ${fmtPriceNum(quote.price)}，${changeWord} ${fmtSignPct(detail.value)}，${thresholdWord}`
}

function pruneAlertLogs(logs: AlertLogItem[], retentionDays: number): AlertLogItem[] {
  if (retentionDays <= 0) return logs
  const cutoff = Date.now() - retentionDays * 86_400_000
  return logs.filter((l) => l.firedAt >= cutoff)
}

function onAlertFired(alert: StockAlert, quote: Quote, detail: AlertFireDetail): void {
  const db = storage.get()
  const entry: AlertLogItem = {
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    alertId: alert.id,
    symbol: alert.symbol,
    name: quote.name,
    behaviorText: alertBehaviorText(alert, quote, detail),
    firedAt: Date.now(),
    kind: alert.kind,
    direction: alert.direction,
    threshold: alert.threshold,
    value: detail.value,
    refPrice: detail.refPrice,
    price: quote.price,
    changePercent: quote.changePercent
  }
  const nextLogs = pruneAlertLogs([entry, ...db.alertLogs], db.settings.alertLogRetentionDays ?? 30)
  storage.set('alertLogs', nextLogs)
  storage.set('alerts', db.alerts)
  broadcastDbChanged('alerts')
  showAlertVisual(alert, quote)
}

function registerIpc(): void {
  ipcMain.handle('db:get', () => storage.get())
  ipcMain.handle('db:set', (_e, key: keyof Database, value: unknown) => {
    storage.set(key, value as never)
    if (key === 'settings') applyAllSettings()
    else if (key === 'watchlist' || key === 'groups') {
      syncQuoteTargets()
      applyOverlayVisibility()
      void quoteService.fetchAll(true)
    } else if (key === 'alerts') {
      quoteService.updateAlerts(value as StockAlert[])
      if (anyMarketOpen(allQuoteSymbols())) void quoteService.fetchAll(true)
    }
    broadcastDbChanged(key as string)
    return storage.get()
  })
  ipcMain.handle('db:patch-settings', (_e, partial: Partial<AppSettings>) => {
    const prev = currentSettings()
    storage.patchSettings(partial)
    applySmartChanges(prev, currentSettings())
    return storage.get()
  })

  ipcMain.handle('quotes:fetch', (_e, force = false) => quoteService.fetchAll(force))
  ipcMain.handle('quotes:snapshot', () => quoteService.getSnapshot())
  ipcMain.handle('alerts:test', () => {
    const db = storage.get()
    const rule = db.alerts.find((a) => a.enabled)
    const symbol = rule?.symbol ?? db.watchlist[0]
    if (!symbol) return false
    const existing = quoteService.getSnapshot().quotes[symbol]
    const quote: Quote = existing ?? {
      symbol,
      code: symbol.slice(2),
      name: symbol,
      price: 0,
      previousClose: 0,
      open: 0,
      high: 0,
      low: 0,
      change: 0,
      changePercent: 0,
      volume: 0,
      amount: 0,
      tradeTime: '',
      currencyCode: 'CNY',
      marketLabel: symbol.slice(0, 2).toUpperCase(),
      status: '休市'
    }
    const alert: StockAlert = rule ?? {
      id: 'alert-test',
      symbol,
      kind: 'price',
      direction: 'gte',
      threshold: quote.price || 0.01,
      enabled: true,
      triggered: false,
      note: '测试'
    }
    showAlertVisual(alert, quote)
    return true
  })
  ipcMain.handle('alerts:logs-delete', (_e, ids: string[]) => {
    const db = storage.get()
    const remove = new Set(Array.isArray(ids) ? ids.map(String) : [])
    storage.set('alertLogs', db.alertLogs.filter((l) => !remove.has(l.id)))
    broadcastDbChanged('alertLogs')
    return storage.get()
  })
  ipcMain.handle('alerts:logs-clear', () => {
    storage.set('alertLogs', [])
    broadcastDbChanged('alertLogs')
    return storage.get()
  })
  ipcMain.handle('search:stock', async (_e, keyword: string) => {
    try {
      const results = await searchTencent(keyword)
      if (results.length > 0) return results
    } catch {
      // fallthrough
    }
    try {
      return await searchEastmoney(keyword)
    } catch {
      return []
    }
  })
  ipcMain.handle('kline:daily', (_e, symbol: string) => fetchTencentDailyKline(symbol))

  ipcMain.handle('backup:export', async () => exportBackup(storage.get()))
  ipcMain.handle('backup:pick-file', async () => parseBackupFile())
  ipcMain.handle('backup:apply', (_e, backup: unknown, options?: Partial<Record<'watchlist' | 'groups' | 'alerts' | 'holdings' | 'settings', boolean>>) => {
    const result = applyBackup(backup, storage, options)
    if (result.ok) {
      applyAllSettings()
      void quoteService.fetchAll(true)
    }
    return result
  })

  ipcMain.on('ball:position', (_e, pos: { x: number; y: number }) => onBallPositionSaved(pos))
  ipcMain.on('ball:set-ignore-mouse', (_e, ignore: boolean) => ballWindow.setIgnoreMouse(ignore))
  ipcMain.on('ball:set-expanded', (_e, expanded: boolean) => ballWindow.setExpanded(expanded))
  ipcMain.on('app:open-settings', () => createSettingsWindow())
  ipcMain.on('app:quit', () => {
    setQuitting(true)
    app.quit()
  })

  ipcMain.on('ball:drag-start', (_e, offsetX: number, offsetY: number) => {
    ballWindow.setIgnoreMouse(false)
    ballWindow.beginDrag(offsetX, offsetY)
  })
  ipcMain.on('ball:drag-move', (_e, clientX: number, clientY: number) => {
    ballWindow.moveDrag(clientX, clientY)
  })
  ipcMain.on('ball:drag-end', () => {
    ballWindow.endDrag()
  })

  ipcMain.on('banner:content-height', (_e, did: string, height: number) => {
    const banner = findBannerByDisplayKey(did)
    if (banner) banner.setContentHeight(Math.max(20, Math.round(height)))
  })
  ipcMain.on('banner:drag-start', (_e, did: string, offsetX: number, offsetY: number) => {
    findBannerByDisplayKey(did)?.beginDrag(offsetX, offsetY)
  })
  ipcMain.on('banner:drag-move', (_e, did: string, clientX: number, clientY: number) => {
    findBannerByDisplayKey(did)?.moveDrag(clientX, clientY)
  })
  ipcMain.on('banner:drag-end', (_e, did: string) => {
    const banner = findBannerByDisplayKey(did)
    const result = banner?.endDrag()
    if (!result) return
    const bb = currentSettings().bottomBanner
    const customPositions = { ...bb.customPositions, [result.displayKey]: result.custom }
    storage.patchSettings({ bottomBanner: { ...bb, customPositions } })
    broadcastDbChanged('settings')
  })
  ipcMain.on('banner:reset', (_e, did: string) => {
    findBannerByDisplayKey(did)?.resetToBottom()
    const bb = currentSettings().bottomBanner
    const customPositions = { ...bb.customPositions }
    delete customPositions[did]
    storage.patchSettings({ bottomBanner: { ...bb, customPositions } })
    broadcastDbChanged('settings')
  })
  ipcMain.on('banner:set-ignore-mouse', (_e, did: string, ignore: boolean) => {
    findBannerByDisplayKey(did)?.setIgnoreMouse(ignore)
  })
}

function setupScreenWatchers(): void {
  let rebuildTimer: NodeJS.Timeout | null = null
  const scheduleRebuild = () => {
    if (rebuildTimer) clearTimeout(rebuildTimer)
    rebuildTimer = setTimeout(() => manageBannerWindows(), 500)
  }
  screen.on('display-added', scheduleRebuild)
  screen.on('display-removed', scheduleRebuild)
  screen.on('display-metrics-changed', scheduleRebuild)
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    createSettingsWindow()
  })

  void app.whenReady().then(async () => {
    await storage.load()
    registerIpc()
    setupScreenWatchers()

    quoteService.setBroadcast((payload) => broadcast('quotes:sync', payload))
    quoteService.setAlertHandler(onAlertFired)
    quoteService.setAlertsMutatedHandler(() => {
      storage.set('alerts', storage.get().alerts)
      broadcastDbChanged('alerts')
    })
    quoteService.updateAlerts(storage.get().alerts)

    setWindowShowGate(() => desiredBannerShown)
    applyAllSettings()
    createTray({
      onOpenSettings: () => createSettingsWindow(),
      onToggleBall: (visible) => {
        const settings = currentSettings()
        storage.patchSettings({ floatingBall: { ...settings.floatingBall, visible } })
        syncFloatingBall()
        broadcastDbChanged('settings')
      },
      onToggleBanner: (visible) => {
        const settings = currentSettings()
        storage.patchSettings({ bottomBanner: { ...settings.bottomBanner, visible } })
        manageBannerWindows()
        broadcastDbChanged('settings')
      },
      onToggleBoss: () => toggleBossHide(),
      onQuit: () => {
        setQuitting(true)
        app.quit()
      },
      isVisibleBall: () => currentSettings().floatingBall.visible,
      isBannerVisible: () => currentSettings().bottomBanner.visible,
      isBossHidden: () => bossHide
    })

    quoteService.start()
    setInterval(() => applyOverlayVisibility(), 30_000)
    setTimeout(() => createSettingsWindow(), 1800)
  })

  app.on('window-all-closed', () => {
    // 托盘常驻，不退出
  })

  app.on('before-quit', async () => {
    globalShortcut.unregisterAll()
    if (alertToastTimer) clearTimeout(alertToastTimer)
    if (alertToastWin && !alertToastWin.isDestroyed()) alertToastWin.destroy()
    await storage.flush()
  })
}
