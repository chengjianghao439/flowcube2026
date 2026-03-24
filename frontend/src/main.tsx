// Polyfills for Android 5.x WebView compatibility
import 'core-js/stable'
import 'regenerator-runtime/runtime'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { GlobalErrorBoundary } from '@/components/GlobalErrorBoundary'
import './index.css'
import AppRouter from './router'

// ── Capacitor PDA 启动检测：App 内自动跳转 /pda ──────────────────────────────
// 通过检测 window.Capacitor 判断是否在原生 App 壳内运行
if ((window as any).Capacitor?.isNativePlatform?.()) {
  // 如果当前路径不是 /pda 开头，强制跳转
  if (!window.location.pathname.startsWith('/pda')) {
    window.location.replace('/pda')
  }
}

// ── React Query 默认配置 ──────────────────────────────────────────────────────
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      // 5 分钟内不重新请求，减少多标签场景下的重复网络请求
      staleTime: 1000 * 60 * 5,
      // 窗口重新获得焦点时不自动刷新（在多标签工作区中会造成大量重复请求）
      refetchOnWindowFocus: false,
      // 网络恢复时自动重新请求（合理）
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 0,  // mutation 默认不重试，避免重复写操作
    },
  },
})

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

// ── 渲染入口 ─────────────────────────────────────────────────────────────────
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GlobalErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AppRouter />
      </QueryClientProvider>
    </GlobalErrorBoundary>
  </StrictMode>,
)
