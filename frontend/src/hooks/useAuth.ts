import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { loginApi, getMeApi, type LoginParams } from '@/api/auth'
import { useAuthStore } from '@/store/authStore'
import { persistErpApiBaseAfterLogin } from '@/config/api'
import { applyErpApiBaseFromStorage } from '@/lib/apiOrigin'
import { persistLoginSuccess } from '@/lib/loginCredentials'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { syncPdaLabelPrinterBinding } from '@/lib/pdaRuntime'

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
      persistLoginSuccess(variables.username)
      navigate(redirectTo, { replace: true })
    },
  })
}

export function useGetMe() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  return useQuery({
    queryKey: ['auth', 'me'],
    queryFn: getMeApi,
    enabled: isAuthenticated,
    staleTime: 1000 * 60 * 10,
  })
}
