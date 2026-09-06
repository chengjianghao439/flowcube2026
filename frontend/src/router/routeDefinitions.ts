import { getMergedPageGroup } from './mergedPageGroups'
import type { PermCode } from '@/lib/permissions'
import { PERMISSIONS } from '@/lib/permission-codes'

export type RouteTabIdentity =
  | { kind: 'pathname' }
  | { kind: 'full-url' }
  | { kind: 'query-keys'; keys: string[] }

export type RouteComponentKey = 'DashboardPage' | 'SalePage' | 'SaleFormPage' | 'PurchasePage' | 'PurchaseFormPage' | 'RequisitionsPage' | 'RequisitionFormPage' | 'ProductPage' | 'PriceChangePage' | 'ProductFormPage' | 'CategoryPage' | 'WarehouseStructurePage' | 'InventoryPage' | 'InventoryTracePage' | 'PlasticBoxesPage' | 'StockcheckPage' | 'AbcClassPage' | 'DisposalPage' | 'ProcurementPlanListPage' | 'ProcurementPlanDetailPage' | 'TransferPage' | 'TransferFormPage' | 'InboundTasksPage' | 'InboundTaskCreatePage' | 'InboundTaskDetailPage' | 'PickingWavesPage' | 'CustomersPage' | 'CarriersPage' | 'CarrierAccountsPage' | 'LogisticsPage' | 'LogisticsDetailPage' | 'FreightReconciliationPage' | 'SuppliersPage' | 'ReturnsPage' | 'PurchaseReturnFormPage' | 'SaleReturnFormPage' | 'PayablePage' | 'ReceivablePage' | 'UsersPage' | 'DepartmentsPage' | 'ApprovalFlowsPage' | 'ApprovalPendingPage' | 'PermissionsPage' | 'SettingsPage' | 'BarcodePrintQueryPage' | 'OplogsPage' | 'ReportsPage' | 'RoleWorkbenchPage' | 'FinanceDashboardPage' | 'FinanceAccountsPage' | 'FinanceTransactionsPage' | 'ExpenseClaimsPage' | 'ExpenseCategoriesPage' | 'AcctAccountsPage' | 'AcctVouchersPage' | 'AcctLedgerPage' | 'AcctReportsPage' | 'AcctInvoicesPage' | 'RefundsPage' | 'CreditOverridesPage' | 'AcctPeriodsPage' | 'AcctConsolidationPage' | 'AcctTaxPage' | 'FixedAssetsPage' | 'AvgCostReconciliationPage' | 'ReconciliationPayablePage' | 'ReconciliationReceivablePage' | 'ProfitAnalysisPage' | 'KpiPage' | 'ReplenishmentPage' | 'InventoryAgingPage' | 'WavePerformancePage' | 'PdaAnomalyPage' | 'WarehouseOpsPage' | 'PrintTemplatesPage' | 'PrintTemplateEditorPage' | 'PrintersPage' | 'PdaDevicesPage' | 'PortalStatementsPage' | 'PortalPurchaseStatusPage'

type RouteNavMeta =
  | { kind: 'link'; label: string; order: number; iconKey?: string }
  /**
   * group = 顶栏一级入口（顺序见 NAV_GROUP_ORDER）
   * section = 下拉内的二级分段标题；省略则落入该组顶部的无标题段
   * order = 组内全局序号，同时决定段内顺序与段之间的先后（段序 = 段内最小 order）
   *         因此同一 group 的 order 必须整体连续递增，不要按段各自从 10 重新开始
   */
  | { kind: 'menu'; group: string; order: number; section?: string; label?: string; iconKey?: string }

export interface RouteRegistryEntry {
  path: string
  title: string
  permission: PermCode
  componentKey: RouteComponentKey
  keepAlive: boolean
  tabIdentity: RouteTabIdentity
  nav?: RouteNavMeta
  aliases?: string[]
}

