import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import AppLayout from '@/layouts/AppLayout'
import PdaLayout from '@/layouts/PdaLayout'

// ── 后台系统页面 ──────────────────────────────────────────────────────────────
const LoginPage       = lazy(() => import('@/pages/login'))
const ForbiddenPage   = lazy(() => import('@/pages/403'))
const SortingBinsPage = lazy(() => import('@/pages/sorting-bins'))

// ── PDA 子系统页面 ────────────────────────────────────────────────────────────
const PdaLoginPage   = lazy(() => import('@/pages/pda/login'))
const PdaIndexPage   = lazy(() => import('@/pages/pda'))
const PdaPickingPage = lazy(() => import('@/pages/pda/picking'))
const PdaTaskPage    = lazy(() => import('@/pages/pda/task'))
const PdaInboundPage = lazy(() => import('@/pages/pda/inbound'))
const PdaReceivePage = lazy(() => import('@/pages/pda/receive'))
const PdaPutawayPage = lazy(() => import('@/pages/pda/putaway'))
const PdaCheckPage   = lazy(() => import('@/pages/pda/check'))
const PdaPackPage    = lazy(() => import('@/pages/pda/pack'))
const PdaShipPage    = lazy(() => import('@/pages/pda/ship'))
const PdaSortPage    = lazy(() => import('@/pages/pda/sort'))

function PageLoader() {
  return (
    <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
      <svg className="mr-2 h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      加载中...
    </div>
  )
}

/** ERP 已登录守卫：未登录跳 /login */
function ErpProtectedRoute() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <Outlet />
}

/** PDA 已登录守卫：未登录跳 /pda/login */
function PdaProtectedRoute() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  if (!isAuthenticated) return <Navigate to="/pda/login" replace />
  return <Outlet />
}

/** ERP 游客守卫：已登录跳 /dashboard */
function ErpGuestRoute() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  if (isAuthenticated) return <Navigate to="/dashboard" replace />
  return <Outlet />
}

/** PDA 游客守卫：已登录跳 /pda */
function PdaGuestRoute() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  if (isAuthenticated) return <Navigate to="/pda" replace />
  return <Outlet />
}

export default function AppRouter() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* ── ERP 游客路由 ── */}
          <Route element={<ErpGuestRoute />}>
            <Route path="/login" element={<LoginPage />} />
          </Route>

          {/* ── PDA 游客路由 ── */}
          <Route element={<PdaGuestRoute />}>
            <Route path="/pda/login" element={<PdaLoginPage />} />
          </Route>

          {/* ── PDA 已登录路由 ── */}
          <Route element={<PdaProtectedRoute />}>
            <Route element={<PdaLayout />}>
              <Route path="/pda"             element={<PdaIndexPage />} />
              <Route path="/pda/inbound"     element={<PdaInboundPage />} />
              <Route path="/pda/receive/:id" element={<PdaReceivePage />} />
              <Route path="/pda/putaway/:id" element={<PdaPutawayPage />} />
              <Route path="/pda/putaway"     element={<PdaPutawayPage />} />
              <Route path="/pda/picking"     element={<PdaPickingPage />} />
              <Route path="/pda/task/:id"    element={<PdaTaskPage />} />
              <Route path="/pda/check/:id"   element={<PdaCheckPage />} />
              <Route path="/pda/check"       element={<PdaCheckPage />} />
              <Route path="/pda/pack/:id"    element={<PdaPackPage />} />
              <Route path="/pda/pack"        element={<PdaPackPage />} />
              <Route path="/pda/ship/:id"    element={<PdaShipPage />} />
              <Route path="/pda/ship"        element={<PdaShipPage />} />
              <Route path="/pda/sort"        element={<PdaSortPage />} />
            </Route>
          </Route>

          {/* ── ERP 已登录路由 ── */}
          <Route element={<ErpProtectedRoute />}>
            <Route path="/*" element={<AppLayout />} />
          </Route>

          <Route path="/403" element={<ForbiddenPage />} />
          <Route path="*"    element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
