import { BrowserWindow, screen, shell } from 'electron'
import { join } from 'node:path'
import type { AppSettings, BannerCustomPosition } from '@shared/types'

const BALL_HIT = 84
const PANEL_WIDTH = 336
const PANEL_HEIGHT = 480

let windowShowGate: () => boolean = () => true

export function setWindowShowGate(gate: () => boolean): void {
  windowShowGate = gate
}

export function estimateBannerHeight(settings: AppSettings['bottomBanner']): number {
  const base = settings.fontSize || 13
  const line = Math.round(base * 1.8 + 10)
  const lines = settings.layout === 'rows' ? Math.min(3, Math.max(1, settings.rows)) : 2
  return lines * line + 10
}

function rendererUrl(page: string): string {
  return `${process.env['ELECTRON_RENDERER_URL'] ?? ''}/${page}/index.html`
}

function loadRenderer(win: BrowserWindow, page: string, query?: Record<string, string>): void {
  if (process.env['ELECTRON_RENDERER_URL']) {
    const qs = query ? `?${new URLSearchParams(query).toString()}` : ''
    win.loadURL(`${rendererUrl(page)}${qs}`)
  } else {
    win.loadFile(join(__dirname, `../renderer/${page}/index.html`), query ? { query } : undefined)
  }
}

function clampToDisplay(x: number, y: number, w: number, h: number): { x: number; y: number } {
  const display =
    screen.getDisplayMatching({ x, y, width: w, height: h }) ?? screen.getPrimaryDisplay()
  const area = display.workArea
  const cx = Math.min(Math.max(x, area.x), area.x + area.width - w)
  const cy = Math.min(Math.max(y, area.y), area.y + area.height - h)
  return { x: Math.round(cx), y: Math.round(cy) }
}

export class FloatingBallWindow {
  win: BrowserWindow | null = null
  private onPositionSaved: (pos: { x: number; y: number }) => void
  private expanded = false
  private ballPos = { x: 100, y: 100 }
  private dragState: { offsetX: number; offsetY: number } | null = null
  private showGate: () => boolean = () => true

  constructor(onPositionSaved: (pos: { x: number; y: number }) => void) {
    this.onPositionSaved = onPositionSaved
  }

  isVisible(): boolean {
    return this.win !== null && !this.win.isDestroyed()
  }

  isShownOnScreen(): boolean {
    return this.win !== null && !this.win.isDestroyed() && this.win.isVisible()
  }

  create(settings: AppSettings, showGate?: () => boolean): void {
    if (this.isVisible()) return
    if (showGate) this.showGate = showGate
    const primary = screen.getPrimaryDisplay().workArea
    const saved = settings.floatingBall.position
    const pos = saved
      ? clampToDisplay(saved.x, saved.y, BALL_HIT, BALL_HIT)
      : { x: primary.x + primary.width - BALL_HIT - 14, y: primary.y + 120 }
    this.ballPos = pos

    this.win = new BrowserWindow({
      width: BALL_HIT,
      height: BALL_HIT,
      useContentSize: true,
      x: pos.x,
      y: pos.y,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      maximizable: false,
      skipTaskbar: true,
      hasShadow: false,
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.mjs'),
        sandbox: false
      }
    })
    this.win.setAlwaysOnTop(true, 'screen-saver')
    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    this.win.setIgnoreMouseEvents(true, { forward: true })

    this.win.on('moved', () => {
      if (!this.win || this.win.isDestroyed() || this.dragState) return
      const [x, y] = this.win.getPosition()
      this.ballPos = { x, y }
      if (!this.expanded) this.onPositionSaved({ x, y })
    })
    this.win.on('closed', () => (this.win = null))
    this.win.once('ready-to-show', () => {
      if (this.showGate()) this.win?.show()
    })

    this.win.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url)
      return { action: 'deny' }
    })

    loadRenderer(this.win, 'floating-ball')
  }

  destroy(): void {
    this.win?.destroy()
    this.win = null
  }

  setIgnoreMouse(ignore: boolean): void {
    if (!this.win || this.win.isDestroyed()) return
    this.win.setIgnoreMouseEvents(ignore, { forward: true })
  }

  setShown(shown: boolean): void {
    if (!this.win || this.win.isDestroyed()) return
    if (shown) {
      if (!this.win.isVisible()) this.win.show()
    } else if (this.win.isVisible()) {
      this.win.hide()
    }
  }

  setExpanded(expanded: boolean): void {
    if (!this.win || this.win.isDestroyed()) return
    this.expanded = expanded
    if (expanded) {
      const bounds = this.win.getBounds()
      let px = bounds.x
      const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y })
      const area = display.workArea
      if (px + PANEL_WIDTH > area.x + area.width) px = area.x + area.width - PANEL_WIDTH
      if (px < area.x) px = area.x
      let py = bounds.y + BALL_HIT + 8
      if (py + PANEL_HEIGHT > area.y + area.height) py = bounds.y - PANEL_HEIGHT - 8
      if (py < area.y) py = area.y
      this.win.setBounds({ x: px, y: py, width: PANEL_WIDTH, height: PANEL_HEIGHT })
    } else {
      const clamped = clampToDisplay(this.ballPos.x, this.ballPos.y, BALL_HIT, BALL_HIT)
      this.ballPos = clamped
      this.win.setBounds({ x: clamped.x, y: clamped.y, width: BALL_HIT, height: BALL_HIT })
    }
  }

  beginDrag(offsetX: number, offsetY: number): void {
    this.dragState = { offsetX, offsetY }
  }

  moveDrag(clientX: number, clientY: number): void {
    if (!this.dragState || !this.win || this.win.isDestroyed()) return
    const clamped = clampToDisplay(
      Math.round(clientX - this.dragState.offsetX),
      Math.round(clientY - this.dragState.offsetY),
      BALL_HIT,
      BALL_HIT
    )
    this.ballPos = clamped
    this.win.setPosition(clamped.x, clamped.y)
  }

  endDrag(): void {
    if (!this.dragState) return
    this.dragState = null
    if (!this.win || this.win.isDestroyed() || this.expanded) return
    const [x, y] = this.win.getPosition()
    this.ballPos = { x, y }
    this.onPositionSaved({ x, y })
  }
}

