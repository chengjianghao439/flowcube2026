import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import type { PermCode } from '@/lib/permissions'
import { PERMISSIONS } from '@/lib/permission-codes'

export type RouteTabIdentity =
  | { kind: 'pathname' }
  | { kind: 'full-url' }
  | { kind: 'query-keys'; keys: string[] }

export type RouteComponent = LazyExoticComponent<ComponentType>

type RouteNavMeta =
  | { kind: 'link'; label: string; order: number; iconKey?: string }
  | { kind: 'menu'; group: string; order: number; label?: string; iconKey?: string }

export interface RouteRegistryEntry {
  path: string
  title: string
  permission: PermCode
  component: RouteComponent
  keepAlive: boolean
  tabIdentity: RouteTabIdentity
  nav?: RouteNavMeta
  aliases?: string[]
}

export interface RoutePatternEntry {
  pattern: RegExp
  title: (path: string) => string
  permission: PermCode
  component: RouteComponent
  keepAlive: boolean
  tabIdentity: RouteTabIdentity
}

export type NavChildItem = { label: string; path: string; perm: PermCode; iconKey?: string }

export type TopNavSection =
  | { kind: 'link'; label: string; path: string; perm: PermCode; iconKey?: string }
  | { kind: 'menu'; label: string; children: NavChildItem[] }

const pathnameIdentity: RouteTabIdentity = { kind: 'pathname' }

const DashboardPage = lazy(() => import('@/pages/dashboard'))
const SalePage = lazy(() => import('@/pages/sale'))
const SaleFormPage = lazy(() => import('@/pages/sale/form'))
const PurchasePage = lazy(() => import('@/pages/purchase'))
const PurchaseFormPage = lazy(() => import('@/pages/purchase/form'))
const ProductPage = lazy(() => import('@/pages/products'))
const CategoryPage = lazy(() => import('@/pages/categories'))
const WarehousePage = lazy(() => import('@/pages/warehouses'))
const InventoryPage = lazy(() => import('@/pages/inventory'))
const InventoryOverviewPage = lazy(() => import('@/pages/inventory/overview'))
const StockcheckPage = lazy(() => import('@/pages/stockcheck'))
const TransferPage = lazy(() => import('@/pages/transfer'))
const WarehouseTasksPage = lazy(() => import('@/pages/warehouse-tasks'))
const InboundTasksPage = lazy(() => import('@/pages/inbound-tasks'))
const InboundTaskCreatePage = lazy(() => import('@/pages/inbound-tasks/create'))
const InboundTaskDetailPage = lazy(() => import('@/pages/inbound-tasks/detail'))
const PickingWavesPage = lazy(() => import('@/pages/picking-waves'))
const SortingBinsPage = lazy(() => import('@/pages/sorting-bins'))
const LocationsPage = lazy(() => import('@/pages/locations'))
const RacksPage = lazy(() => import('@/pages/racks'))
const CustomersPage = lazy(() => import('@/pages/customers'))
const CarriersPage = lazy(() => import('@/pages/carriers'))
const SuppliersPage = lazy(() => import('@/pages/suppliers'))
const ReturnsPage = lazy(() => import('@/pages/returns'))
const PaymentsPage = lazy(() => import('@/pages/payments'))
const UsersPage = lazy(() => import('@/pages/users'))
const PermissionsPage = lazy(() => import('@/pages/permissions'))
const SettingsPage = lazy(() => import('@/pages/settings'))
const BarcodePrintQueryPage = lazy(() => import('@/pages/settings/barcode-print-query'))
const OplogsPage = lazy(() => import('@/pages/oplogs'))
const ReportsPage = lazy(() => import('@/pages/reports'))
const RoleWorkbenchPage = lazy(() => import('@/pages/reports/role-workbench'))
const ExceptionWorkbenchPage = lazy(() => import('@/pages/reports/exception-workbench'))
const ReconciliationPage = lazy(() => import('@/pages/reports/reconciliation'))
const ProfitAnalysisPage = lazy(() => import('@/pages/reports/profit-analysis'))
const ApprovalsPage = lazy(() => import('@/pages/reports/approvals'))
const WavePerformancePage = lazy(() => import('@/pages/reports/wave-performance'))
const PdaAnomalyPage = lazy(() => import('@/pages/reports/pda-anomaly'))
const WarehouseOpsPage = lazy(() => import('@/pages/reports/warehouse-ops'))
const PriceListsPage = lazy(() => import('@/pages/price-lists'))
const PrintTemplatesPage = lazy(() => import('@/pages/settings/print-templates'))
const PrintTemplateEditorPage = lazy(() => import('@/pages/settings/print-templates/editor'))
const PrintersPage = lazy(() => import('@/pages/settings/printers'))
const PdaWavePage = lazy(() => import('@/pages/pda/wave'))

