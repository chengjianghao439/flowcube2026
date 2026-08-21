/**
 * React Query client 单例。
 *
 * 2026-08-21 审计 C.1 修复：登出（performSessionLogout）必须清缓存，否则切换
 * 账号会短暂看到上一账号数据（staleTime 5min + keepAlive 组件不卸载）。
 * 单例导出让 main.tsx 与 authSession.ts 共用同一实例。
 */
import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
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
