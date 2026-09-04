import { KpiApprovalCount, BoardSalesActions, BoardBusinessRisk, ReceivableDueDistribution } from './widgets/OperationalWidgets'
import type { ComponentType, LazyExoticComponent } from 'react'
import { lazy } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Boxes, Wallet, ShoppingCart, ClipboardList, Truck, ScanLine, HandCoins, CreditCard, Landmark,
  Activity, BarChart3, Warehouse, TrendingUp, ShoppingBag, CalendarClock, Coins, PieChart,
  AlertTriangle, ListTodo, Users, Building2, TriangleAlert, Info,
  Sparkles, Timer, PartyPopper, Hourglass, Quote, Fish, Clover, Droplet, StickyNote, Gauge,
  ClipboardCheck,
} from 'lucide-react'
import * as Kpi from './widgets/KpiWidgets'
// 图表 widget（2026-08-22 性能）：recharts 389KB vendor 只被图表用，改 lazy——
// 不再随 ERP/PDA 首屏依赖图预取，仅打开仪表盘且渲染对应图表时才加载对应 chunk。
const ChartIoTrend = lazy(() => import('./widgets/ChartWidgets').then(m => ({ default: m.ChartIoTrend })))
const ChartTopStock = lazy(() => import('./widgets/ChartWidgets').then(m => ({ default: m.ChartTopStock })))
const ChartWarehouseStock = lazy(() => import('./widgets/ChartWidgets').then(m => ({ default: m.ChartWarehouseStock })))
const ChartSaleTrend = lazy(() => import('./widgets/ChartWidgets').then(m => ({ default: m.ChartSaleTrend })))
const ChartPurchaseTrend = lazy(() => import('./widgets/ChartWidgets').then(m => ({ default: m.ChartPurchaseTrend })))
const ChartAging = lazy(() => import('./widgets/ChartWidgets').then(m => ({ default: m.ChartAging })))
const ChartCashflow = lazy(() => import('./widgets/ChartWidgets').then(m => ({ default: m.ChartCashflow })))
const ChartAccountBalance = lazy(() => import('./widgets/ChartWidgets').then(m => ({ default: m.ChartAccountBalance })))
import * as List from './widgets/ListWidgets'
import * as Fun from './widgets/FunWidgets'
import DashboardVersionCard from './DashboardVersionCard'
import { PERMISSIONS, type PermissionCode } from '@/lib/permission-codes'
import type { DashboardLayout } from '@/types/dashboard'

export type WidgetCategory = 'kpi' | 'chart' | 'list' | 'fun' | 'system'
// 高度档：sm 占 1 个网格行、lg 占 2 个（正好是 sm 的两倍高，好排版）。
export type WidgetSize = 'sm' | 'lg'

export interface WidgetDef {
  id: string
  title: string
  description: string
  icon: LucideIcon
  category: WidgetCategory
  /** 所需权限码；缺省表示所有登录用户可见 */
  permission?: PermissionCode
  /** 默认列跨度（4 列网格），1–4 */
  defaultW: number
  /** 高度档（固定卡高，内容在卡内居中/滚动，不随内容变化） */
  size: WidgetSize
  /** lazy 组件需渲染处包 Suspense（图表 widget 为 lazy 加载） */
  Component: ComponentType | LazyExoticComponent<ComponentType>
}

export const CATEGORY_LABEL: Record<WidgetCategory, string> = {
  kpi: '关键指标', chart: '图表分析', list: '列表看板', fun: '趣味组件', system: '系统',
}
export const CATEGORY_ORDER: WidgetCategory[] = ['kpi', 'chart', 'list', 'fun', 'system']

