/**
 * TopNav — 顶栏主导航（hover 下拉，最多两级）
 *
 * 菜单结构继承自原 Sidebar 分组；使用 Link + 工作区标签与未保存守卫。
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePermission } from '@/hooks/usePermission'
import { useWorkspaceStore, PATH_TITLES } from '@/store/workspaceStore'
import type { PermCode } from '@/lib/permissions'

export type NavChildItem = { label: string; path: string; perm: PermCode }

export type TopNavSection =
  | { kind: 'link'; label: string; path: string; perm: PermCode }
  | { kind: 'menu'; label: string; children: NavChildItem[] }

/** 与原 Sidebar 分组一致，并补全 KeepAlive 中已有路由（报表子页、波次扫码） */
export const TOP_NAV_SECTIONS: TopNavSection[] = [
  { kind: 'link', label: '仪表盘', path: '/dashboard', perm: 'page:dashboard' },
  {
    kind: 'menu',
    label: '采购',
    children: [
      { label: '供应商管理', path: '/suppliers', perm: 'page:suppliers' },
      { label: '采购订单', path: '/purchase', perm: 'page:purchase' },
      { label: '收货订单', path: '/inbound-tasks', perm: 'page:inbound' },
    ],
  },
  {
    kind: 'menu',
    label: '销售',
    children: [
      { label: '客户管理', path: '/customers', perm: 'page:customers' },
      { label: '承运商管理', path: '/carriers', perm: 'page:carriers' },
      { label: '销售管理', path: '/sale', perm: 'page:sale' },
      { label: '价格管理', path: '/price-lists', perm: 'page:sale' },
    ],
  },
  {
    kind: 'menu',
    label: '往来',
    children: [
      { label: '退货管理', path: '/returns', perm: 'page:returns' },
      { label: '应付/应收', path: '/payments', perm: 'page:payments' },
    ],
  },
  {
    kind: 'menu',
    label: '库存',
    children: [
      { label: '商品管理', path: '/products', perm: 'page:products' },
      { label: '商品分类', path: '/categories', perm: 'page:categories' },
      { label: '仓库管理', path: '/warehouses', perm: 'page:warehouses' },
      { label: '库位管理', path: '/locations', perm: 'page:warehouses' },
      { label: '货架管理', path: '/racks', perm: 'page:warehouses' },
      { label: '库存总览', path: '/inventory/overview', perm: 'page:inventory' },
      { label: '库存管理', path: '/inventory', perm: 'page:inventory' },
      { label: '库存盘点', path: '/stockcheck', perm: 'page:stockcheck' },
      { label: '库存调拨', path: '/transfer', perm: 'page:transfer' },
    ],
  },
  {
    kind: 'menu',
    label: '仓库任务',
    children: [
      { label: '出库看板', path: '/warehouse-tasks', perm: 'page:warehouse-tasks' },
      { label: '波次拣货', path: '/picking-waves', perm: 'page:warehouse-tasks' },
      { label: '分拣格管理', path: '/sorting-bins', perm: 'page:warehouse-tasks' },
      { label: '波次扫码', path: '/wave-scan', perm: 'page:warehouse-tasks' },
    ],
  },
  {
    kind: 'menu',
    label: '数据',
    children: [
      { label: '报表中心', path: '/reports', perm: 'page:reports' },
      { label: '岗位工作台', path: '/reports/role-workbench', perm: 'page:reports' },
      { label: '异常工作台', path: '/reports/exception-workbench', perm: 'page:reports' },
      { label: '波次效率', path: '/reports/wave-performance', perm: 'page:reports' },
      { label: 'PDA 异常分析', path: '/reports/pda-anomaly', perm: 'page:reports' },
      { label: '仓库运营看板', path: '/reports/warehouse-ops', perm: 'page:reports' },
      { label: '操作日志', path: '/oplogs', perm: 'page:users' },
    ],
  },
  {
    kind: 'menu',
    label: '系统',
    children: [
      { label: '用户管理', path: '/users', perm: 'page:users' },
      { label: '权限管理', path: '/permissions', perm: 'page:users' },
      { label: '系统设置', path: '/settings', perm: 'page:settings' },
      { label: '条码打印查询', path: '/settings/barcode-print-query', perm: 'page:settings' },
      { label: '打印模板', path: '/settings/print-templates', perm: 'page:settings' },
      { label: '打印机管理', path: '/settings/printers', perm: 'page:settings' },
    ],
  },
]

/** 在同级 path 中取最长前缀匹配，避免 /inventory 误匹配 /inventory/overview */
function matchChildPath(pathname: string, paths: string[]): string | null {
  const sorted = [...paths].sort((a, b) => b.length - a.length)
  for (const p of sorted) {
    if (pathname === p || pathname.startsWith(`${p}/`)) return p
  }
  return null
}

