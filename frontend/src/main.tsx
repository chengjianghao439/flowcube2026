import { StrictMode } from 'react'
import './index.css'
import { Capacitor } from '@capacitor/core'
import { applyPdaApiBaseFromStorage, installPdaGlobals } from '@/lib/pdaRuntime'
import { initDeviceBinding } from '@/lib/pdaDeviceBinding'
import { applyErpApiBaseFromStorage } from '@/lib/apiOrigin'
import { bootstrapErpApiConnection } from '@/lib/erpApiBootstrap'
import { IS_CAPACITOR_PDA } from '@/lib/platform'

async function loadPlatformPolyfills(): Promise<void> {
  if (!IS_CAPACITOR_PDA) return
  await Promise.all([
    import('core-js/stable'),
    import('regenerator-runtime/runtime'),
  ])
}

// ── Capacitor PDA：API 基址（bundled）、ZPL 打印桥、路由入口 ─────────────────
async function boot(): Promise<void> {
  // PDA 判据：真机（Capacitor 原生 WebView）或 dev:pda / build:pda（VITE_CAPACITOR=1）。
  // 仅靠 Capacitor.isNativePlatform() 会漏掉浏览器里的 dev:pda——Vite 在浏览器跑时
  // 该函数返回 false，导致启动停在 ERP 首页（#/）而不是 #/pda，也就是「点启动 PDA 打开的是系统前端」。
  const isPdaBuild = IS_CAPACITOR_PDA
  const isNative = Capacitor.isNativePlatform()
  if (isNative) {
    applyPdaApiBaseFromStorage()
    installPdaGlobals()
  }
  if (isPdaBuild || isNative) {
    // 原生读取加密存储，浏览器 PDA 初始化内存存储；两者都必须完成水合，
    // 否则 getter 一直返回 null，浏览器绑定页保存凭据后也无法发起换票。
    await initDeviceBinding()
    const inHash = (window.location.hash.replace(/^#/, '').split('?')[0] || '/').trim()
    if (!inHash.startsWith('/pda')) {
      const prefix = window.location.href.split('#')[0]
      window.location.replace(`${prefix}#/pda`)
    }
    return
  }
  applyErpApiBaseFromStorage()
  await bootstrapErpApiConnection()
}

// ── 全局未捕获 Promise 错误监听 ──────────────────────────────────────────────
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  console.error(
    '[UnhandledRejection] 未捕获的 Promise 错误:',
    reason instanceof Error ? reason.message : reason,
    reason
  )
  // 防止某些场景下浏览器控制台输出重复
  event.preventDefault()
})

// ── 渲染入口（PDA 先加载 polyfill；ERP 先静默探测 API，再挂载）──────────────
const rootEl = document.getElementById('root')!
void (async () => {
  await loadPlatformPolyfills()
  const [
    reactDom,
    reactQuery,
    routerModule,
    errorBoundaryModule,
  ] = await Promise.all([
    import('react-dom/client'),
    import('@tanstack/react-query'),
    import.meta.env.VITE_CAPACITOR === '1' ? import('./router/pda') : import('./router'),
    import('@/components/GlobalErrorBoundary'),
  ])

  const { createRoot } = reactDom
  const { QueryClientProvider } = reactQuery
  const AppRouter = routerModule.default
  const { GlobalErrorBoundary } = errorBoundaryModule
  // 单例 queryClient（lib/queryClient.ts）：登出时 performSessionLogout 需要 clear()
  // 清掉上一账号的查询缓存（2026-08-21 审计 C.1 修复）
  const { queryClient } = await import('@/lib/queryClient')

  await boot()

  // 错误追踪初始化（P2-12）：配置 VITE_SENTRY_DSN 时启用 Sentry；否则 GlobalErrorBoundary 退回 Loki 上报
  const sentryDsn = (import.meta.env.VITE_SENTRY_DSN as string | undefined) || ''
  if (sentryDsn) {
    const Sentry = await import('@sentry/react')
    Sentry.init({
      dsn: sentryDsn,
      environment: import.meta.env.PROD ? 'production' : 'development',
      release: (import.meta.env.VITE_APP_VERSION as string | undefined) || undefined,
      integrations: [
        Sentry.browserTracingIntegration(),
        Sentry.replayIntegration(),
      ],
      tracesSampleRate: 0.1,
      // 不上报用户输入（避免敏感数据进 Sentry）
      beforeSend: (event) => {
        if (event.request?.data) event.request.data = undefined
        return event
      },
    })
  }

  createRoot(rootEl).render(
    <StrictMode>
      <GlobalErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <AppRouter />
        </QueryClientProvider>
      </GlobalErrorBoundary>
    </StrictMode>,
  )
})()