export const routeRegistry: RouteRegistryEntry[] = [
  {
    path: '/dashboard',
    title: '仪表盘',
    permission: PERMISSIONS.DASHBOARD_VIEW,
    component: DashboardPage,
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'link', label: '仪表盘', order: 10 },
  },
  {
    path: '/suppliers',
    title: '供应商管理',
    permission: PERMISSIONS.SUPPLIER_VIEW,
    component: SuppliersPage,
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '采购', order: 10 },
  },
  {
    path: '/purchase',
    title: '采购订单',
    permission: PERMISSIONS.PURCHASE_ORDER_VIEW,
    component: PurchasePage,
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '采购', order: 20 },
  },
  {
    path: '/inbound-tasks',
    title: '收货订单',
    permission: PERMISSIONS.INBOUND_ORDER_VIEW,
    component: InboundTasksPage,
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '采购', order: 30 },
  },
  {
    path: '/customers',
    title: '客户管理',
    permission: PERMISSIONS.CUSTOMER_VIEW,
    component: CustomersPage,
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '销售', order: 10 },
  },
  {
    path: '/carriers',
    title: '承运商管理',
    permission: PERMISSIONS.CARRIER_VIEW,
    component: CarriersPage,
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '销售', order: 20 },
  },
  {
    path: '/sale',
    title: '销售管理',
    permission: PERMISSIONS.SALE_ORDER_VIEW,
    component: SalePage,
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '销售', order: 30 },
    aliases: ['/sales'],
  },
  {
    path: '/price-lists',
    title: '价格管理',
    permission: PERMISSIONS.PRICE_LIST_VIEW,
    component: PriceListsPage,
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '销售', order: 40 },
  },
  {
    path: '/returns',
    title: '退货管理',
    permission: PERMISSIONS.RETURN_ORDER_VIEW,
    component: ReturnsPage,
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '往来', order: 10 },
  },
  {
    path: '/payments',
    title: '应付/应收',
    permission: PERMISSIONS.PAYMENT_VIEW,
    component: PaymentsPage,
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '往来', order: 20 },
  },
  {
    path: '/products',
    title: '商品管理',
    permission: PERMISSIONS.PRODUCT_VIEW,
    component: ProductPage,
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '库存', order: 10 },
  },
  {
    path: '/categories',
    title: '商品分类',
    permission: PERMISSIONS.CATEGORY_VIEW,
    component: CategoryPage,
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '库存', order: 20 },
  },
  {
    path: '/warehouses',
    title: '仓库管理',
    permission: PERMISSIONS.WAREHOUSE_VIEW,
    component: WarehousePage,
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '库存', order: 30 },
  },
  {
    path: '/locations',
    title: '库位管理',
    permission: PERMISSIONS.LOCATION_VIEW,
    component: LocationsPage,
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '库存', order: 40 },
  },
  {
    path: '/racks',
    title: '货架管理',
    permission: PERMISSIONS.RACK_VIEW,
    component: RacksPage,
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '库存', order: 50 },
  },
  {
    path: '/inventory/overview',
    title: '库存总览',
    permission: PERMISSIONS.INVENTORY_VIEW,
    component: InventoryOverviewPage,
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '库存', order: 60 },
  },
  {
    path: '/inventory',
    title: '库存管理',
    permission: PERMISSIONS.INVENTORY_VIEW,
    component: InventoryPage,
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '库存', order: 70 },
  },
  {
    path: '/stockcheck',
    title: '库存盘点',
    permission: PERMISSIONS.STOCKCHECK_VIEW,
    component: StockcheckPage,
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '库存', order: 80 },
  },
  {
    path: '/transfer',
    title: '库存调拨',
    permission: PERMISSIONS.TRANSFER_ORDER_VIEW,
    component: TransferPage,
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '库存', order: 90 },
  },
  {
    path: '/warehouse-tasks',
    title: '仓库任务',
    permission: PERMISSIONS.WAREHOUSE_TASK_VIEW,
    component: WarehouseTasksPage,
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '仓库任务', order: 10, label: '出库看板' },
  },
  {
    path: '/picking-waves',
    title: '波次拣货',
    permission: PERMISSIONS.PICKING_WAVE_VIEW,
    component: PickingWavesPage,
    keepAlive: true,
    tabIdentity: { kind: 'query-keys', keys: ['waveId', 'focus'] },
    nav: { kind: 'menu', group: '仓库任务', order: 20 },
  },
  {
    path: '/sorting-bins',
    title: '分拣格管理',
    permission: PERMISSIONS.SORTING_BIN_VIEW,
    component: SortingBinsPage,
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '仓库任务', order: 30 },
  },
  {
    path: '/wave-scan',
    title: '波次扫码',
    permission: PERMISSIONS.PICKING_WAVE_VIEW,
    component: PdaWavePage,
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '仓库任务', order: 40 },
  },
  {
    path: '/reports',
    title: '报表中心',
    permission: PERMISSIONS.REPORT_VIEW,
    component: ReportsPage,
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '数据', order: 10 },
  },
  {
    path: '/reports/role-workbench',
    title: '岗位工作台',
    permission: PERMISSIONS.REPORT_VIEW,
    component: RoleWorkbenchPage,
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '数据', order: 20 },
  },
  {
    path: '/reports/exception-workbench',
    title: '异常工作台',
    permission: PERMISSIONS.REPORT_VIEW,
    component: ExceptionWorkbenchPage,
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '数据', order: 30 },
  },
  {
    path: '/reports/reconciliation',
    title: '对账基础版',
    permission: PERMISSIONS.REPORT_VIEW,
    component: ReconciliationPage,
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '数据', order: 40 },
  },
  {
    path: '/reports/profit-analysis',
    title: '利润 / 库存分析',
    permission: PERMISSIONS.REPORT_VIEW,
    component: ProfitAnalysisPage,
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '数据', order: 50 },
  },
  {
    path: '/reports/approvals',
    title: '审批与提醒',
    permission: PERMISSIONS.REPORT_VIEW,
    component: ApprovalsPage,
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '数据', order: 60 },
  },
  {
    path: '/reports/wave-performance',
    title: '波次效率',
    permission: PERMISSIONS.REPORT_VIEW,
    component: WavePerformancePage,
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '数据', order: 70 },
  },
  {
    path: '/reports/pda-anomaly',
    title: 'PDA 异常分析',
    permission: PERMISSIONS.REPORT_VIEW,
    component: PdaAnomalyPage,
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '数据', order: 80 },
  },
  {
    path: '/reports/warehouse-ops',
    title: '仓库运营看板',
    permission: PERMISSIONS.REPORT_VIEW,
    component: WarehouseOpsPage,
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '数据', order: 90 },
  },
  {
    path: '/oplogs',
    title: '操作日志',
    permission: PERMISSIONS.AUDIT_LOG_VIEW,
    component: OplogsPage,
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '数据', order: 100 },
  },
  {
    path: '/users',
    title: '用户管理',
    permission: PERMISSIONS.USER_VIEW,
    component: UsersPage,
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '系统', order: 10 },
  },
  {
    path: '/permissions',
    title: '权限管理',
    permission: PERMISSIONS.ROLE_VIEW,
    component: PermissionsPage,
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '系统', order: 20 },
  },
  {
    path: '/settings',
    title: '系统设置',
    permission: PERMISSIONS.SETTINGS_VIEW,
    component: SettingsPage,
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '系统', order: 30 },
  },
  {
    path: '/settings/barcode-print-query',
    title: '条码打印查询',
    permission: PERMISSIONS.PRINT_JOB_VIEW,
    component: BarcodePrintQueryPage,
    keepAlive: true,
    tabIdentity: { kind: 'full-url' },
    nav: { kind: 'menu', group: '系统', order: 40 },
  },
  {
    path: '/settings/print-templates',
    title: '打印模板',
    permission: PERMISSIONS.PRINT_TEMPLATE_VIEW,
    component: PrintTemplatesPage,
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '系统', order: 50 },
  },
  {
    path: '/settings/printers',
    title: '打印机管理',
    permission: PERMISSIONS.PRINT_PRINTER_VIEW,
    component: PrintersPage,
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '系统', order: 60 },
  },
]

