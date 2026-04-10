import client from './client'
import type { ApiResponse } from '@/types'

export interface PurchaseStats {
  byMonth: { month: string; orderCount: number; totalAmount: number; receivedAmount: number }[]
  bySupplier: { supplierName: string; orderCount: number; totalAmount: number; receivedAmount: number }[]
  byProduct: { productName: string; totalQty: number; totalAmount: number }[]
}
export interface SaleStats {
  byMonth: { month: string; orderCount: number; totalAmount: number; shippedAmount: number }[]
  byCustomer: { customerName: string; orderCount: number; totalAmount: number }[]
  byProduct: { productName: string; totalQty: number; totalAmount: number }[]
}
export interface InventoryStats {
  turnover: { code: string; name: string; unit: string; inboundQty: number; outboundQty: number; currentQty: number }[]
  byWarehouse: { warehouseName: string; totalQty: number; totalValue: number }[]
}

const q = (p: object) => Object.entries(p).filter(([,v])=>v).map(([k,v])=>`${k}=${v}`).join('&')
export const getPurchaseStatsApi  = (p: object) => client.get<ApiResponse<PurchaseStats>>(`/reports/purchase?${q(p)}`)
export const getSaleStatsApi      = (p: object) => client.get<ApiResponse<SaleStats>>(`/reports/sale?${q(p)}`)
export const getInventoryStatsApi = (p: object) => client.get<ApiResponse<InventoryStats>>(`/reports/inventory?${q(p)}`)

export interface PdaOperator {
  operatorId: number
  operatorName: string
  scanCount: number
  pickQty: number
  avgMinutes: number | null
}

export interface PdaPerformance {
  today: { scanCount: number; pickQty: number }
  topOperator: PdaOperator | null
  operators: PdaOperator[]
  daily: { date: string; scanCount: number; pickQty: number }[]
}

export const getPdaPerformanceApi = () =>
  client.get<ApiResponse<PdaPerformance>>('/reports/pda-performance')

// ── PDA 异常分析 ──────────────────────────────────────────────────────────────
export interface PdaAnomalySummary {
  totalScans:  number
  totalErrors: number
  totalUndos:  number
  errorRate:   string
}
export interface PdaAnomalyReport {
  summary:        PdaAnomalySummary
  byOperator:     { operatorId: number; operatorName: string; errorCount: number }[]
  byReason:       { reason: string; count: number }[]
  byBarcode:      { barcode: string; count: number }[]
  undoByOperator: { operatorId: number; operatorName: string; undoCount: number }[]
  dailyTrend:     { date: string; errorCount: number }[]
}

export const getPdaAnomalyApi = (params: { startDate?: string; endDate?: string } = {}) =>
  client.get<ApiResponse<PdaAnomalyReport>>(`/scan-logs/anomaly?${q(params)}`)

// ── 仓库运营看板 ──────────────────────────────────────────────────────────────
export interface WarehouseOpsSummary {
  shippedToday: number
  pickingNow:   number
  inboundToday: number
  scanCount:    number
  pickQty:      number
  errorCount:   number
  undoCount:    number
  errorRate:    string
}
export interface OpsOperator {
  operatorId:   number
  operatorName: string
  scanCount:    number
  pickQty:      number
  errorCount:   number
  errorRate:    string
  durationMin:  number | null
  efficiency:   string | null
}
export interface FlowBottleneck {
  status: number
  label:  string
  count:  number
}
export interface WarehouseOpsData {
  summary:        WarehouseOpsSummary
  operators:      OpsOperator[]
  flowBottleneck: FlowBottleneck[]
  hourlyTrend:    { hour: string; count: number }[]
  recentErrors:   { id: number; taskId: number; barcode: string; reason: string; operatorName: string; createdAt: string }[]
}

export const getWarehouseOpsApi = () =>
  client.get<ApiResponse<WarehouseOpsData>>('/reports/warehouse-ops')

export interface WorkbenchItem {
  id: number | string
  title: string
  subtitle?: string | null
  path: string
  badge?: string | null
  hint?: string | null
  createdAt?: string | null
}
export interface WorkbenchCard {
  key: string
  title: string
  description: string
  count: number
  path: string
  actionLabel: string
  accent: 'blue' | 'amber' | 'emerald' | 'rose' | 'slate'
  items: WorkbenchItem[]
}
export interface WorkbenchSection {
  key: string
  title: string
  description: string
  cards: WorkbenchCard[]
}
export interface RoleWorkbenchData {
  summary: {
    totalAlerts: number
    warehouseCount: number
    saleCount: number
    managementCount: number
  }
  sections: WorkbenchSection[]
}

export const getRoleWorkbenchApi = () =>
  client.get<ApiResponse<RoleWorkbenchData>>('/reports/role-workbench')

export interface WaveStats {
  id: number
  waveNo: string
  status: number
  statusName: string
  taskCount: number
  operatorName: string
  createdAt: string
  skuCount: number
  totalRequiredQty: number
  totalPickedQty: number
  totalSteps: number
  completedSteps: number
  lastPickAt: string | null
  durationMinutes: number | null
  efficiency: number | null
}

export interface WavePerformance {
  summary: {
    totalWaves: number
    completedWaves: number
    avgDurationMinutes: number | null
    avgSkuCount: number | null
    totalPickedQty: number
  }
  waves: WaveStats[]
}

export const getWavePerformanceApi = (params: { startDate?: string; endDate?: string } = {}) =>
  client.get<ApiResponse<WavePerformance>>(`/reports/wave-performance?${q(params)}`)