// 注册表：新增小组件只需在此追加一项 + 写好组件，默认布局与组件库会自动纳入。
// permission 必须与后端对应接口的 requirePermission 一致，否则会向无权限用户发出注定 403 的请求。
export const WIDGETS: WidgetDef[] = [
  {id:'kpi-approval-count',title:'待我审批',description:'当前待审批总量',icon:ClipboardCheck,category:'kpi',permission:PERMISSIONS.APPROVAL_TASK_VIEW,defaultW:1,size:'sm',Component:KpiApprovalCount},
  {id:'board-sales-actions',title:'今天要推进的业务',description:'销售与采购下一步',icon:ClipboardList,category:'list',permission:PERMISSIONS.DASHBOARD_VIEW,defaultW:2,size:'lg',Component:BoardSalesActions},
  {id:'board-business-risk',title:'需要关注',description:'账款、授信与库存风险',icon:AlertTriangle,category:'list',permission:PERMISSIONS.DASHBOARD_VIEW,defaultW:2,size:'lg',Component:BoardBusinessRisk},
  {id:'chart-receivable-due',title:'应收到期分布',description:'逾期、今天、未来七天和更晚',icon:CalendarClock,category:'chart',permission:PERMISSIONS.PAYMENT_VIEW,defaultW:2,size:'lg',Component:ReceivableDueDistribution},

  // —— 关键指标（sm）——
  { id: 'kpi-total-qty',       title: '库存总数量',      description: '各仓库库存数量汇总',        icon: Boxes,         category: 'kpi', permission: PERMISSIONS.DASHBOARD_VIEW,       defaultW: 1, size: 'sm', Component: Kpi.KpiTotalQty },
  { id: 'kpi-total-value',     title: '库存总价值',      description: '按成本价估算的库存金额',    icon: Wallet,        category: 'kpi', permission: PERMISSIONS.DASHBOARD_VIEW,       defaultW: 1, size: 'sm', Component: Kpi.KpiTotalValue },
  { id: 'kpi-pending-purchase', title: '待处理采购',     description: '草稿 + 已提交的采购单数',   icon: ShoppingCart,  category: 'kpi', permission: PERMISSIONS.DASHBOARD_VIEW,       defaultW: 1, size: 'sm', Component: Kpi.KpiPendingPurchase },
  { id: 'kpi-pending-sale',    title: '待处理销售',      description: '草稿 + 占库 + 拣货中订单数', icon: ClipboardList, category: 'kpi', permission: PERMISSIONS.DASHBOARD_VIEW,       defaultW: 1, size: 'sm', Component: Kpi.KpiPendingSale },
  { id: 'kpi-shipped-today',   title: '今日出库',        description: '今日已出库单数',            icon: Truck,         category: 'kpi', permission: PERMISSIONS.REPORT_VIEW,          defaultW: 1, size: 'sm', Component: Kpi.KpiShippedToday },
  { id: 'kpi-scan-today',      title: '今日扫码量',      description: '今日 PDA 扫码次数',         icon: ScanLine,      category: 'kpi', permission: PERMISSIONS.REPORT_VIEW,          defaultW: 1, size: 'sm', Component: Kpi.KpiScanToday },
  { id: 'kpi-receivable',      title: '应收敞口',        description: '未收回应收账款合计',        icon: HandCoins,     category: 'kpi', permission: PERMISSIONS.PAYMENT_VIEW,         defaultW: 1, size: 'sm', Component: Kpi.KpiReceivable },
  { id: 'kpi-payable',         title: '应付敞口',        description: '待支付应付账款合计',        icon: CreditCard,    category: 'kpi', permission: PERMISSIONS.PAYMENT_VIEW,         defaultW: 1, size: 'sm', Component: Kpi.KpiPayable },
  { id: 'kpi-account-balance', title: '账户余额合计',    description: '启用资金账户余额合计',      icon: Landmark,      category: 'kpi', permission: PERMISSIONS.FINANCE_ACCOUNT_VIEW, defaultW: 1, size: 'sm', Component: Kpi.KpiAccountBalance },
  { id: 'kpi-credit-warning',  title: '授信预警',         description: '客户授信超限/高危占用',       icon: Gauge,         category: 'kpi', permission: PERMISSIONS.SALE_CREDIT_VIEW,    defaultW: 1, size: 'sm', Component: Kpi.KpiCreditWarning },

  // —— 图表分析（lg）——
  { id: 'chart-io-trend',       title: '出入库趋势',      description: '近 7 天出入库数量走势',     icon: Activity,      category: 'chart', permission: PERMISSIONS.DASHBOARD_VIEW,       defaultW: 2, size: 'lg', Component: ChartIoTrend },
  { id: 'chart-top-stock',      title: '库存价值 Top 10', description: '库存金额最高的商品',        icon: BarChart3,     category: 'chart', permission: PERMISSIONS.DASHBOARD_VIEW,       defaultW: 2, size: 'lg', Component: ChartTopStock },
  { id: 'chart-warehouse-stock', title: '各仓库存分布',   description: '各仓库库存价值对比',        icon: Warehouse,     category: 'chart', permission: PERMISSIONS.REPORT_VIEW,          defaultW: 2, size: 'lg', Component: ChartWarehouseStock },
  { id: 'chart-sale-trend',     title: '月度销售趋势',    description: '近半年销售额与发货额',      icon: TrendingUp,    category: 'chart', permission: PERMISSIONS.REPORT_VIEW,          defaultW: 2, size: 'lg', Component: ChartSaleTrend },
  { id: 'chart-purchase-trend', title: '月度采购趋势',    description: '近半年采购额与收货额',      icon: ShoppingBag,   category: 'chart', permission: PERMISSIONS.REPORT_VIEW,          defaultW: 2, size: 'lg', Component: ChartPurchaseTrend },
  { id: 'chart-aging',          title: '应收应付账龄',    description: '账龄桶分布对比',            icon: CalendarClock, category: 'chart', permission: PERMISSIONS.PAYMENT_VIEW,         defaultW: 2, size: 'lg', Component: ChartAging },
  { id: 'chart-cashflow',       title: '月度现金流',      description: '近半年收入 / 支出 / 净额',  icon: Coins,         category: 'chart', permission: PERMISSIONS.FINANCE_ACCOUNT_VIEW, defaultW: 2, size: 'lg', Component: ChartCashflow },
  { id: 'chart-account-balance', title: '账户余额分布',   description: '各资金账户余额占比',        icon: PieChart,      category: 'chart', permission: PERMISSIONS.FINANCE_ACCOUNT_VIEW, defaultW: 2, size: 'lg', Component: ChartAccountBalance },

  // —— 列表看板（lg）——
  { id: 'list-low-stock',    title: '低库存预警',    description: '库存不足的商品清单',        icon: AlertTriangle, category: 'list', permission: PERMISSIONS.DASHBOARD_VIEW, defaultW: 2, size: 'lg', Component: List.ListLowStock },
  { id: 'board-incoming',    title: '到货看板',      description: '逾期 / 今日 / 本周待到货',  icon: Truck,         category: 'list', permission: PERMISSIONS.DASHBOARD_VIEW, defaultW: 2, size: 'lg', Component: List.BoardIncoming },
  { id: 'list-pda-perf',     title: '今日 PDA 作业', description: '今日扫码 / 拣货与操作员排行', icon: ScanLine,     category: 'list', permission: PERMISSIONS.REPORT_VIEW,    defaultW: 2, size: 'lg', Component: List.ListPdaPerf },
  { id: 'list-collect-top',  title: '催收 Top',      description: '应收敞口最高的往来方',      icon: HandCoins,     category: 'list', permission: PERMISSIONS.PAYMENT_VIEW,   defaultW: 2, size: 'lg', Component: List.ListCollectTop },
  { id: 'list-pay-top',      title: '催付 Top',      description: '应付敞口最高的往来方',      icon: Wallet,        category: 'list', permission: PERMISSIONS.PAYMENT_VIEW,   defaultW: 2, size: 'lg', Component: List.ListPayTop },
  { id: 'board-workbench',   title: '我的工作台',    description: '按角色聚合的待处理事项',    icon: ListTodo,      category: 'list', permission: PERMISSIONS.REPORT_VIEW,    defaultW: 2, size: 'lg', Component: List.BoardWorkbench },
  { id: 'list-top-customer', title: 'Top 客户',      description: '销售额最高的客户',          icon: Users,         category: 'list', permission: PERMISSIONS.REPORT_VIEW,    defaultW: 2, size: 'lg', Component: List.ListTopCustomer },
  { id: 'list-top-supplier', title: 'Top 供应商',    description: '采购额最高的供应商',        icon: Building2,     category: 'list', permission: PERMISSIONS.REPORT_VIEW,    defaultW: 2, size: 'lg', Component: List.ListTopSupplier },
  { id: 'list-anomaly',      title: '异常扫码分析',  description: '近 30 天扫码异常概况',      icon: TriangleAlert, category: 'list', permission: PERMISSIONS.SCAN_LOG_VIEW,  defaultW: 2, size: 'lg', Component: List.ListAnomaly },
  { id: 'list-pending-approvals', title: '待我审批', description: '流转到当前节点的审批单据', icon: ClipboardCheck, category: 'list', permission: PERMISSIONS.APPROVAL_TASK_VIEW, defaultW: 2, size: 'lg', Component: List.ListPendingApprovals },

  // —— 趣味 ——
  { id: 'fun-wooden-fish', title: '电子木鱼',   description: '敲一敲，功德 +1（连击特效）', icon: Sparkles,    category: 'fun', defaultW: 1, size: 'sm', Component: Fun.WoodenFish },
  { id: 'fun-offwork',     title: '下班倒计时', description: '到点撒花，周末识别',          icon: Timer,       category: 'fun', defaultW: 1, size: 'sm', Component: Fun.OffWorkCountdown },
  { id: 'fun-holiday',     title: '假期倒计时', description: '可自定义的假期日历倒计时',    icon: PartyPopper, category: 'fun', defaultW: 2, size: 'sm', Component: Fun.HolidayCountdown },
  { id: 'fun-pomodoro',    title: '番茄钟',     description: '25 分钟专注计时',            icon: Hourglass,   category: 'fun', defaultW: 1, size: 'sm', Component: Fun.PomodoroTimer },
  { id: 'fun-quote',       title: '每日一言',   description: '每天一句，点击换一条',       icon: Quote,       category: 'fun', defaultW: 2, size: 'sm', Component: Fun.DailyQuote },
  { id: 'fun-slacking',    title: '摸鱼倒计时', description: '距周末 / 发薪日还有几天',     icon: Fish,        category: 'fun', defaultW: 1, size: 'sm', Component: Fun.SlackingCountdown },
  { id: 'fun-fortune',     title: '今日运势',   description: '点击抽取今日签',             icon: Clover,      category: 'fun', defaultW: 1, size: 'sm', Component: Fun.DailyFortune },
  { id: 'fun-water',       title: '喝水提醒',   description: '今日饮水打卡，目标 8 杯',     icon: Droplet,     category: 'fun', defaultW: 1, size: 'sm', Component: Fun.WaterTracker },
  { id: 'fun-todo',        title: '待办便签',   description: '随手记，勾选完成',            icon: StickyNote,  category: 'fun', defaultW: 2, size: 'lg', Component: Fun.TodoNote },
  { id: 'fun-year',        title: '年度进度',   description: '今年已过百分之多少',          icon: Gauge,       category: 'fun', defaultW: 1, size: 'sm', Component: Fun.YearProgress },

  // —— 系统（lg）——
  { id: 'system-version', title: '系统版本', description: '当前版本与更新检查', icon: Info, category: 'system', defaultW: 2, size: 'lg', Component: DashboardVersionCard },
]

