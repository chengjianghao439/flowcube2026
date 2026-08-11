import { useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { loginApi, type LoginParams } from '@/api/auth'
import { useAuthStore } from '@/store/authStore'
import { persistErpApiBaseAfterLogin } from '@/config/api'
import { applyErpApiBaseFromStorage } from '@/lib/apiOrigin'
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
      applyErpApiBaseFromStorage()
      useWorkspaceStore.getState().closeAll()
      login(data.token, data.user)
      await syncPdaLabelPrinterBinding().catch(() => null)
      // PDA 端登录后立刻用本机设备凭据换一张设备票据；没绑定过设备就跳过，
      // 由后端的观察/强制模式决定后续作业是否放行，不在这里打断登录
      if (redirectTo.startsWith('/pda')) {
        await ensureDeviceSession().catch(() => null)
      }
      persistLoginSuccess(variables.username)
      navigate(redirectTo, { replace: true })
    },
  })
}