function sectionIsActive(pathname: string, section: TopNavSection): boolean {
  if (section.kind === 'link') {
    return pathname === section.path || pathname.startsWith(`${section.path}/`)
  }
  const paths = section.children.map((c) => c.path)
  return matchChildPath(pathname, paths) != null
}

function childIsActive(pathname: string, childPath: string, siblingPaths: string[]): boolean {
  const hit = matchChildPath(pathname, siblingPaths)
  return hit === childPath
}

const HOVER_CLOSE_MS = 140

function NavItemLink(props: {
  label: string
  path: string
  active: boolean
  navigateWithGuard: (path: string) => void
}) {
  const { label, path, active, navigateWithGuard } = props
  return (
    <Link
      to={path}
      aria-current={active ? 'page' : undefined}
      onClick={(e) => {
        e.preventDefault()
        navigateWithGuard(path)
      }}
      className={cn(
        'inline-flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
    >
      {label}
    </Link>
  )
}

function NavItemMenu(props: {
  label: string
  children: NavChildItem[]
  pathname: string
  navigateWithGuard: (path: string) => void
}) {
  const { label, children, pathname, navigateWithGuard } = props
  const [open, setOpen] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearCloseTimer = useCallback(() => {
    if (closeTimer.current != null) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }, [])

  const scheduleClose = useCallback(() => {
    clearCloseTimer()
    closeTimer.current = setTimeout(() => setOpen(false), HOVER_CLOSE_MS)
  }, [clearCloseTimer])

  const openMenu = useCallback(() => {
    clearCloseTimer()
    setOpen(true)
  }, [clearCloseTimer])

  useEffect(() => () => clearCloseTimer(), [clearCloseTimer])

  const siblingPaths = children.map((c) => c.path)
  const sectionActive = matchChildPath(pathname, siblingPaths) != null

  return (
    <div
      className="relative"
      onMouseEnter={openMenu}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          'inline-flex items-center gap-0.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          sectionActive || open
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        )}
      >
        {label}
        <ChevronDown className={cn('h-3.5 w-3.5 opacity-70 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div
          className="absolute left-0 top-full z-50 min-w-[11rem] pt-1"
          role="menu"
          onMouseEnter={openMenu}
          onMouseLeave={scheduleClose}
        >
          <ul className="rounded-md border border-border bg-popover py-1 text-popover-foreground shadow-md">
            {children.map((item) => {
              const active = childIsActive(pathname, item.path, siblingPaths)
              return (
                <li key={item.path} role="none">
                  <Link
                    role="menuitem"
                    to={item.path}
                    aria-current={active ? 'page' : undefined}
                    onClick={(e) => {
                      e.preventDefault()
                      setOpen(false)
                      navigateWithGuard(item.path)
                    }}
                    className={cn(
                      'block px-3 py-2 text-sm transition-colors',
                      active
                        ? 'bg-primary/10 font-medium text-primary'
                        : 'text-foreground hover:bg-muted'
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

export function TopNav() {
  const { can } = usePermission()
  const navigate = useNavigate()
  const location = useLocation()
  const { addTab } = useWorkspaceStore()
  const pathname = location.pathname

  /** 打开/激活目标页：不因未保存草稿拦截；与 WorkspaceTabs 一致，由 KeepAlive 保留表单状态 */
  const navigateWithGuard = useCallback(
    (path: string) => {
      const title = PATH_TITLES[path] ?? path
      addTab({ key: path, title, path })
      navigate(path)
    },
    [addTab, navigate]
  )

  const nodes: ReactNode[] = []

  for (const section of TOP_NAV_SECTIONS) {
    if (section.kind === 'link') {
      if (!can(section.perm)) continue
      const active = sectionIsActive(pathname, section)
      nodes.push(
        <NavItemLink
          key={section.path}
          label={section.label}
          path={section.path}
          active={active}
          navigateWithGuard={navigateWithGuard}
        />
      )
      continue
    }

    const visible = section.children.filter((c) => can(c.perm))
    if (!visible.length) continue

    if (visible.length === 1) {
      const only = visible[0]
      const active =
        pathname === only.path || pathname.startsWith(`${only.path}/`)
      nodes.push(
        <NavItemLink
          key={only.path}
          label={section.label}
          path={only.path}
          active={active}
          navigateWithGuard={navigateWithGuard}
        />
      )
      continue
    }

    nodes.push(
      <NavItemMenu
        key={section.label}
        label={section.label}
        children={visible}
        pathname={pathname}
        navigateWithGuard={navigateWithGuard}
      />
    )
  }

  if (!nodes.length) return null

  return (
    <nav className="flex shrink-0 flex-wrap items-center gap-0.5" aria-label="主导航">
      {nodes}
    </nav>
  )
}
