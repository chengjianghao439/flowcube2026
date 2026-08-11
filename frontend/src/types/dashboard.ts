export interface DashboardSummary {
  totalSkus: number
  totalQty: number
  totalValue: number
  pendingPurchaseOrders: number
  pendingSaleOrders: number
}
export interface LowStockItem { id: number; code: string; name: string; unit: string; warehouseName: string; quantity: number }
export interface TrendPoint { date: string; inbound: number; outbound: number }
export interface TopStockItem { code: string; name: string; unit: string; qty: number; value: number }
export interface IncomingPurchaseItem { id: number; orderNo: string; supplierName: string; expectedDate: string; totalAmount: number }
export interface IncomingPurchases { dueToday: IncomingPurchaseItem[]; dueThisWeek: IncomingPurchaseItem[]; overdue: IncomingPurchaseItem[] }

/** 授信预警（文档05）：dashboard 看板磁贴数据 */
export interface CreditWarning {
  totalCustomers: number
  overCount: number
  highRiskCount: number
  top: Array<{
    customerId: number
    customerName: string
    creditLimit: number
    used: number
    usageRate: number
    usageRatePct: number
    over: boolean
  }>
}

/** 单个小组件在个性化布局中的状态：注册表 id + 是否显示 + 列跨度（1–4） */
export interface DashboardWidgetLayout { id: string; visible: boolean; w: number }
/** 用户仪表盘布局：widgets 数组顺序即渲染顺序（拖拽改变） */
export interface DashboardLayout { widgets: DashboardWidgetLayout[] }
