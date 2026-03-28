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
        顶栏两行：① Logo + TopNav（系统菜单）+ 工具区 ② 工作区标签（独占一行，避免与菜单挤在同一行）
      */}
      <header className="flex shrink-0 flex-col border-b border-border bg-background">
        <div className="flex h-12 shrink-0 items-center gap-2 px-3">
          <div className="flex shrink-0 items-center pr-1">
            <span className="text-base font-bold tracking-tight text-foreground">
              极序 Flow
            </span>
          </div>

          <div className="min-w-0 flex-1">
            <TopNav />
          </div>

          <div className="flex shrink-0 items-center gap-2 border-l border-border pl-3">
            <GlobalSearch />
            <NotificationBell />
            <UserMenu />
          </div>
        </div>

        <div className="flex min-h-9 w-full min-w-0 items-center border-t border-border/60 bg-muted/20 px-2 py-0.5">
          <WorkspaceTabs />
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
