import path from 'path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage } from 'node:http'
import type { ClientRequest } from 'node:http'
import { defineConfig } from 'vite'
import type { ProxyOptions } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(path.join(__dirname, 'package.json'), 'utf-8')) as {
  version: string
}
import react from '@vitejs/plugin-react'
import legacy from '@vitejs/plugin-legacy'

const isCapacitorBundle = process.env.VITE_CAPACITOR === '1'
const isElectronBundle = process.env.VITE_ELECTRON === '1'
const isPDA = process.env.BUILD_TARGET === 'pda' || isCapacitorBundle

/**
 * 局域网只暴露 5173 时：把 Vite 开发服收到的 Host（如 192.168.x.x:5173）转发给后端，
 * 否则 app-update 会拼出 http://localhost:3000/downloads/…，其它机器去连自己的 localhost 会失败。
 */
function devProxyToBackend(target: string): ProxyOptions {
  return {
    target,
    changeOrigin: true,
    configure(proxy) {
      proxy.on('proxyReq', (proxyReq: ClientRequest, req: IncomingMessage) => {
        const host = req.headers.host
        if (host) {
          proxyReq.setHeader('x-forwarded-host', host)
          proxyReq.setHeader('x-forwarded-proto', 'http')
        }
      })
    },
  }
}

/** Electron 安装包版本以 desktop/package.json 为准，避免界面仍显示 frontend 旧号 */
function resolveInjectedAppVersion(): string {
  if (isElectronBundle) {
    try {
      const desktopPkg = JSON.parse(
        readFileSync(path.join(__dirname, '../desktop/package.json'), 'utf-8'),
      ) as { version?: string }
      const v = desktopPkg.version?.trim()
      if (v) return v
    } catch {
      /* 回退到 frontend */
    }
  }
  return pkg.version
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(resolveInjectedAppVersion()),
  },
  // Capacitor / Electron 本地文件加载时需相对资源路径
  base: isCapacitorBundle || isElectronBundle ? './' : '/',
  plugins: [
    react(),
    // 主交付为 Electron / PDA；不再生成 PWA Service Worker 与 Web 安装 manifest
    // PDA 打包时生成 ES5 兼容代码，支持 Android 5.x WebView
    isPDA && legacy({
      targets: ['Android >= 5'],
      additionalLegacyPolyfills: ['regenerator-runtime/runtime'],
      modernPolyfills: true,
    }),
  ].filter(Boolean),
  build: {
    // PDA 模式目标 ES2015，确保旧设备兼容
    target: isPDA ? 'es2015' : 'modules',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': devProxyToBackend('http://localhost:3000'),
      // 安装包由后端 /downloads 提供；经此处代理后，与 /api 共用「单一入口」5173
      '/downloads': devProxyToBackend('http://localhost:3000'),
    },
  },
  preview: {
    port: 4173,
    host: true,
    proxy: {
      '/api': devProxyToBackend('http://localhost:3000'),
      '/downloads': devProxyToBackend('http://localhost:3000'),
    },
  },
})