export const routePatterns: RoutePatternEntry[] = [
  {
    pattern: /^\/sale\/(new|\d+)$/,
    title: (path) => path === '/sale/new' ? '新建销售单' : `销售单 #${path.split('/').pop()}`,
    permission: PERMISSIONS.SALE_ORDER_VIEW,
    component: SaleFormPage,
    keepAlive: true,
    tabIdentity: pathnameIdentity,
  },
  {
    pattern: /^\/purchase\/(new|\d+)$/,
    title: (path) => path === '/purchase/new' ? '新建采购单' : `采购订单 #${path.split('/').pop()}`,
    permission: PERMISSIONS.PURCHASE_ORDER_VIEW,
    component: PurchaseFormPage,
    keepAlive: true,
    tabIdentity: pathnameIdentity,
  },
  {
    pattern: /^\/inbound-tasks\/new$/,
    title: () => '新建收货订单',
    permission: PERMISSIONS.INBOUND_ORDER_VIEW,
    component: InboundTaskCreatePage,
    keepAlive: true,
    tabIdentity: pathnameIdentity,
  },
  {
    pattern: /^\/inbound-tasks\/\d+$/,
    title: (path) => `收货订单 #${path.split('/').pop()}`,
    permission: PERMISSIONS.INBOUND_ORDER_VIEW,
    component: InboundTaskDetailPage,
    keepAlive: true,
    tabIdentity: pathnameIdentity,
  },
  {
    pattern: /^\/settings\/print-templates\/(new|\d+)$/,
    title: (path) => path.endsWith('/new') ? '新建打印模板' : '编辑打印模板',
    permission: PERMISSIONS.PRINT_TEMPLATE_VIEW,
    component: PrintTemplateEditorPage,
    keepAlive: true,
    tabIdentity: pathnameIdentity,
  },
]

