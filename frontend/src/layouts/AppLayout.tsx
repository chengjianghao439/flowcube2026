import { KeepAliveOutlet } from '@/components/layout/KeepAliveOutlet'
import { TopNav } from '@/components/layout/TopNav'
import { WorkspaceTabs } from '@/components/layout/WorkspaceTabs'
import TabErrorBoundary from '@/components/shared/TabErrorBoundary'
import { DirtyGuardDialog } from '@/components/shared/DirtyGuardDialog'
import { AppToast } from '@/components/shared/AppToast'
import { GlobalConfirmDialog } from '@/components/shared/GlobalConfirmDialog'
import NotificationBell from '@/components/shared/NotificationBell'
import GlobalSearch from '@/components/shared/GlobalSearch'
import UserMenu from '@/components/shared/UserMenu'
import BrandLogo from '@/components/shared/BrandLogo'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import '@/styles/desktop-page-samples.css'

export default function AppLayout() {
  const { can } = usePermission()
  const canUseGlobalTools = can(PERMISSIONS.DASHBOARD_VIEW)

  return (
    <div className="desktop-shell-sample flex h-screen flex-col overflow-hidden bg-background">
      {/*
        电脑常用窗口首行排列 Logo、菜单和工具。较窄窗口允许菜单换行。工作区标签独占末行。
      */}
      <header className="flex shrink-0 flex-col border-b border-border bg-background">
        <div className="desktop-topbar flex min-h-12 shrink-0 flex-wrap items-center gap-2 px-3 py-1">
          <div className="flex shrink-0 items-center gap-2 pr-1">
            {/* 公司 Logo：有 Logo 只显示图片（右侧不再跟「极序 Flow」文字）；未上传时回退纯文字 */}
            <BrandLogo
              imgClassName="h-6 max-w-24"
              text="极序 Flow"
              textClassName="text-base font-bold tracking-tight text-foreground"
              alt="公司 Logo"
            />
          </div>

          <div className="desktop-nav order-last w-full min-w-0 lg:order-none lg:w-auto lg:flex-1">
            <TopNav />
          </div>

          <div className="desktop-tools ml-auto flex shrink-0 items-center gap-2 border-l border-border pl-3">
            {canUseGlobalTools ? <div className="desktop-search"><GlobalSearch /></div> : null}
            {canUseGlobalTools ? <NotificationBell /> : null}
            <UserMenu />
          </div>
        </div>

        <div className="desktop-tabs flex min-h-9 w-full min-w-0 items-center border-t border-border/60 bg-muted/20 px-2 py-0.5">
          <WorkspaceTabs />
        </div>
      </header>

      <div className="relative h-0 w-full shrink-0">
        <AppToast />
      </div>

      <main className="desktop-workspace min-h-0 min-w-0 flex-1 overflow-hidden">
        <TabErrorBoundary scope="workspace">
          <KeepAliveOutlet />
        </TabErrorBoundary>
      </main>

      <DirtyGuardDialog />
      <GlobalConfirmDialog />
    </div>
  )
}
