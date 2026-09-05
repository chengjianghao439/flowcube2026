import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { HashRouter, Routes, Route, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import AppLayout from '@/layouts/AppLayout'
import PdaConnectionGate from '@/components/pda/PdaConnectionGate'
import ErpDesktopConnectionGate from '@/components/erp/ErpDesktopConnectionGate'
import { DesktopUpdateBridge } from '@/components/desktop/DesktopUpdateBridge'
import { DesktopQuitUnloadBridge } from '@/components/desktop/DesktopQuitUnloadBridge'
import DesktopPrintClientBridge from '@/components/desktop/DesktopPrintClientBridge'

import { pdaRoutes } from './pdaRoutes'

// ── 后台系统页面 ──────────────────────────────────────────────────────────────
const LoginPage       = lazy(() => import('@/pages/login'))
const ForbiddenPage   = lazy(() => import('@/pages/403'))
const LandingPage     = lazy(() => import('@/pages/landing'))

function PageLoader() {
  return (
    <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
      <svg className="mr-2 h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      加载中…
    </div>
  )
}

function isPdaPath(pathname: string) {
  return pathname === '/pda' || pathname.startsWith('/pda/')
}

function CrossClientNavigationGuard() {
  const location = useLocation()
  const navigate = useNavigate()
  const previous = useRef<string | null>(null)

  useEffect(() => {
    const current = `${location.pathname}${location.search}`
    const prev = previous.current

    if (prev && isPdaPath(prev) !== isPdaPath(location.pathname)) {
      navigate(prev, { replace: true })
      return
    }

    previous.current = current
  }, [location.pathname, location.search, navigate])

  return null
}

/** ERP 已登录守卫：未登录跳 /login，并携带原路径供登录后回跳（landing 卡片点击等场景） */
function ErpProtectedRoute() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const location = useLocation()
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location }} />
  return <Outlet />
}

/** ERP 游客守卫：已登录跳回受保护页（无来源则 /dashboard） */
function ErpGuestRoute() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const location = useLocation()
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname
  if (isAuthenticated) return <Navigate to={from || '/dashboard'} replace />
  return <Outlet />
}

/**
 * 官网宣传页守卫：仅「纯域名根路径访问」（window.location.hash 为空串）渲染 LandingPage。
 * - 浏览器访问 https://jixuflow.com（无 hash）→ 宣传页
 * - 点「进入系统」→ hash 变为 #/login，自动切到系统
 * - 桌面端加载 file://...#/（hash='#/'）→ 非空，跳过，直达系统
 * - 带路径访问 / 已登录 → 非空 hash，跳过
 */
function LandingGate() {
  const [showLanding, setShowLanding] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.location.hash === '' && window.location.protocol !== 'file:'
  })

  useEffect(() => {
    const onHash = () => {
      setShowLanding(window.location.hash === '' && window.location.protocol !== 'file:')
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  if (showLanding) return <LandingPage />
  return <Navigate to="/login" replace />
}

export default function AppRouter() {
  return (
    <HashRouter>
      <CrossClientNavigationGuard />
      <PdaConnectionGate>
        {/*
          桌面：beforeunload 闸门必须挂在 ErpDesktopConnectionGate 之外。
        */}
        <DesktopQuitUnloadBridge />
        <DesktopUpdateBridge />
        <DesktopPrintClientBridge />
        <ErpDesktopConnectionGate>
        <Suspense fallback={<PageLoader />}>
          <Routes>
          {/* ── 官网宣传页（纯域名根路径，hash 为空时命中）── */}
          <Route path="/" element={<LandingGate />} />

          {/* ── ERP 游客路由 ── */}
          <Route element={<ErpGuestRoute />}>
            <Route path="/login" element={<LoginPage />} />
          </Route>

          {pdaRoutes()}

          {/* ── ERP 已登录路由 ── */}
          <Route element={<ErpProtectedRoute />}>
            <Route path="/sales" element={<Navigate to="/sale" replace />} />
            {/* 应付/应收、供应商/客户对账原本各是一个页面的两个 tab，拆开后旧链接与旧工作区标签仍要能打开 */}
            <Route path="/payments" element={<Navigate to="/payments/payable" replace />} />
            <Route path="/reports/reconciliation" element={<Navigate to="/reports/reconciliation/payable" replace />} />
            <Route path="/*" element={<AppLayout />} />
          </Route>

          <Route path="/403" element={<ForbiddenPage />} />
          <Route path="*"    element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
        </ErpDesktopConnectionGate>
      </PdaConnectionGate>
    </HashRouter>
  )
}
