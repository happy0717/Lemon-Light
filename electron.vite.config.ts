import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['electron'],
        input: { index: resolve(__dirname, 'electron/main/index.ts') }
      }
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'electron/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['electron'],
        input: { index: resolve(__dirname, 'electron/preload/index.ts') }
      }
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'electron/shared')
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src'),
    plugins: [vue()],
    build: {
      rollupOptions: {
        input: [
          resolve(__dirname, 'src/floating-ball/index.html'),
          resolve(__dirname, 'src/bottom-banner/index.html'),
          resolve(__dirname, 'src/settings/index.html')
        ]
      }
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        '@shared': resolve(__dirname, 'electron/shared')
      }
    }
  }
})
