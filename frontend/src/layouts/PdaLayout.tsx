/**
 * PdaLayout — PDA 独立子系统布局
 * 继承 极序 Flow 设计系统（bg-background / text-foreground）
 *
 * 浏览器共用路由时锁定：防止「返回」跳出 /pda/* 到 ERP 后台页面。
 * 独立 Android 应用由 PdaHardwareBack 接管实体返回键，不插入占位历史。
 * 逻辑：
 *   1. 进入 PDA 时 pushState 占位，使浏览器回退栈不为空
 *   2. 监听 popstate；若目标路径不在 /pda，强制 replace 到 /pda
 *   3. PDA 内部页面之间的 navigate() 不受影响
 */
import { useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
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

  // ── viewport meta 动态修正，保留用户放大页面的能力 ────────────
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
      'viewport-fit=cover',   // 覆盖刘海屏 / 打孔屏安全区
    ].join(', ')
  }, [])

  // ── 路由锁定（返回键不跳出 PDA）──────────────────────────────────────
  useEffect(() => {
    if (Capacitor.isNativePlatform()) return
    window.history.pushState(null, '', window.location.href)

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
  }, [location.pathname, navigate])

  useEffect(() => {
    const onManualCheck = () => { void checkUpdate({ manual: true }) }
    window.addEventListener('pda:check-update', onManualCheck as EventListener)
    return () => window.removeEventListener('pda:check-update', onManualCheck as EventListener)
  }, [checkUpdate])

  return (
    <>
      {/*
        pda-root：
        - min-h-[100dvh]  保持至少一屏高，内容超出时允许整页下滑
        - overflow-y-auto  避免工作台 / 列表页被外层容器裁掉
        - touch-action: manipulation 加快点击响应，消除 300ms 延迟
      */}
      <div
        className="pda-root flex min-h-[100dvh] flex-col overflow-x-hidden overflow-y-auto bg-background text-foreground antialiased"
        style={{
          WebkitTapHighlightColor: 'transparent',
          touchAction: 'manipulation',
          paddingTop: 'var(--pda-padding-top)',
          paddingBottom: 'var(--pda-padding-bottom)',
          paddingLeft: 'env(safe-area-inset-left)',
          paddingRight: 'env(safe-area-inset-right)',
        }}
      >
        <PdaNetworkBar />
        <PdaErrorBoundary>
          <Outlet />
        </PdaErrorBoundary>
      </div>
      <AppToast placement="pda" />
      {newVersion && <PdaUpdateDialog version={newVersion} onDismiss={dismiss} />}
    </>
  )
}