export const ROUTE_ALIASES: Record<string, string> = routeRegistry.reduce<Record<string, string>>((acc, route) => {
  for (const alias of route.aliases ?? []) acc[alias] = route.path
  return acc
}, {})

const routeByPath = new Map(routeRegistry.map((route) => [route.path, route]))

export function getRouteByPath(path: string): RouteRegistryEntry | undefined {
  return routeByPath.get(path)
}

export function getRoutePatternByPath(path: string): RoutePatternEntry | undefined {
  return routePatterns.find((entry) => entry.pattern.test(path))
}

export function resolveRouteTitle(path: string): string | undefined {
  return getRouteByPath(path)?.title ?? getRoutePatternByPath(path)?.title(path)
}

export function resolveRoutePermission(path: string): PermCode | undefined {
  return getRouteByPath(path)?.permission ?? getRoutePatternByPath(path)?.permission
}

export function resolveRouteComponent(path: string): RouteComponent | undefined {
  return getRouteByPath(path)?.component ?? getRoutePatternByPath(path)?.component
}

export function resolveRouteTabIdentity(path: string): RouteTabIdentity | undefined {
  return getRouteByPath(path)?.tabIdentity ?? getRoutePatternByPath(path)?.tabIdentity
}

export function isRegisteredErpRoute(path: string): boolean {
  return Boolean(getRouteByPath(path) ?? getRoutePatternByPath(path))
}

export const PATH_TITLES: Record<string, string> = routeRegistry.reduce<Record<string, string>>((acc, route) => {
  acc[route.path] = route.title
  return acc
}, {})

export const PATH_PERMS: Record<string, PermCode> = routeRegistry.reduce<Record<string, PermCode>>((acc, route) => {
  acc[route.path] = route.permission
  return acc
}, {})

export function buildTopNavSections(): TopNavSection[] {
  const links: Array<TopNavSection & { order: number }> = []
  const groups = new Map<string, { order: number; children: Array<NavChildItem & { order: number }> }>()

  for (const route of routeRegistry) {
    if (!route.nav) continue
    if (route.nav.kind === 'link') {
      links.push({
        kind: 'link',
        label: route.nav.label,
        path: route.path,
        perm: route.permission,
        iconKey: route.nav.iconKey,
        order: route.nav.order,
      })
      continue
    }

    const existing = groups.get(route.nav.group) ?? { order: route.nav.order, children: [] }
    existing.order = Math.min(existing.order, route.nav.order)
    existing.children.push({
      label: route.nav.label ?? route.title,
      path: route.path,
      perm: route.permission,
      iconKey: route.nav.iconKey,
      order: route.nav.order,
    })
    groups.set(route.nav.group, existing)
  }

  const menus: Array<TopNavSection & { order: number }> = Array.from(groups.entries()).map(([label, group]) => ({
    kind: 'menu',
    label,
    children: group.children
      .sort((a, b) => a.order - b.order)
      .map(({ order: _order, ...child }) => child),
    order: group.order,
  }))

  return [...links, ...menus]
    .sort((a, b) => a.order - b.order)
    .map(({ order: _order, ...section }) => section)
}