export const WIDGET_MAP: Record<string, WidgetDef> = Object.fromEntries(WIDGETS.map(w => [w.id, w]))

const clampW = (w: number, id: string): number => {
  const n = Math.round(Number(w) || WIDGET_MAP[id]?.defaultW || 2)
  return Math.min(4, Math.max(1, n))
}

// 新用户 / 未个性化时的默认布局：这些默认显示，其余进组件库待添加（visible:false）。
const PREVIOUS_VISIBLE_ORDER = [
  'kpi-pending-sale', 'kpi-pending-purchase', 'kpi-shipped-today', 'kpi-credit-warning',
  'board-workbench', 'list-pending-approvals',
  'list-low-stock', 'board-incoming',
  'chart-sale-trend', 'chart-io-trend',
]
const DEFAULT_VISIBLE_ORDER = [
  'kpi-pending-sale', 'kpi-shipped-today', 'kpi-receivable', 'kpi-approval-count',
  'board-sales-actions', 'board-business-risk', 'chart-sale-trend', 'chart-receivable-due',
]

// 旧默认布局以三项趣味组件为组合标记；迁移后仍可从组件库按需加回。
const LEGACY_DEFAULT_MARKERS = ['fun-wooden-fish', 'fun-offwork', 'fun-holiday']

export function buildDefaultLayout(): DashboardLayout {
  const visible = DEFAULT_VISIBLE_ORDER
    .filter(id => WIDGET_MAP[id])
    .map(id => ({ id, visible: true, w: WIDGET_MAP[id].defaultW }))
  const rest = WIDGETS
    .filter(w => !DEFAULT_VISIBLE_ORDER.includes(w.id))
    .map(w => ({ id: w.id, visible: false, w: w.defaultW }))
  return { widgets: [...visible, ...rest] }
}

