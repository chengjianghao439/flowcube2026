import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import * as definitions from './routeDefinitions'
export * from './routeDefinitions'

export type RouteComponent = LazyExoticComponent<ComponentType>
export type RouteRegistryEntry = definitions.RouteRegistryEntry & { component: RouteComponent }
export type RoutePatternEntry = definitions.RoutePatternEntry & { component: RouteComponent }

const mergedPage = lazy(() => import('@/components/shared/MergedPage'))

// 仅 ERP 渲染入口加载页面；工作区元数据不再把所有页面带入 PDA。
const components: Record<definitions.RouteComponentKey, RouteComponent> = {
  DashboardPage: lazy(() => import('@/pages/dashboard')),
  SalePage: lazy(() => import('@/pages/sale')),
  SaleFormPage: lazy(() => import('@/pages/sale/form')),
  PurchasePage: lazy(() => import('@/pages/purchase')),
  PurchaseFormPage: lazy(() => import('@/pages/purchase/form')),
  RequisitionsPage: lazy(() => import('@/pages/purchase-requisitions')),
  RequisitionFormPage: lazy(() => import('@/pages/purchase-requisitions/form')),
  ProductPage: lazy(() => import('@/pages/products')),
  PriceChangePage: lazy(() => import('@/pages/price-change')),
  ProductFormPage: lazy(() => import('@/pages/products/form')),
  CategoryPage: lazy(() => import('@/pages/categories')),
  WarehouseStructurePage: lazy(() => import('@/pages/warehouse-structure')),
  InventoryPage: lazy(() => import('@/pages/inventory')),
  InventoryTracePage: lazy(() => import('@/pages/inventory/trace')),
  PlasticBoxesPage: lazy(() => import('@/pages/plastic-boxes')),
  StockcheckPage: lazy(() => import('@/pages/stockcheck')),
  AbcClassPage: lazy(() => import('@/pages/stockcheck/abc')),
  DisposalPage: lazy(() => import('@/pages/disposal')),
  ProcurementPlanListPage: mergedPage,
  ProcurementPlanDetailPage: lazy(() => import('@/pages/procurement/detail')),
  TransferPage: lazy(() => import('@/pages/transfer')),
  TransferFormPage: lazy(() => import('@/pages/transfer/form')),
  InboundTasksPage: lazy(() => import('@/pages/inbound-tasks')),
  InboundTaskCreatePage: lazy(() => import('@/pages/inbound-tasks/create')),
  InboundTaskDetailPage: lazy(() => import('@/pages/inbound-tasks/detail')),
  PickingWavesPage: lazy(() => import('@/pages/picking-waves')),
  CustomersPage: lazy(() => import('@/pages/customers')),
  CarriersPage: lazy(() => import('@/pages/carriers')),
  CarrierAccountsPage: lazy(() => import('@/pages/carrier-accounts')),
  LogisticsPage: lazy(() => import('@/pages/logistics')),
  LogisticsDetailPage: lazy(() => import('@/pages/logistics/detail')),
  FreightReconciliationPage: lazy(() => import('@/pages/logistics/freight-reconciliation')),
  SuppliersPage: lazy(() => import('@/pages/suppliers')),
  ReturnsPage: lazy(() => import('@/pages/returns')),
  PurchaseReturnFormPage: lazy(() => import('@/pages/returns/purchase/form')),
  SaleReturnFormPage: lazy(() => import('@/pages/returns/sale/form')),
  PayablePage: lazy(() => import('@/pages/payments/payable')),
  ReceivablePage: lazy(() => import('@/pages/payments/receivable')),
  UsersPage: lazy(() => import('@/pages/users')),
  DepartmentsPage: lazy(() => import('@/pages/departments')),
  ApprovalFlowsPage: lazy(() => import('@/pages/approvals/flows')),
  ApprovalPendingPage: lazy(() => import('@/pages/approvals/pending')),
  PermissionsPage: lazy(() => import('@/pages/permissions')),
  SettingsPage: lazy(() => import('@/pages/settings')),
  BarcodePrintQueryPage: lazy(() => import('@/pages/settings/barcode-print-query')),
  OplogsPage: lazy(() => import('@/pages/oplogs')),
  ReportsPage: mergedPage,
  RoleWorkbenchPage: lazy(() => import('@/pages/reports/role-workbench')),
  FinanceDashboardPage: lazy(() => import('@/pages/finance/dashboard')),
  FinanceAccountsPage: lazy(() => import('@/pages/finance/accounts')),
  FinanceTransactionsPage: lazy(() => import('@/pages/finance/transactions')),
  ExpenseClaimsPage: lazy(() => import('@/pages/finance/expenses')),
  ExpenseCategoriesPage: lazy(() => import('@/pages/finance/expense-categories')),
  AcctAccountsPage: lazy(() => import('@/pages/accounting/accounts')),
  AcctVouchersPage: lazy(() => import('@/pages/accounting/vouchers')),
  AcctLedgerPage: lazy(() => import('@/pages/accounting/ledger')),
  AcctReportsPage: lazy(() => import('@/pages/accounting/reports')),
  AcctInvoicesPage: lazy(() => import('@/pages/accounting/invoices')),
  RefundsPage: lazy(() => import('@/pages/refunds')),
  CreditOverridesPage: lazy(() => import('@/pages/credit-overrides')),
  AcctPeriodsPage: lazy(() => import('@/pages/accounting/periods')),
  AcctConsolidationPage: lazy(() => import('@/pages/accounting/consolidation')),
  AcctTaxPage: lazy(() => import('@/pages/accounting/tax')),
  FixedAssetsPage: lazy(() => import('@/pages/fixed-assets')),
  AvgCostReconciliationPage: lazy(() => import('@/pages/reports/avg-cost-reconciliation')),
  ReconciliationPayablePage: lazy(() => import('@/pages/reports/reconciliation-payable')),
  ReconciliationReceivablePage: lazy(() => import('@/pages/reports/reconciliation-receivable')),
  ProfitAnalysisPage: mergedPage,
  KpiPage: mergedPage,
  ReplenishmentPage: mergedPage,
  InventoryAgingPage: lazy(() => import('@/pages/reports/inventory-aging')),
  WavePerformancePage: mergedPage,
  PdaAnomalyPage: mergedPage,
  WarehouseOpsPage: mergedPage,
  PrintTemplatesPage: lazy(() => import('@/pages/settings/print-templates')),
  PrintTemplateEditorPage: lazy(() => import('@/pages/settings/print-templates/editor')),
  PrintersPage: lazy(() => import('@/pages/settings/printers')),
  PdaDevicesPage: lazy(() => import('@/pages/settings/pda-devices')),
  PortalStatementsPage: lazy(() => import('@/pages/portal/statements')),
  PortalPurchaseStatusPage: lazy(() => import('@/pages/portal/purchase-status')),
}

export const routeRegistry: RouteRegistryEntry[] = definitions.routeRegistry.map(entry => ({ ...entry, component: components[entry.componentKey] }))
export const routePatterns: RoutePatternEntry[] = definitions.routePatterns.map(entry => ({ ...entry, component: components[entry.componentKey] }))
const byPath = new Map(routeRegistry.map(entry => [entry.path, entry]))
export function getRouteByPath(path: string): RouteRegistryEntry | undefined { return byPath.get(path) }
export function getRoutePatternByPath(path: string): RoutePatternEntry | undefined { return routePatterns.find(entry => entry.pattern.test(path)) }

export function resolveRouteComponent(path: string): RouteComponent | undefined {
  return getRouteByPath(path)?.component ?? getRoutePatternByPath(path)?.component
}
