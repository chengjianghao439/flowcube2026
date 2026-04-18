import { StrictMode } from 'react'
import './index.css'
import { Capacitor } from '@capacitor/core'
import { applyPdaApiBaseFromStorage, installPdaGlobals } from '@/lib/pdaRuntime'
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
  if (Capacitor.isNativePlatform()) {
    applyPdaApiBaseFromStorage()
    installPdaGlobals()
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
    import('./router'),
    import('@/components/GlobalErrorBoundary'),
  ])

  const { createRoot } = reactDom
  const { QueryClient, QueryClientProvider } = reactQuery
  const AppRouter = routerModule.default
  const { GlobalErrorBoundary } = errorBoundaryModule
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 1000 * 60 * 5,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
      },
      mutations: {
        retry: 0,
      },
    },
  })

  await boot()

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
