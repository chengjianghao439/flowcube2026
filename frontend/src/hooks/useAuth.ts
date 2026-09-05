import { useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { loginApi, type LoginParams } from '@/api/auth'
import { useAuthStore } from '@/store/authStore'
import { persistErpApiBaseAfterLogin } from '@/config/api'
import { applyErpApiBaseFromStorage } from '@/lib/apiOrigin'
import { IS_CAPACITOR_PDA } from '@/lib/platform'
import { persistLoginSuccess } from '@/lib/loginCredentials'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { syncPdaLabelPrinterBinding } from '@/lib/pdaRuntime'
import { ensureDeviceSession } from '@/api/pda-session'

export type LoginMutationVars = LoginParams

export function useLogin(redirectTo = '/dashboard') {
  const { login } = useAuthStore()
  const navigate = useNavigate()

  return useMutation({
    mutationFn: ({ username, password }: LoginMutationVars) =>
      loginApi({ username, password }),
    onSuccess: async (data, variables) => {
      persistErpApiBaseAfterLogin()
      // 【PDA baseURL 覆盖 bug 2026-08-28】applyErpApiBaseFromStorage 只适用于
      // ERP/桌面（file:// 或浏览器同源），不适用独立 PDA——Capacitor WebView 的
      // origin 是 https://localhost，getEffectiveApiOrigin() 返回 null 时它会把
      // apiClient.baseURL 重置回相对 /api，导致登录后所有 axios 请求发到
      // localhost/api（真机无服务）而失败：登录能通（baseURL 尚为生产）、
      // ensureDeviceSession/todo-counts 全挂——呈现为「扫码后密钥失效」。
      // PDA 的 API 基址由 pdaRuntime 统一管理（boot 时 applyPdaApiBaseFromStorage
      // 已设好绝对地址），登录后不得再覆盖。
      if (!IS_CAPACITOR_PDA) {
        applyErpApiBaseFromStorage()
      }
      useWorkspaceStore.getState().closeAll()
      // refreshToken（2026-08-21 权衡修复）：access 2h 过期后自动换新
      login(data.token, data.refreshToken ?? null, data.user)
      const sessionGeneration = useAuthStore.getState().sessionGeneration
      await syncPdaLabelPrinterBinding().catch(() => null)
      if (useAuthStore.getState().sessionGeneration !== sessionGeneration) return
      // PDA 端登录后立刻用本机设备凭据换一张设备票据；没绑定过设备就跳过，
      // 由后端的观察/强制模式决定后续作业是否放行，不在这里打断登录
      if (redirectTo.startsWith('/pda')) {
        await ensureDeviceSession().catch(() => null)
        if (useAuthStore.getState().sessionGeneration !== sessionGeneration) return
      }
      persistLoginSuccess(variables.username)
      navigate(redirectTo, { replace: true })
    },
  })
}

