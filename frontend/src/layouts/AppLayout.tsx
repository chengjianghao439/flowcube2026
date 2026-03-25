import { KeepAliveOutlet } from '@/components/layout/KeepAliveOutlet'
import { TopNav } from '@/components/layout/TopNav'
import { WorkspaceTabs } from '@/components/layout/WorkspaceTabs'
import { DirtyGuardDialog } from '@/components/shared/DirtyGuardDialog'
import { AppToast } from '@/components/shared/AppToast'
import { GlobalConfirmDialog } from '@/components/shared/GlobalConfirmDialog'
import NotificationBell from '@/components/shared/NotificationBell'
import GlobalSearch from '@/components/shared/GlobalSearch'
import UserMenu from '@/components/shared/UserMenu'

export default function AppLayout() {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {/*
        顶栏：Logo + 水平 TopNav + 工作区标签 + 工具区（现代 SaaS）
      */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-3">
        <div className="flex shrink-0 items-center pr-2">
          <span className="text-base font-bold tracking-tight text-foreground">
            FlowCube ERP
          </span>
        </div>

        <TopNav />

        <div className="flex min-w-0 flex-1 items-center self-stretch px-1">
          <WorkspaceTabs />
        </div>

        <div className="flex shrink-0 items-center gap-2 border-l border-border pl-3">
          <GlobalSearch />
          <NotificationBell />
          <UserMenu />
        </div>
      </header>

      <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <KeepAliveOutlet />
      </main>

      <DirtyGuardDialog />
      <GlobalConfirmDialog />
      <AppToast />
    </div>
  )
}
