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

export default function AppLayout() {
  const { can } = usePermission()
  const canUseGlobalTools = can(PERMISSIONS.DASHBOARD_VIEW)

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {/*
        顶栏两行：① Logo + TopNav（系统菜单）+ 工具区 ② 工作区标签（独占一行，避免与菜单挤在同一行）
      */}
      <header className="flex shrink-0 flex-col border-b border-border bg-background">
        <div className="flex h-12 shrink-0 items-center gap-2 px-3">
          <div className="flex shrink-0 items-center gap-2 pr-1">
            {/* 公司 Logo：有 Logo 只显示图片（右侧不再跟「极序 Flow」文字）；未上传时回退纯文字 */}
            <BrandLogo
              imgClassName="h-6 max-w-24"
              text="极序 Flow"
              textClassName="text-base font-bold tracking-tight text-foreground"
              alt="极序 Flow"
            />
          </div>

          <div className="min-w-0 flex-1">
            <TopNav />
          </div>

          <div className="flex shrink-0 items-center gap-2 border-l border-border pl-3">
            {canUseGlobalTools ? <GlobalSearch /> : null}
            {canUseGlobalTools ? <NotificationBell /> : null}
            <UserMenu />
          </div>
        </div>

        <div className="flex min-h-9 w-full min-w-0 items-center border-t border-border/60 bg-muted/20 px-2 py-0.5">
          <WorkspaceTabs />
        </div>
      </header>

      <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <TabErrorBoundary>
          <KeepAliveOutlet />
        </TabErrorBoundary>
      </main>

      <DirtyGuardDialog />
      <GlobalConfirmDialog />
      <AppToast />
    </div>
  )
}
