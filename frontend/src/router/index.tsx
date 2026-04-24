import { lazy, Suspense } from 'react'
import { HashRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import AppLayout from '@/layouts/AppLayout'
import PdaLayout from '@/layouts/PdaLayout'
import PdaConnectionGate from '@/components/pda/PdaConnectionGate'
import PdaRoutePermission from '@/components/pda/PdaRoutePermission'
import ErpDesktopConnectionGate from '@/components/erp/ErpDesktopConnectionGate'
import ErpApiBaseHotkeyDialog from '@/components/erp/ErpApiBaseHotkeyDialog'
import { DesktopQuitUnloadBridge } from '@/components/desktop/DesktopQuitUnloadBridge'
import DesktopPrintClientBridge from '@/components/desktop/DesktopPrintClientBridge'
import GlobalDesktopUpdateDialog from '@/components/desktop/GlobalDesktopUpdateDialog'
import { PERMISSIONS } from '@/lib/permission-codes'

// ── 后台系统页面 ──────────────────────────────────────────────────────────────
const LoginPage       = lazy(() => import('@/pages/login'))
const ForbiddenPage   = lazy(() => import('@/pages/403'))

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
const PdaSplitPage   = lazy(() => import('@/pages/pda/split'))
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
    <HashRouter>
      <GlobalDesktopUpdateDialog />
      <PdaConnectionGate>
        {/*
          桌面：beforeunload 闸门 / API 热键 必须挂在 ErpDesktopConnectionGate 之外。
        */}
        <DesktopQuitUnloadBridge />
        <DesktopPrintClientBridge />
        <ErpApiBaseHotkeyDialog />
        <ErpDesktopConnectionGate>
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

          {/*
            PDA 必须挂在 path="/pda" 树下（相对子路径），不能写一堆绝对路径 /pda/xxx 挂在无 path 的父级上，
            否则在部分 React Router 版本里会与 ERP 的 path="/*" 抢匹配，误入 AppLayout →「页面未注册」。
          */}
          <Route path="/pda" element={<PdaProtectedRoute />}>
            <Route element={<PdaLayout />}>
              <Route index element={<PdaIndexPage />} />
              <Route path="inbound" element={<PdaRoutePermission title="收货订单" required={[PERMISSIONS.INBOUND_ORDER_VIEW]}><PdaInboundPage /></PdaRoutePermission>} />
              <Route path="receive/:id" element={<PdaRoutePermission title="收货登记" required={[PERMISSIONS.INBOUND_ORDER_VIEW, PERMISSIONS.INBOUND_RECEIVE_EXECUTE]}><PdaReceivePage /></PdaRoutePermission>} />
              <Route path="putaway/:id" element={<PdaRoutePermission title="扫码上架" required={[PERMISSIONS.INBOUND_ORDER_VIEW, PERMISSIONS.INBOUND_PUTAWAY_EXECUTE]}><PdaPutawayPage /></PdaRoutePermission>} />
              <Route path="putaway" element={<PdaRoutePermission title="扫码上架" required={[PERMISSIONS.INBOUND_ORDER_VIEW, PERMISSIONS.INBOUND_PUTAWAY_EXECUTE]}><PdaPutawayPage /></PdaRoutePermission>} />
              <Route path="picking" element={<PdaRoutePermission title="拣货任务" required={[PERMISSIONS.WAREHOUSE_TASK_VIEW, PERMISSIONS.WAREHOUSE_TASK_PICK]}><PdaPickingPage /></PdaRoutePermission>} />
              <Route path="task/:id" element={<PdaRoutePermission title="扫码拣货" required={[PERMISSIONS.WAREHOUSE_TASK_VIEW, PERMISSIONS.WAREHOUSE_TASK_PICK]}><PdaTaskPage /></PdaRoutePermission>} />
              <Route path="check/:id" element={<PdaRoutePermission title="复核作业" required={[PERMISSIONS.WAREHOUSE_TASK_VIEW, PERMISSIONS.WAREHOUSE_TASK_CHECK]}><PdaCheckPage /></PdaRoutePermission>} />
              <Route path="check" element={<PdaRoutePermission title="复核作业" required={[PERMISSIONS.WAREHOUSE_TASK_VIEW, PERMISSIONS.WAREHOUSE_TASK_CHECK]}><PdaCheckPage /></PdaRoutePermission>} />
              <Route path="pack/:id" element={<PdaRoutePermission title="打包作业" required={[PERMISSIONS.WAREHOUSE_TASK_VIEW, PERMISSIONS.WAREHOUSE_TASK_PACK]}><PdaPackPage /></PdaRoutePermission>} />
              <Route path="pack" element={<PdaRoutePermission title="打包作业" required={[PERMISSIONS.WAREHOUSE_TASK_VIEW, PERMISSIONS.WAREHOUSE_TASK_PACK]}><PdaPackPage /></PdaRoutePermission>} />
              <Route path="split" element={<PdaRoutePermission title="容器拆分" required={[PERMISSIONS.INVENTORY_CONTAINER_SPLIT]}><PdaSplitPage /></PdaRoutePermission>} />
              <Route path="ship/:id" element={<PdaRoutePermission title="出库确认" required={[PERMISSIONS.WAREHOUSE_TASK_SHIP]}><PdaShipPage /></PdaRoutePermission>} />
              <Route path="ship" element={<PdaRoutePermission title="出库确认" required={[PERMISSIONS.WAREHOUSE_TASK_SHIP]}><PdaShipPage /></PdaRoutePermission>} />
              <Route path="sort" element={<PdaRoutePermission title="分拣作业" required={[PERMISSIONS.SORTING_BIN_VIEW, PERMISSIONS.WAREHOUSE_TASK_SORT]}><PdaSortPage /></PdaRoutePermission>} />
            </Route>
          </Route>

          {/* ── ERP 已登录路由 ── */}
          <Route element={<ErpProtectedRoute />}>
            <Route path="/sales" element={<Navigate to="/sale" replace />} />
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