/**
 * 把后端存的布局与当前注册表对齐：丢弃已不存在的 widget、去重、补入注册表新出现的
 * widget（默认隐藏、排末尾）、夹紧 w。保证注册表演进后老布局不崩、也不丢新组件。
 */
export function mergeLayout(saved: DashboardLayout | null | undefined): DashboardLayout {
  if (!saved?.widgets?.length) return buildDefaultLayout()
  const previousVisible = saved.widgets.filter(w => w.visible)
  if (previousVisible.length === PREVIOUS_VISIBLE_ORDER.length && previousVisible.every((w,i) => w.id === PREVIOUS_VISIBLE_ORDER[i] && w.w === WIDGET_MAP[w.id]?.defaultW)) return buildDefaultLayout()
  const legacyVisible = new Set(saved.widgets.filter(w => w.visible && WIDGET_MAP[w.id]).map(w => w.id))
  if (LEGACY_DEFAULT_MARKERS.every(id => legacyVisible.has(id))) return buildDefaultLayout()
  const seen = new Set<string>()
  const merged: DashboardLayout['widgets'] = []
  for (const w of saved.widgets) {
    if (!WIDGET_MAP[w.id] || seen.has(w.id)) continue
    seen.add(w.id)
    merged.push({ id: w.id, visible: !!w.visible, w: clampW(w.w, w.id) })
  }
  for (const d of WIDGETS) if (!seen.has(d.id)) merged.push({ id: d.id, visible: false, w: d.defaultW })
  return { widgets: merged }
}