export class BannerWindow {
  win: BrowserWindow | null = null
  readonly displayId: number
  readonly displayKey: string
  readonly screenIndex: number
  readonly screenTotal: number
  private custom: BannerCustomPosition | null = null
  private anchoredBottom = true
  private dragOffsets: { x: number; y: number } | null = null

  constructor(
    displayId: number,
    screenIndex: number,
    screenTotal: number,
    displayKey: string,
    custom: BannerCustomPosition | null
  ) {
    this.displayId = displayId
    this.screenIndex = screenIndex
    this.screenTotal = screenTotal
    this.displayKey = displayKey
    this.custom = custom
  }

  create(height: number): void {
    const display = screen.getAllDisplays().find((d) => d.id === this.displayId)
    if (!display) return
    const area = display.workArea
    let x: number
    let y: number
    if (this.custom) {
      x = this.custom.x
      y = this.custom.y
      this.anchoredBottom = false
    } else {
      x = area.x
      y = area.y + area.height - height
      this.anchoredBottom = true
    }

    this.win = new BrowserWindow({
      width: area.width,
      height,
      x,
      y,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      maximizable: false,
      skipTaskbar: true,
      hasShadow: false,
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.mjs'),
        sandbox: false
      }
    })
    this.win.setAlwaysOnTop(true, 'screen-saver')
    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    this.win.setIgnoreMouseEvents(false)
    this.win.on('closed', () => (this.win = null))
    this.win.once('ready-to-show', () => {
      if (windowShowGate()) this.win?.show()
    })
    loadRenderer(this.win, 'bottom-banner', {
      screen: String(this.screenIndex),
      total: String(this.screenTotal),
      did: String(this.displayId)
    })
  }

  destroy(): void {
    this.win?.destroy()
    this.win = null
  }

  setShown(shown: boolean): void {
    if (!this.win || this.win.isDestroyed()) return
    if (shown) {
      if (!this.win.isVisible()) this.win.show()
    } else if (this.win.isVisible()) {
      this.win.hide()
    }
  }

  private displayArea(): Electron.Rectangle | null {
    const display = screen.getAllDisplays().find((d) => d.id === this.displayId)
    return display ? display.workArea : null
  }

  setContentHeight(height: number): void {
    if (!this.win || this.win.isDestroyed()) return
    const area = this.displayArea()
    if (!area) return
    const bounds = this.win.getBounds()
    if (this.custom && !this.anchoredBottom) {
      this.win.setBounds({ x: bounds.x, y: bounds.y, width: area.width, height })
      return
    }
    this.win.setBounds({
      x: area.x,
      y: area.y + area.height - height,
      width: area.width,
      height
    })
  }

  beginDrag(offsetX: number, offsetY: number): void {
    this.dragOffsets = { x: offsetX, y: offsetY }
  }

  moveDrag(clientX: number, clientY: number): void {
    if (!this.dragOffsets || !this.win || this.win.isDestroyed()) return
    const nx = Math.round(clientX - this.dragOffsets.x)
    const ny = Math.round(clientY - this.dragOffsets.y)
    this.win.setPosition(nx, ny)
    this.custom = { x: nx, y: ny }
    this.anchoredBottom = false
  }

  endDrag(): { displayKey: string; custom: BannerCustomPosition } | null {
    if (!this.dragOffsets) return null
    this.dragOffsets = null
    if (!this.win || this.win.isDestroyed()) return null
    const [x, y] = this.win.getPosition()
    this.custom = { x, y }
    this.anchoredBottom = false
    return { displayKey: this.displayKey, custom: this.custom }
  }

  resetToBottom(): void {
    this.custom = null
    this.anchoredBottom = true
    if (!this.win || this.win.isDestroyed()) return
    const area = this.displayArea()
    if (!area) return
    const h = this.win.getBounds().height
    this.win.setBounds({ x: area.x, y: area.y + area.height - h, width: area.width, height: h })
  }
}
