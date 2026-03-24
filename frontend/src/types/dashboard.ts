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
