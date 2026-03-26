import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { loginApi, getMeApi, type LoginParams } from '@/api/auth'
import { useAuthStore } from '@/store/authStore'
import { persistErpApiBaseAfterLogin } from '@/config/api'
import { applyErpApiBaseFromStorage } from '@/lib/apiOrigin'

type LoginWithRemember = LoginParams & { remember?: boolean }

export function useLogin(redirectTo = '/dashboard') {
  const { login } = useAuthStore()
  const navigate = useNavigate()

  return useMutation({
    mutationFn: ({ username, password }: LoginWithRemember) =>
      loginApi({ username, password }),
    onSuccess: (data, variables) => {
      persistErpApiBaseAfterLogin()
      applyErpApiBaseFromStorage()
      login(data.token, data.user, variables.remember ?? false)
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
