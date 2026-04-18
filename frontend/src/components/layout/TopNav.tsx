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
import { PERMISSIONS } from '@/lib/permission-codes'

export type NavChildItem = { label: string; path: string; perm: PermCode }

export type TopNavSection =
  | { kind: 'link'; label: string; path: string; perm: PermCode }
  | { kind: 'menu'; label: string; children: NavChildItem[] }

/** 与原 Sidebar 分组一致，并补全 KeepAlive 中已有路由（报表子页、波次扫码） */
export const TOP_NAV_SECTIONS: TopNavSection[] = [
  { kind: 'link', label: '仪表盘', path: '/dashboard', perm: PERMISSIONS.DASHBOARD_VIEW },
  {
    kind: 'menu',
    label: '采购',
    children: [
      { label: '供应商管理', path: '/suppliers', perm: PERMISSIONS.SUPPLIER_VIEW },
      { label: '采购订单', path: '/purchase', perm: PERMISSIONS.PURCHASE_ORDER_VIEW },
      { label: '收货订单', path: '/inbound-tasks', perm: PERMISSIONS.INBOUND_ORDER_VIEW },
    ],
  },
  {
    kind: 'menu',
    label: '销售',
    children: [
      { label: '客户管理', path: '/customers', perm: PERMISSIONS.CUSTOMER_VIEW },
      { label: '承运商管理', path: '/carriers', perm: PERMISSIONS.CARRIER_VIEW },
      { label: '销售管理', path: '/sale', perm: PERMISSIONS.SALE_ORDER_VIEW },
      { label: '价格管理', path: '/price-lists', perm: PERMISSIONS.PRICE_LIST_VIEW },
    ],
  },
  {
    kind: 'menu',
    label: '往来',
    children: [
      { label: '退货管理', path: '/returns', perm: PERMISSIONS.RETURN_ORDER_VIEW },
      { label: '应付/应收', path: '/payments', perm: PERMISSIONS.PAYMENT_VIEW },
    ],
  },
  {
    kind: 'menu',
    label: '库存',
    children: [
      { label: '商品管理', path: '/products', perm: PERMISSIONS.PRODUCT_VIEW },
      { label: '商品分类', path: '/categories', perm: PERMISSIONS.CATEGORY_VIEW },
      { label: '仓库管理', path: '/warehouses', perm: PERMISSIONS.WAREHOUSE_VIEW },
      { label: '库位管理', path: '/locations', perm: PERMISSIONS.LOCATION_VIEW },
      { label: '货架管理', path: '/racks', perm: PERMISSIONS.RACK_VIEW },
      { label: '库存总览', path: '/inventory/overview', perm: PERMISSIONS.INVENTORY_VIEW },
      { label: '库存管理', path: '/inventory', perm: PERMISSIONS.INVENTORY_VIEW },
      { label: '库存盘点', path: '/stockcheck', perm: PERMISSIONS.STOCKCHECK_VIEW },
      { label: '库存调拨', path: '/transfer', perm: PERMISSIONS.TRANSFER_ORDER_VIEW },
    ],
  },
  {
    kind: 'menu',
    label: '仓库任务',
    children: [
      { label: '出库看板', path: '/warehouse-tasks', perm: PERMISSIONS.WAREHOUSE_TASK_VIEW },
      { label: '波次拣货', path: '/picking-waves', perm: PERMISSIONS.PICKING_WAVE_VIEW },
      { label: '分拣格管理', path: '/sorting-bins', perm: PERMISSIONS.SORTING_BIN_VIEW },
      { label: '波次扫码', path: '/wave-scan', perm: PERMISSIONS.PICKING_WAVE_VIEW },
    ],
  },
  {
    kind: 'menu',
    label: '数据',
    children: [
      { label: '报表中心', path: '/reports', perm: PERMISSIONS.REPORT_VIEW },
      { label: '岗位工作台', path: '/reports/role-workbench', perm: PERMISSIONS.REPORT_VIEW },
      { label: '异常工作台', path: '/reports/exception-workbench', perm: PERMISSIONS.REPORT_VIEW },
      { label: '对账基础版', path: '/reports/reconciliation', perm: PERMISSIONS.REPORT_VIEW },
      { label: '利润 / 库存分析', path: '/reports/profit-analysis', perm: PERMISSIONS.REPORT_VIEW },
      { label: '审批与提醒', path: '/reports/approvals', perm: PERMISSIONS.REPORT_VIEW },
      { label: '波次效率', path: '/reports/wave-performance', perm: PERMISSIONS.REPORT_VIEW },
      { label: 'PDA 异常分析', path: '/reports/pda-anomaly', perm: PERMISSIONS.REPORT_VIEW },
      { label: '仓库运营看板', path: '/reports/warehouse-ops', perm: PERMISSIONS.REPORT_VIEW },
      { label: '操作日志', path: '/oplogs', perm: PERMISSIONS.AUDIT_LOG_VIEW },
    ],
  },
  {
    kind: 'menu',
    label: '系统',
    children: [
      { label: '用户管理', path: '/users', perm: PERMISSIONS.USER_VIEW },
      { label: '权限管理', path: '/permissions', perm: PERMISSIONS.ROLE_VIEW },
      { label: '系统设置', path: '/settings', perm: PERMISSIONS.SETTINGS_VIEW },
      { label: '条码打印查询', path: '/settings/barcode-print-query', perm: PERMISSIONS.PRINT_JOB_VIEW },
      { label: '打印模板', path: '/settings/print-templates', perm: PERMISSIONS.PRINT_TEMPLATE_VIEW },
      { label: '打印机管理', path: '/settings/printers', perm: PERMISSIONS.PRINT_PRINTER_VIEW },
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
