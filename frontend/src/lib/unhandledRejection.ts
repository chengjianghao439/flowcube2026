import apiClient from '@/api/client'
import { useAuthStore } from '@/store/authStore'

/** Sentry 已安装默认 Promise 捕获；无 DSN 时复用经过认证的后端错误入口。 */
export function installUnhandledRejectionReporting(sentryEnabled: boolean) {
  const handler = (event: PromiseRejectionEvent) => {
    // reason 可能是包含请求体、认证头或客户资料的任意对象，日志也不展开它。
    console.error('[UnhandledRejection] 未捕获的 Promise 错误')
    if (sentryEnabled) return
    event.preventDefault()
    try {
      if (!useAuthStore.getState().token) return
      void apiClient.post('/system/error-report', {
        message: 'Unhandled Promise rejection',
        stack: '',
        componentStack: '',
        url: window.location.origin,
      }, { skipGlobalError: true }).catch(() => { /* 上报失败不产生递归拒绝。 */ })
    } catch { /* 同步上报错误同样不影响页面。 */ }
  }
  window.addEventListener('unhandledrejection', handler)
  return () => window.removeEventListener('unhandledrejection', handler)
}