export interface RoutePatternEntry {
  pattern: RegExp
  title: (path: string) => string
  permission: PermCode
  componentKey: RouteComponentKey
  keepAlive: boolean
  tabIdentity: RouteTabIdentity
  /** 该详情/表单路由所属的列表页路径；关闭详情标签时应回到这里，而非任意相邻标签 */
  listPath?: string
}

export type NavChildItem = { label: string; path: string; perm: PermCode; iconKey?: string }

/** 下拉菜单内的二级分段；label 为空表示无标题段（渲染在最上方） */
export type NavMenuSection = { label?: string; items: NavChildItem[] }

export type TopNavSection =
  | { kind: 'link'; label: string; path: string; perm: PermCode; iconKey?: string }
  /** children 是 sections 拍平后的全量子项，供路径匹配用；渲染走 sections */
  | { kind: 'menu'; label: string; children: NavChildItem[]; sections: NavMenuSection[] }

/**
 * 顶栏一级入口的顺序。必须显式登记：早期靠「子项 order 最小值」推导组序，
 * 结果「仓库任务」因首项 order=20 被静默挤到最右侧，属于隐式规则的事故。
 * 新增 group 时在这里补一行，未登记的组统一排在最后。
 */
const NAV_GROUP_ORDER: Record<string, number> = {
  采购: 20,
  销售: 30,
  库存: 50,
  仓储: 60,
  财务: 70,
  审批中心: 76,
  会计: 80,
  报表: 90,
  系统: 100,
}

const UNREGISTERED_GROUP_ORDER = 9990

const pathnameIdentity: RouteTabIdentity = { kind: 'pathname' }

