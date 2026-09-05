import { Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'

/** PDA 已登录守卫：未登录跳 /pda/login */
export function PdaProtectedRoute() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  if (!isAuthenticated) return <Navigate to="/pda/login" replace />
  return <Outlet />
}

/** PDA 游客守卫：已登录跳 /pda */
export function PdaGuestRoute() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  if (isAuthenticated) return <Navigate to="/pda" replace />
  return <Outlet />
}
