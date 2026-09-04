import { Menu, Tray, app, nativeImage, type NativeImage } from 'electron'
import { join } from 'node:path'

export interface TrayHandlers {
  onOpenSettings: () => void
  onToggleBall: (visible: boolean) => void
  onToggleBanner: (visible: boolean) => void
  onToggleBoss: () => void
  onQuit: () => void
  isVisibleBall: () => boolean
  isBannerVisible: () => boolean
  isBossHidden: () => boolean
}

let tray: Tray | null = null
let trayMenuRebuild: (() => void) | null = null

function loadTrayIcon(): NativeImage {
  const iconPath = join(__dirname, '../../resources/tray.png')
  const img = nativeImage.createFromPath(iconPath)
  if (!img.isEmpty()) return img
  return nativeImage.createEmpty()
}

export function createTray(handlers: TrayHandlers): void {
  if (tray) return
  tray = new Tray(loadTrayIcon())
  tray.setToolTip('Lemon Light')

  const rebuild = () => {
    const ballVisible = handlers.isVisibleBall()
    const bannerVisible = handlers.isBannerVisible()
    const bossHidden = handlers.isBossHidden()
    const menu = Menu.buildFromTemplate([
      { label: '打开设置', click: () => handlers.onOpenSettings() },
      { type: 'separator' },
      {
        label: bossHidden ? '恢复显示横幅与悬浮球' : '一键隐藏横幅与悬浮球',
        click: () => handlers.onToggleBoss()
      },
      { type: 'separator' },
      {
        label: ballVisible ? '隐藏悬浮球' : '显示悬浮球',
        click: () => handlers.onToggleBall(!ballVisible)
      },
      {
        label: bannerVisible ? '隐藏底部横幅' : '显示底部横幅',
        click: () => handlers.onToggleBanner(!bannerVisible)
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => handlers.onQuit()
      }
    ])
    tray?.setContextMenu(menu)
  }

  trayMenuRebuild = rebuild
  rebuild()
  tray.on('right-click', rebuild)
  tray.on('click', () => handlers.onOpenSettings())

  app.on('before-quit', () => {
    destroyTray()
  })
}

export function refreshTrayMenu(): void {
  trayMenuRebuild?.()
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
  trayMenuRebuild = null
}