/** 数组顺序与顶栏结构保持一致，便于对照；实际排序由 nav.order 与 NAV_GROUP_ORDER 决定 */
export const routeRegistry: RouteRegistryEntry[] = [
  {
    path: '/dashboard',
    title: '仪表盘',
    permission: PERMISSIONS.DASHBOARD_VIEW,
    componentKey: 'DashboardPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'link', label: '仪表盘', order: 10 },
  },

  // ── 采购 ──────────────────────────────────────────────
  {
    path: '/purchase',
    title: '采购订单',
    permission: PERMISSIONS.PURCHASE_ORDER_VIEW,
    componentKey: 'PurchasePage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '采购', section: '采购作业', order: 10 },
  },
  {
    path: '/purchase-requisitions',
    title: '采购申请',
    permission: PERMISSIONS.PURCHASE_REQUISITION_VIEW,
    componentKey: 'RequisitionsPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '采购', section: '采购作业', order: 5 },
  },
  {
    path: '/procurement',
    title: '采购建议',
    permission: PERMISSIONS.PROCUREMENT_PLAN_VIEW,
    componentKey: 'ProcurementPlanListPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '采购', section: '采购作业', order: 6 },
  },
  {
    path: '/inbound-tasks',
    title: '收货订单',
    permission: PERMISSIONS.INBOUND_ORDER_VIEW,
    componentKey: 'InboundTasksPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '采购', section: '采购作业', order: 20 },
  },
  {
    // 与 /returns/sale 共用 ReturnsPage，页面按 pathname 判定类型
    path: '/returns/purchase',
    title: '采购退货',
    permission: PERMISSIONS.RETURN_ORDER_VIEW,
    componentKey: 'ReturnsPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '采购', section: '采购作业', order: 30 },
    // 旧的合并入口 /returns 重定向到采购退货
    aliases: ['/returns'],
  },
  {
    path: '/suppliers',
    title: '供应商管理',
    permission: PERMISSIONS.SUPPLIER_VIEW,
    componentKey: 'SuppliersPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '采购', section: '基础资料', order: 40 },
  },

  // ── 销售 ──────────────────────────────────────────────
  {
    path: '/sale',
    title: '销售管理',
    permission: PERMISSIONS.SALE_ORDER_VIEW,
    componentKey: 'SalePage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '销售', section: '销售作业', order: 10 },
    aliases: ['/sales'],
  },
  {
    path: '/returns/sale',
    title: '销售退货',
    permission: PERMISSIONS.RETURN_ORDER_VIEW,
    componentKey: 'ReturnsPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '销售', section: '销售作业', order: 20 },
  },
  {
    path: '/credit-overrides',
    title: '超额放行申请',
    permission: PERMISSIONS.SALE_CREDIT_OVERRIDE_VIEW,
    componentKey: 'CreditOverridesPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '销售', section: '销售作业', order: 25 },
  },
  {
    path: '/logistics',
    title: '物流运单',
    permission: PERMISSIONS.LOGISTICS_VIEW,
    componentKey: 'LogisticsPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '销售', section: '销售作业', order: 25 },
  },
  {
    path: '/customers',
    title: '客户管理',
    permission: PERMISSIONS.CUSTOMER_VIEW,
    componentKey: 'CustomersPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '销售', section: '基础资料', order: 30 },
  },
  {
    path: '/portal/statements',
    title: '客户对账门户',
    permission: PERMISSIONS.PAYMENT_VIEW,
    componentKey: 'PortalStatementsPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '销售', section: '门户', order: 50 },
  },
  {
    path: '/portal/purchase-status',
    title: '供应商到货门户',
    permission: PERMISSIONS.PURCHASE_ORDER_VIEW,
    componentKey: 'PortalPurchaseStatusPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '采购', section: '门户', order: 50 },
  },
  {
    path: '/carriers',
    title: '承运商管理',
    permission: PERMISSIONS.CARRIER_VIEW,
    componentKey: 'CarriersPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '销售', section: '基础资料', order: 40 },
  },

  {
    path: '/carrier-accounts',
    title: '快递账号绑定',
    permission: PERMISSIONS.CARRIER_VIEW,
    componentKey: 'CarrierAccountsPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '销售', section: '基础资料', order: 41 },
  },

  // ── 库存 ──────────────────────────────────────────────
  {
    path: '/inventory',
    title: '库存管理',
    permission: PERMISSIONS.INVENTORY_VIEW,
    componentKey: 'InventoryPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '库存', section: '库存查询', order: 10 },
    aliases: ['/inventory/overview'],
  },
  {
    path: '/plastic-boxes',
    title: '塑料盒管理',
    permission: PERMISSIONS.INVENTORY_VIEW,
    componentKey: 'PlasticBoxesPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '库存', section: '库存查询', order: 20 },
  },
  {
    path: '/inventory/trace',
    title: '批次追溯',
    permission: PERMISSIONS.INVENTORY_VIEW,
    componentKey: 'InventoryTracePage',
    keepAlive: false,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '库存', section: '库存查询', order: 25 },
  },
  {
    path: '/stockcheck',
    title: '库存盘点',
    permission: PERMISSIONS.STOCKCHECK_VIEW,
    componentKey: 'StockcheckPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '库存', section: '库存作业', order: 30 },
  },
  {
    path: '/stockcheck/abc',
    title: '商品分档与分批盘规则',
    permission: PERMISSIONS.STOCKCHECK_ABC_VIEW,
    componentKey: 'AbcClassPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '库存', section: '库存作业', order: 31 },
  },
  {
    path: '/disposals',
    title: '滞销库存处理',
    permission: PERMISSIONS.INVENTORY_DISPOSAL_VIEW,
    componentKey: 'DisposalPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '库存', section: '库存作业', order: 32 },
  },
  {
    path: '/transfer',
    title: '库存调拨',
    permission: PERMISSIONS.TRANSFER_ORDER_VIEW,
    componentKey: 'TransferPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '库存', section: '库存作业', order: 40 },
  },
  {
    path: '/products',
    title: '商品管理',
    permission: PERMISSIONS.PRODUCT_VIEW,
    componentKey: 'ProductPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '库存', section: '商品资料', order: 50 },
  },
  {
    path: '/categories',
    title: '商品分类',
    permission: PERMISSIONS.CATEGORY_VIEW,
    componentKey: 'CategoryPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '库存', section: '商品资料', order: 60 },
  },
  {
    path: '/price-change',
    title: '商品改价申请',
    permission: PERMISSIONS.PRODUCT_VIEW,
    componentKey: 'PriceChangePage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '库存', section: '商品资料', order: 70 },
  },

  // ── 仓储 ──────────────────────────────────────────────
  {
    path: '/picking-waves',
    title: '批次拣货',
    permission: PERMISSIONS.PICKING_WAVE_VIEW,
    componentKey: 'PickingWavesPage',
    keepAlive: true,
    tabIdentity: { kind: 'query-keys', keys: ['waveId', 'focus'] },
    nav: { kind: 'menu', group: '仓储', section: '现场作业', order: 10 },
  },
  {
    path: '/warehouses',
    title: '仓库管理',
    permission: PERMISSIONS.WAREHOUSE_VIEW,
    componentKey: 'WarehouseStructurePage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '仓储', section: '仓库结构', order: 20 },
  },
  {
    path: '/locations',
    title: '库位管理',
    permission: PERMISSIONS.LOCATION_VIEW,
    componentKey: 'WarehouseStructurePage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
  },
  {
    path: '/racks',
    title: '货架管理',
    permission: PERMISSIONS.RACK_VIEW,
    componentKey: 'WarehouseStructurePage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
  },
  {
    path: '/sorting-bins',
    title: '分拣格管理',
    permission: PERMISSIONS.SORTING_BIN_VIEW,
    componentKey: 'WarehouseStructurePage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
  },

  // ── 财务 ──────────────────────────────────────────────
  {
    path: '/payments/payable',
    title: '应付账款',
    permission: PERMISSIONS.PAYMENT_VIEW,
    componentKey: 'PayablePage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '财务', section: '往来账款', order: 10 },
    aliases: ['/payments'],
  },
  {
    path: '/payments/receivable',
    title: '应收账款',
    permission: PERMISSIONS.PAYMENT_VIEW,
    componentKey: 'ReceivablePage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '财务', section: '往来账款', order: 20 },
  },
  {
    path: '/reports/reconciliation/payable',
    title: '供应商对账',
    permission: PERMISSIONS.REPORT_VIEW,
    componentKey: 'ReconciliationPayablePage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '财务', section: '对账', order: 30 },
    aliases: ['/reports/reconciliation'],
  },
  {
    path: '/reports/reconciliation/receivable',
    title: '客户对账',
    permission: PERMISSIONS.REPORT_VIEW,
    componentKey: 'ReconciliationReceivablePage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '财务', section: '对账', order: 40 },
  },
  {
    path: '/logistics/freight-reconciliation',
    title: '运费对账',
    permission: PERMISSIONS.LOGISTICS_FREIGHT_RECONCILE,
    componentKey: 'FreightReconciliationPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '财务', section: '对账', order: 45 },
  },
  {
    path: '/finance/dashboard',
    title: '资金看板',
    permission: PERMISSIONS.FINANCE_ACCOUNT_VIEW,
    componentKey: 'FinanceDashboardPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '财务', section: '资金', order: 50 },
  },
  {
    path: '/finance/accounts',
    title: '账户管理',
    permission: PERMISSIONS.FINANCE_ACCOUNT_VIEW,
    componentKey: 'FinanceAccountsPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '财务', section: '资金', order: 55 },
  },
  {
    path: '/finance/transactions',
    title: '资金流水',
    permission: PERMISSIONS.FINANCE_ACCOUNT_VIEW,
    componentKey: 'FinanceTransactionsPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '财务', section: '资金', order: 57 },
  },
  {
    path: '/finance/expenses',
    title: '费用报销',
    permission: PERMISSIONS.FINANCE_EXPENSE_VIEW,
    componentKey: 'ExpenseClaimsPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '财务', section: '费用', order: 60 },
  },
  {
    path: '/finance/expense-categories',
    title: '费用类别',
    permission: PERMISSIONS.FINANCE_EXPENSE_VIEW,
    componentKey: 'ExpenseCategoriesPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '财务', section: '费用', order: 70 },
  },

  // ── 会计 ──────────────────────────────────────────────
  {
    path: '/accounting/accounts',
    title: '会计科目表',
    permission: PERMISSIONS.ACCOUNTING_ACCOUNT_VIEW,
    componentKey: 'AcctAccountsPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '会计', section: '科目', order: 10 },
  },
  {
    path: '/accounting/vouchers',
    title: '记账凭证',
    permission: PERMISSIONS.ACCOUNTING_VOUCHER_VIEW,
    componentKey: 'AcctVouchersPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '会计', section: '凭证', order: 20 },
  },
  {
    path: '/accounting/ledger',
    title: '总账 / 试算平衡',
    permission: PERMISSIONS.ACCOUNTING_LEDGER_VIEW,
    componentKey: 'AcctLedgerPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '会计', section: '账簿报表', order: 30 },
  },
  {
    path: '/accounting/reports',
    title: '会计报表',
    permission: PERMISSIONS.ACCOUNTING_LEDGER_VIEW,
    componentKey: 'AcctReportsPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '会计', section: '账簿报表', order: 40 },
  },
  {
    path: '/accounting/invoices',
    title: '发票管理',
    permission: PERMISSIONS.INVOICE_VIEW,
    componentKey: 'AcctInvoicesPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '会计', section: '发票税务', order: 50 },
  },
  {
    path: '/refunds',
    title: '退货退款单',
    permission: PERMISSIONS.REFUND_ORDER_VIEW,
    componentKey: 'RefundsPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    // 退款单锁 payment_records/写 payment_entries/刷新对账单投影,是销售退货的钱侧配套
    //（退货冲减账款负余额的前置）——归资金往来,不属发票税务
    nav: { kind: 'menu', group: '财务', section: '往来账款', order: 25 },
  },
  {
    path: '/accounting/periods',
    title: '会计期间 / 期末结转',
    permission: PERMISSIONS.ACCOUNTING_LEDGER_VIEW,
    componentKey: 'AcctPeriodsPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '会计', section: '结账', order: 60 },
  },
  {
    path: '/accounting/fixed-assets',
    title: '固定资产',
    permission: PERMISSIONS.ACCOUNTING_LEDGER_VIEW,
    componentKey: 'FixedAssetsPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '会计', section: '固定资产', order: 70 },
  },
  {
    path: '/accounting/consolidation',
    title: '合并报表 / 账套',
    permission: PERMISSIONS.ACCOUNTING_LEDGER_VIEW,
    componentKey: 'AcctConsolidationPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '会计', section: '合并报表', order: 80 },
  },
  {
    path: '/accounting/tax',
    title: '报税数据',
    permission: PERMISSIONS.ACCOUNTING_LEDGER_VIEW,
    componentKey: 'AcctTaxPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '会计', section: '发票税务', order: 90 },
  },

  // ── 报表 ──────────────────────────────────────────────
  {
    path: '/reports',
    title: '报表中心',
    permission: PERMISSIONS.REPORT_VIEW,
    componentKey: 'ReportsPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '报表', section: '经营分析', order: 10 },
  },
  {
    path: '/reports/profit-analysis',
    title: '报表中心',
    permission: PERMISSIONS.REPORT_VIEW,
    componentKey: 'ProfitAnalysisPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '报表', section: '经营分析', order: 20 },
  },
  {
    path: '/reports/avg-cost-reconciliation',
    title: '成本对账',
    permission: PERMISSIONS.REPORT_VIEW,
    componentKey: 'AvgCostReconciliationPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '报表', section: '库存分析', order: 30 },
  },
  {
    path: '/reports/kpi',
    title: '报表中心',
    permission: PERMISSIONS.REPORT_VIEW,
    componentKey: 'KpiPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '报表', section: '经营分析', order: 15 },
  },
  {
    path: '/reports/replenishment',
    title: '采购建议',
    permission: PERMISSIONS.REPORT_VIEW,
    componentKey: 'ReplenishmentPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '采购', section: '采购作业', order: 6 },
  },
  {
    path: '/reports/inventory-aging',
    title: '存放时长与滞销',
    permission: PERMISSIONS.REPORT_VIEW,
    componentKey: 'InventoryAgingPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '报表', section: '经营分析', order: 27 },
  },
  {
    path: '/reports/warehouse-ops',
    title: '仓库运营',
    permission: PERMISSIONS.REPORT_VIEW,
    componentKey: 'WarehouseOpsPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '报表', section: '仓储绩效', order: 30 },
  },
  {
    path: '/reports/wave-performance',
    title: '仓库运营',
    permission: PERMISSIONS.REPORT_VIEW,
    componentKey: 'WavePerformancePage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '报表', section: '仓储绩效', order: 40 },
  },
  {
    path: '/reports/pda-anomaly',
    title: '仓库运营',
    permission: PERMISSIONS.REPORT_VIEW,
    componentKey: 'PdaAnomalyPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '报表', section: '仓储绩效', order: 50 },
  },
  {
    path: '/reports/role-workbench',
    title: '待办中心',
    permission: PERMISSIONS.REPORT_VIEW,
    componentKey: 'RoleWorkbenchPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '审批中心', order: 5 },
    // 后端报表/通知接口返回的「异常工作台」path（reports.query.js / reports.metrics.js）
    // 前端从未注册该页面，归一到待办中心（待办/异常聚合入口，语义一致），避免死链
    aliases: ['/reports/exception-workbench'],
  },

  // ── 打印 ──────────────────────────────────────────────
  {
    path: '/settings/print-templates',
    title: '打印模板',
    permission: PERMISSIONS.PRINT_TEMPLATE_VIEW,
    componentKey: 'PrintTemplatesPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '系统', section: '打印', order: 55 },
  },
  {
    path: '/settings/printers',
    title: '打印机管理',
    permission: PERMISSIONS.PRINT_PRINTER_VIEW,
    componentKey: 'PrintersPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '系统', section: '打印', order: 60 },
  },
  {
    path: '/settings/barcode-print-query',
    title: '条码打印查询',
    permission: PERMISSIONS.PRINT_JOB_VIEW,
    componentKey: 'BarcodePrintQueryPage',
    keepAlive: true,
    tabIdentity: { kind: 'full-url' },
    nav: { kind: 'menu', group: '系统', section: '打印', order: 65 },
  },

  // ── 系统 ──────────────────────────────────────────────
  {
    path: '/approvals/pending',
    title: '待我审批',
    permission: PERMISSIONS.APPROVAL_TASK_VIEW,
    componentKey: 'ApprovalPendingPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '审批中心', order: 10 },
  },
  {
    path: '/approvals/flows',
    title: '审批流配置',
    permission: PERMISSIONS.APPROVAL_FLOW_MANAGE,
    componentKey: 'ApprovalFlowsPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '审批中心', order: 20 },
  },
  {
    path: '/departments',
    title: '部门管理',
    permission: PERMISSIONS.DEPARTMENT_VIEW,
    componentKey: 'DepartmentsPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '系统', section: '用户与权限', order: 5 },
  },
  {
    path: '/users',
    title: '用户管理',
    permission: PERMISSIONS.USER_VIEW,
    componentKey: 'UsersPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '系统', section: '用户与权限', order: 10 },
  },
  {
    path: '/permissions',
    title: '权限管理',
    permission: PERMISSIONS.ROLE_VIEW,
    componentKey: 'PermissionsPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '系统', section: '用户与权限', order: 20 },
  },
  {
    path: '/settings/pda-devices',
    title: 'PDA 设备',
    permission: PERMISSIONS.PDA_DEVICE_VIEW,
    componentKey: 'PdaDevicesPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '系统', section: '设备与设置', order: 30 },
  },
  {
    path: '/settings',
    title: '系统设置',
    permission: PERMISSIONS.SETTINGS_VIEW,
    componentKey: 'SettingsPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '系统', section: '设备与设置', order: 40 },
  },
  {
    path: '/oplogs',
    title: '操作日志',
    permission: PERMISSIONS.AUDIT_LOG_VIEW,
    componentKey: 'OplogsPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    nav: { kind: 'menu', group: '系统', section: '审计', order: 50 },
  },
]

