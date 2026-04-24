/**
 * PdaLayout — PDA 独立子系统布局
 * 继承 FlowCube 设计系统（bg-background / text-foreground）
 *
 * 路由锁定：防止浏览器「返回」跳出 /pda/* 到 ERP 后台页面。
 * 逻辑：
 *   1. 进入 PDA 时 pushState 占位，使浏览器回退栈不为空
 *   2. 监听 popstate；若目标路径不在 /pda，强制 replace 到 /pda
 *   3. PDA 内部页面之间的 navigate() 不受影响
 */
import { useEffect } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { AppToast } from '@/components/shared/AppToast'
import { usePdaUpdate } from '@/hooks/usePdaUpdate'
import PdaUpdateDialog from '@/components/pda/PdaUpdateDialog'
import PdaNetworkBar from '@/components/pda/PdaNetworkBar'
import PdaErrorBoundary from '@/components/pda/PdaErrorBoundary'
import { getHashRouterWindowLocation } from '@/router/hashLocation'

export default function PdaLayout() {
  const location = useLocation()
  const navigate  = useNavigate()
  const { newVersion, dismiss, checkUpdate } = usePdaUpdate()
  const isPdaRoot = location.pathname === '/pda' || location.pathname === '/pda/'

  // ── viewport meta 动态修正（禁止缩放，防止扫码后页面跳动）────────────
  useEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]') as HTMLMetaElement
      || (() => {
        const m = document.createElement('meta')
        m.name = 'viewport'
        document.head.appendChild(m)
        return m
      })()
    meta.content = [
      'width=device-width',
      'initial-scale=1.0',
      'maximum-scale=1.0',
      'minimum-scale=1.0',
      'user-scalable=no',
      'viewport-fit=cover',   // 覆盖刘海屏 / 打孔屏安全区
    ].join(', ')
  }, [])

  // ── 路由锁定（返回键不跳出 PDA）──────────────────────────────────────
  useEffect(() => {
    window.history.pushState(null, '', location.href)

    const handleBack = () => {
      const target = getHashRouterWindowLocation()
      if (!target.pathname.startsWith('/pda')) {
        navigate('/pda', { replace: true })
      } else {
        window.history.pushState(null, '', window.location.href)
      }
    }

    window.addEventListener('popstate', handleBack)
    return () => window.removeEventListener('popstate', handleBack)
  }, [location.pathname])

  useEffect(() => {
    const onManualCheck = () => { void checkUpdate({ manual: true }) }
    window.addEventListener('pda:check-update', onManualCheck as EventListener)
    return () => window.removeEventListener('pda:check-update', onManualCheck as EventListener)
  }, [checkUpdate])

  useEffect(() => {
    let disposed = false
    let removeListener: (() => void) | undefined

    void CapacitorApp.addListener('backButton', async ({ canGoBack }) => {
      if (disposed) return
      if (!location.pathname.startsWith('/pda')) {
        navigate('/pda', { replace: true })
        return
      }
      if (!isPdaRoot) {
        if (canGoBack) navigate(-1)
        else navigate('/pda', { replace: true })
        return
      }
      await CapacitorApp.minimizeApp()
    }).then(handle => {
      removeListener = () => {
        void handle.remove()
      }
    })

    return () => {
      disposed = true
      removeListener?.()
    }
  }, [isPdaRoot, location.pathname, navigate])

  return (
    <>
      {/*
        pda-root：
        - min-h-[100dvh]  保持至少一屏高，内容超出时允许整页下滑
        - overflow-y-auto  避免工作台 / 列表页被外层容器裁掉
        - touch-action: manipulation 加快点击响应，消除 300ms 延迟
      */}
      <div
        className="flex min-h-[100dvh] flex-col overflow-x-hidden overflow-y-auto bg-background text-foreground antialiased"
        style={{
          WebkitTapHighlightColor: 'transparent',
          touchAction: 'manipulation',
          paddingTop: 'max(env(safe-area-inset-top), 12px)',
          paddingBottom: 'max(env(safe-area-inset-bottom), 12px)',
          paddingLeft: 'env(safe-area-inset-left)',
          paddingRight: 'env(safe-area-inset-right)',
        }}
      >
        <PdaNetworkBar />
        <PdaErrorBoundary>
          <Outlet />
        </PdaErrorBoundary>
      </div>
      <AppToast />
      {newVersion && <PdaUpdateDialog version={newVersion} onDismiss={dismiss} />}
    </>
  )
}
