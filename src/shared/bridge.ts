import type { LemonLightApi } from '../../electron/preload/index'

declare global {
  interface Window {
    lemonLight: LemonLightApi
  }
}

export const bridge: LemonLightApi = window.lemonLight