export const routePatterns: RoutePatternEntry[] = [
  {
    pattern: /^\/logistics\/\d+$/,
    title: (path) => `运单 #${path.split('/').pop()}`,
    permission: PERMISSIONS.LOGISTICS_VIEW,
    componentKey: 'LogisticsDetailPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    listPath: '/logistics',
  },
  {
    pattern: /^\/products\/(new|\d+)$/,
    title: (path) => path === '/products/new' ? '新增商品' : `编辑商品 #${path.split('/').pop()}`,
    permission: PERMISSIONS.PRODUCT_VIEW,
    componentKey: 'ProductFormPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    listPath: '/products',
  },
  {
    pattern: /^\/sale\/(new|\d+)$/,
    title: (path) => path === '/sale/new' ? '新建销售单' : `销售单 #${path.split('/').pop()}`,
    permission: PERMISSIONS.SALE_ORDER_VIEW,
    componentKey: 'SaleFormPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    listPath: '/sale',
  },
  {
    pattern: /^\/purchase\/(new|\d+)$/,
    title: (path) => path === '/purchase/new' ? '新建采购单' : `采购订单 #${path.split('/').pop()}`,
    permission: PERMISSIONS.PURCHASE_ORDER_VIEW,
    componentKey: 'PurchaseFormPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    listPath: '/purchase',
  },
  {
    pattern: /^\/procurement\/\d+$/,
    title: (path) => `采购计划 #${path.split('/').pop()}`,
    permission: PERMISSIONS.PROCUREMENT_PLAN_VIEW,
    componentKey: 'ProcurementPlanDetailPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    listPath: '/procurement',
  },
  {
    pattern: /^\/purchase-requisitions\/(new|\d+)$/,
    title: (path) => path === '/purchase-requisitions/new' ? '新建采购申请单' : `采购申请单 #${path.split('/').pop()}`,
    permission: PERMISSIONS.PURCHASE_REQUISITION_VIEW,
    componentKey: 'RequisitionFormPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    listPath: '/purchase-requisitions',
  },
  {
    pattern: /^\/transfer\/(new|\d+)$/,
    title: (path) => path === '/transfer/new' ? '新建调拨单' : `调拨单 #${path.split('/').pop()}`,
    permission: PERMISSIONS.TRANSFER_ORDER_VIEW,
    componentKey: 'TransferFormPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    listPath: '/transfer',
  },
  {
    pattern: /^\/returns\/purchase\/(new|\d+)$/,
    title: (path) => path === '/returns/purchase/new' ? '新建采购退货单' : `采购退货单 #${path.split('/').pop()}`,
    permission: PERMISSIONS.RETURN_ORDER_VIEW,
    componentKey: 'PurchaseReturnFormPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    listPath: '/returns/purchase',
  },
  {
    pattern: /^\/returns\/sale\/(new|\d+)$/,
    title: (path) => path === '/returns/sale/new' ? '新建销售退货单' : `销售退货单 #${path.split('/').pop()}`,
    permission: PERMISSIONS.RETURN_ORDER_VIEW,
    componentKey: 'SaleReturnFormPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    listPath: '/returns/sale',
  },
  {
    pattern: /^\/inbound-tasks\/new$/,
    title: () => '新建收货订单',
    permission: PERMISSIONS.INBOUND_ORDER_VIEW,
    componentKey: 'InboundTaskCreatePage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    listPath: '/inbound-tasks',
  },
  {
    pattern: /^\/inbound-tasks\/\d+$/,
    title: (path) => `收货订单 #${path.split('/').pop()}`,
    permission: PERMISSIONS.INBOUND_ORDER_VIEW,
    componentKey: 'InboundTaskDetailPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    listPath: '/inbound-tasks',
  },
  {
    pattern: /^\/settings\/print-templates\/(new|\d+)$/,
    title: (path) => path.endsWith('/new') ? '新建打印模板' : '编辑打印模板',
    permission: PERMISSIONS.PRINT_TEMPLATE_VIEW,
    componentKey: 'PrintTemplateEditorPage',
    keepAlive: true,
    tabIdentity: pathnameIdentity,
    listPath: '/settings/print-templates',
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


export function resolveRouteTabIdentity(path: string): RouteTabIdentity | undefined {
  return getRouteByPath(path)?.tabIdentity ?? getRoutePatternByPath(path)?.tabIdentity
}

/** 详情/表单路由所属的列表页路径；关闭该标签时应回到这里，而非任意相邻标签 */
export function getRouteListPath(path: string): string | undefined {
  return getRoutePatternByPath(path)?.listPath
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

export function buildTopNavSections(can: (permission: PermCode) => boolean = () => true): TopNavSection[] {
  const seenGroups = new Set<string>()
  const links: Array<TopNavSection & { order: number }> = []
  /** group → section 标题（'' 表示无标题段）→ 子项 */
  const groups = new Map<string, Map<string, Array<NavChildItem & { order: number }>>>()

  for (const route of routeRegistry) {
    if (!route.nav || !can(route.permission)) continue
    const mergedGroup = getMergedPageGroup(route.path)
    if (mergedGroup) {
      if (seenGroups.has(mergedGroup.key)) continue
      seenGroups.add(mergedGroup.key)
    }
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

    const sectionsOfGroup = groups.get(route.nav.group) ?? new Map()
    const sectionKey = route.nav.section ?? ''
    const items = sectionsOfGroup.get(sectionKey) ?? []
    items.push({
      label: route.nav.label ?? route.title,
      path: route.path,
      perm: route.permission,
      iconKey: route.nav.iconKey,
      order: route.nav.order,
    })
    sectionsOfGroup.set(sectionKey, items)
    groups.set(route.nav.group, sectionsOfGroup)
  }

  const menus: Array<TopNavSection & { order: number }> = Array.from(groups.entries()).map(
    ([label, sectionsOfGroup]) => {
      const sections: NavMenuSection[] = Array.from(sectionsOfGroup.entries())
        .map(([sectionLabel, items]) => {
          const sorted = [...items].sort((a, b) => a.order - b.order)
          return {
            label: sectionLabel || undefined,
            items: sorted.map(({ order: _order, ...item }) => item),
            // 段序取段内最小 order：同一 group 的 order 连续递增，故与书写顺序一致
            order: sorted[0].order,
          }
        })
        .sort((a, b) => a.order - b.order)
        .map(({ order: _order, ...section }) => section)

      return {
        kind: 'menu',
        label,
        sections,
        children: sections.flatMap((section) => section.items),
        order: NAV_GROUP_ORDER[label] ?? UNREGISTERED_GROUP_ORDER,
      }
    }
  )

  return [...links, ...menus]
    .sort((a, b) => a.order - b.order)
    .map(({ order: _order, ...section }) => section)
}
