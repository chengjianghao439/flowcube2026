import { useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { usePermission } from '@/hooks/usePermission'
import { useWorkspaceStore, PATH_TITLES } from '@/store/workspaceStore'
import { useDirtyGuardStore } from '@/store/dirtyGuardStore'
import { WorkspaceTabs } from '@/components/layout/WorkspaceTabs'
import { KeepAliveOutlet } from '@/components/layout/KeepAliveOutlet'
import { DirtyGuardDialog } from '@/components/shared/DirtyGuardDialog'
import { AppToast } from '@/components/shared/AppToast'
import { GlobalConfirmDialog } from '@/components/shared/GlobalConfirmDialog'
import { toast } from '@/lib/toast'
import NotificationBell from '@/components/shared/NotificationBell'
import GlobalSearch from '@/components/shared/GlobalSearch'
import UserMenu from '@/components/shared/UserMenu'
import type { PermCode } from '@/lib/permissions'

const navGroups: { group: string; items: { label: string; path: string; perm: PermCode }[] }[] = [
  { group: '总览', items: [{ label: '仪表盘', path: '/dashboard', perm: 'page:dashboard' }] },
  { group: '采购', items: [{ label: '供应商管理', path: '/suppliers', perm: 'page:suppliers' }, { label: '采购管理', path: '/purchase', perm: 'page:purchase' }] },
  { group: '销售', items: [{ label: '客户管理', path: '/customers', perm: 'page:customers' }, { label: '承运商管理', path: '/carriers', perm: 'page:carriers' }, { label: '销售管理', path: '/sale', perm: 'page:sale' }, { label: '价格管理', path: '/price-lists', perm: 'page:sale' }] },
  { group: '往来', items: [{ label: '退货管理', path: '/returns', perm: 'page:returns' }, { label: '应付/应收', path: '/payments', perm: 'page:payments' }] },
  { group: '库存', items: [{ label: '商品管理', path: '/products', perm: 'page:products' }, { label: '商品分类', path: '/categories', perm: 'page:categories' }, { label: '仓库管理', path: '/warehouses', perm: 'page:warehouses' }, { label: '库位管理', path: '/locations', perm: 'page:warehouses' }, { label: '库存总览', path: '/inventory/overview', perm: 'page:inventory' }, { label: '库存管理', path: '/inventory', perm: 'page:inventory' }, { label: '库存盘点', path: '/stockcheck', perm: 'page:stockcheck' }, { label: '库存调拨', path: '/transfer', perm: 'page:transfer' }] },
  { group: '仓库任务', items: [{ label: '出库看板', path: '/warehouse-tasks', perm: 'page:warehouse-tasks' as PermCode }, { label: '入库任务', path: '/inbound-tasks', perm: 'page:warehouse-tasks' as PermCode }, { label: '波次拣货', path: '/picking-waves', perm: 'page:warehouse-tasks' as PermCode }, { label: '分拣格管理', path: '/sorting-bins', perm: 'page:warehouse-tasks' as PermCode }] },
  { group: '数据', items: [{ label: '报表中心', path: '/reports', perm: 'page:reports' }, { label: '波次效率', path: '/reports/wave-performance', perm: 'page:reports' }, { label: '操作日志', path: '/oplogs', perm: 'page:users' }] },
  { group: '系统', items: [{ label: '用户管理', path: '/users', perm: 'page:users' }, { label: '权限管理', path: '/permissions', perm: 'page:users' }, { label: '系统设置', path: '/settings', perm: 'page:settings' }, { label: '打印模板', path: '/settings/print-templates', perm: 'page:settings' }, { label: '打印机管理', path: '/settings/printers', perm: 'page:settings' }] },
]

export default function AppLayout() {
  const { user } = useAuthStore()
  const { can } = usePermission()
  const navigate = useNavigate()
  const location = useLocation()
  const { addTab, setActive } = useWorkspaceStore()

  function handleNavClick(e: React.MouseEvent<HTMLAnchorElement>, path: string) {
    e.preventDefault()

    function doNavigate() {
      const title = PATH_TITLES[path] ?? path
      const ok = addTab({ key: path, title, path })
      if (!ok) {
        const existing = useWorkspaceStore.getState().tabs.find(t => t.key === path)
        if (existing) setActive(path)
        else toast.warning('标签已达上限（10个），请先关闭一些标签')
      }
      navigate(path)
    }

    // 侧边栏点击：检查当前激活 tab 是否有未保存内容
    const dirtyStore = useDirtyGuardStore.getState()
    const currentActiveKey = useWorkspaceStore.getState().activeKey

    if (dirtyStore.isTabDirty(currentActiveKey)) {
      dirtyStore.showConfirm('当前内容尚未保存，确定离开吗？', () => {
        dirtyStore.setBypassNextBlock(true)
        doNavigate()
      })
      return
    }

    doNavigate()
  }

  const currentPath = location.pathname

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">

      {/*
        ┌──────────────────────────────────────────────────────────────┐
        │  全宽顶栏 h-14 (56px)                                         │
        │  [ Logo w-52 ] [ WorkspaceTabs flex-1 ] [ Search ] [ 🔔 ] [ User ] │
        └──────────────────────────────────────────────────────────────┘
      */}
      <header className="flex h-14 shrink-0 items-center border-b border-border bg-background px-0">
        {/* Logo 区域 — 与侧边栏同宽，视觉对齐 */}
        <div className="flex h-full w-52 shrink-0 items-center border-r border-border px-4">
          <span className="text-base font-bold tracking-tight text-foreground">
            FlowCube ERP
          </span>
        </div>

        {/* WorkspaceTabs — flex-1，横向滚动，不允许被两侧区域压缩 */}
        <div className="flex min-w-0 flex-1 items-center self-stretch px-2">
          <WorkspaceTabs />
        </div>

        {/* 右侧工具区 — 固定宽度，flex-shrink-0 */}
        <div className="flex shrink-0 items-center gap-2 border-l border-border px-4">
          <GlobalSearch />
          <NotificationBell />
          <UserMenu />
        </div>
      </header>

      {/*
        ┌───────────────┬──────────────────────────────────┐
        │  侧边栏 w-52  │  主内容区 flex-1                 │
        │  (导航菜单)   │  (KeepAlive 页面)                │
        └───────────────┴──────────────────────────────────┘
      */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* 侧边栏 — 仅导航 + 底部用户信息 */}
        <aside className="flex w-52 shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
          <nav className="flex-1 overflow-y-auto px-3 py-4">
            {navGroups.map(group => {
              const visible = group.items.filter(i => can(i.perm))
              if (!visible.length) return null
              return (
                <div key={group.group} className="mb-4">
                  <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/40">
                    {group.group}
                  </p>
                  <ul className="space-y-0.5">
                    {visible.map(item => {
                      const isActive = currentPath === item.path
                      return (
                        <li key={item.path}>
                          <a
                            href={item.path}
                            onClick={e => handleNavClick(e, item.path)}
                            className={`flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                              isActive
                                ? 'bg-sidebar-primary/20 text-sidebar-primary-foreground'
                                : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                            }`}
                          >
                            {item.label}
                          </a>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            })}
          </nav>

          {/* 底部用户信息 */}
          <div className="border-t border-sidebar-border p-4">
            <p className="truncate text-sm font-medium text-sidebar-foreground">
              {user?.realName ?? user?.username}
            </p>
            <p className="truncate text-xs text-sidebar-foreground/60">{user?.roleName}</p>
          </div>
        </aside>

        {/* 主内容区 */}
        <main className="min-w-0 flex-1 overflow-hidden">
          <KeepAliveOutlet />
        </main>
      </div>

      {/* 全局未保存变更确认弹窗（整个应用只挂载一次） */}
      <DirtyGuardDialog />

      {/* 全局命令式确认弹窗（整个应用只挂载一次） */}
      <GlobalConfirmDialog />

      {/* 全局提示条（整个应用只挂载一次，右上角堆叠） */}
      <AppToast />
    </div>
  )
}
