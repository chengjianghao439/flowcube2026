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

/** dev / preview 下 /api 的代理目标；DEV_API_TARGET 可指向生产（见 .claude/launch.json）。 */
const DEV_API_TARGET = process.env.DEV_API_TARGET || 'http://localhost:3000'

/**
 * dev server 背后是不是本地后端。
 * 前端代码里 baseURL 恒为 '/api'（同源，由 Vite 代理转发），浏览器侧无从分辨背后连的是
 * localhost 还是生产，所以把结论在构建期注入进去。
 * 唯一用途：决定登录态存 localStorage 还是 sessionStorage（见 src/store/authStore.ts）。
 */
function isLocalDevBackend(target: string): boolean {
  try {
    const host = new URL(target).hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '::1'
  } catch {
    return false
  }
}

/** 本地开发 API 代理：仅用于 Vite dev / preview 下的 /api 请求。 */
function devProxyToBackend(target: string): ProxyOptions {
  return {
    target,
    changeOrigin: true,
    secure: false, // 允许指向 HTTPS 后端（如生产 https://jixuflow.com）
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
function resolveInjectedAppVersion(isElectronBundle: boolean): string {
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

/**
 * 本地 dev 预览免登录 seed（仅 dev serve）。
 * 当环境变量 EXPOSE_DEV_AUTH_FILE 指向一个 zustand persist 信封 JSON 时，把它注入 index.html，
 * 让通过隧道访问的浏览器（localStorage 为空）自动带上 dev admin 会话，免去手动登录。
 * 严格 dev-only + 默认关闭（不设该 env 就完全无效）；生产 build 不受影响。
 * 安全：仅用于本机 dev 预览的临时展示，切勿在生产/公网长期开启。
 */
function devAuthSeedPlugin() {
  const file = process.env.EXPOSE_DEV_AUTH_FILE
  if (!file) return null
  let envelope = ''
  try { envelope = readFileSync(file, 'utf8').trim() } catch { return null }
  if (!envelope) return null
  return {
    name: 'flowcube-dev-auth-seed',
    apply: 'serve' as const,
    transformIndexHtml() {
      return [{
        tag: 'script',
        injectTo: 'head-prepend' as const,
        children: `try{var k='flowcube-auth-v3';if(!localStorage.getItem(k)){localStorage.setItem(k, ${JSON.stringify(envelope)});}}catch(e){}`,
      }]
    },
  }
}

export default defineConfig(({ command }) => {
  const isCapacitorBundle = process.env.VITE_CAPACITOR === '1'
  const isElectronBundle = process.env.VITE_ELECTRON === '1'
  const isPDA = process.env.BUILD_TARGET === 'pda' || isCapacitorBundle

  if (command === 'build' && !isCapacitorBundle && !isElectronBundle) {
    throw new Error(
      'FlowCube：已取消纯 Web ERP 产物。请使用 npm run build（桌面，VITE_ELECTRON=1）或 npm run build:pda（PDA，VITE_CAPACITOR=1）。',
    )
  }

  return {
    define: {
      __APP_VERSION__: JSON.stringify(resolveInjectedAppVersion(isElectronBundle)),
      // 构建产物恒为 false：只有本机 dev/preview 服务且后端也在本机时才为 true
      __DEV_LOCAL_BACKEND__: JSON.stringify(command === 'serve' && isLocalDevBackend(DEV_API_TARGET)),
    },
    // Capacitor / Electron 本地文件加载时需相对资源路径
    base: isCapacitorBundle || isElectronBundle ? './' : '/',
    plugins: [
      react(),
      isPDA &&
        legacy({
          targets: ['Android >= 5'],
          additionalLegacyPolyfills: ['regenerator-runtime/runtime'],
          modernPolyfills: true,
        }),
      devAuthSeedPlugin(),
    ].filter(Boolean),
    build: {
      target: isPDA ? 'es2015' : 'modules',
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return

            if (
              id.includes('/react/') ||
              id.includes('/react-dom/') ||
              id.includes('/scheduler/')
            ) {
              return 'vendor-react'
            }

            if (id.includes('/react-router') || id.includes('/@remix-run/')) {
              return 'vendor-router'
            }

            if (id.includes('/@tanstack/')) {
              return 'vendor-query'
            }

            if (id.includes('/@radix-ui/') || id.includes('/cmdk/')) {
              return 'vendor-ui'
            }

            if (id.includes('/recharts/') || id.includes('/d3-')) {
              return 'vendor-charts'
            }

            if (
              id.includes('/qrcode.react/') ||
              id.includes('/jsbarcode/')
            ) {
              return 'vendor-barcode'
            }

            if (
              id.includes('/axios/') ||
              id.includes('/zustand/') ||
              id.includes('/lucide-react/')
            ) {
              return 'vendor-core'
            }
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      // 端口允许被 PORT 覆盖：Claude Code 的 Browser 面板会分配一个空闲端口并以 PORT 传入，
      // 写死 5173 会让 vite 自行退到 5174 而面板仍指向分配端口，出现「预览页打不开」
      port: Number(process.env.PORT) || 5173,
      host: true,
      // 通过隧道(如 <port>-xxx.something.com)暴露给手机预览时需放开 Host 校验。
      // 默认不放开；仅当 VITE_ALLOW_ALL_HOSTS=1 时允许全部 Host（仅用于本机 dev 临时展示）。
      allowedHosts: process.env.VITE_ALLOW_ALL_HOSTS === '1' ? true : undefined,
      proxy: {
        '/api': devProxyToBackend(DEV_API_TARGET),
      },
    },
    preview: {
      port: 4173,
      host: true,
      proxy: {
        '/api': devProxyToBackend(DEV_API_TARGET),
      },
    },
  }
})
