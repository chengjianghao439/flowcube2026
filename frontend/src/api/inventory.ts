import type { AxiosRequestConfig } from 'axios'
import type { ProcurementSupply } from './procurement-supply'
import { payloadClient as apiClient } from './client'
import { withRequestKeyHeaders } from '@/lib/requestKey'
import type { PaginatedData, QueryParams } from '@/types'
import type { StockItem, InventoryLog, StockChangeParams, InventoryOverviewParams, InventoryOverviewResult, InventoryContainer } from '@/types/inventory'
import type { InventoryReservationParams, InventoryReservationsResult } from '@/types/inventory'

export const getInventoryReservationsApi = (params: InventoryReservationParams, config?: AxiosRequestConfig) =>
  apiClient.get<InventoryReservationsResult>('/inventory/reservations', { ...config, params, listMode: 'paged', skipGlobalError: true })

export const getStockApi    = async (p: QueryParams) => apiClient.get<PaginatedData<StockItem>>('/inventory/stock', { params: p })
export const getLogsApi     = async (p: QueryParams, signal?: AbortSignal) => apiClient.get<PaginatedData<InventoryLog>>('/inventory/logs', { params: p, signal })

/** 修复缓存漂移（成本对账页按钮）：仅重算存在漂移的 SKU+仓库,返回修复明细 */
export const resyncStockApi = async () => apiClient.post<{ ok: boolean; fixed: number; total: number; rows: Array<{ productId: number; warehouseId: number; before: number; after: number }> }>('/inventory/resync-stock')
// 手动出库是 changeStock 唯一还活着的分支（inbound/adjust 后端已 403 关闭，见
// inventory.service.js 的 type !== 2 分支），其幂等键由后端 extractRequestKey 消费，
// 故此处必须带 X-Request-Key，否则网络重试会重复扣减容器库存（2026-09-26 一致性审查 · 任务 4）。
export const outboundApi    = async (d: StockChangeParams, requestKey?: string) =>
  apiClient.post<unknown>('/inventory/outbound', d, requestKey ? { headers: withRequestKeyHeaders(requestKey) } : undefined)

export const getInventoryOverviewApi = async (p: InventoryOverviewParams, signal?: AbortSignal) =>
  apiClient.get<InventoryOverviewResult>('/inventory/overview', { params: p, signal })

export const getInventoryContainersApi = async (productId: number, warehouseId: number | null) =>
  apiClient.get<InventoryContainer[]>('/inventory/containers', {
    params: { productId, ...(warehouseId ? { warehouseId } : {}) },
  })

export interface ContainerLogItem {
  qty: number
  type: number
  moveType: number | null
  moveTypeName: string | null
  remark: string | null
  refType: string | null
  refNo: string | null
  operatorName: string | null
  productName: string | null
  createdAt: string
}

/** 单容器流水（库存条码/塑料盒通用），个体条码的追溯时间线 */
export const getContainerLogsApi = async (containerId: number) =>
  apiClient.get<ContainerLogItem[]>(`/inventory/containers/${containerId}/logs`)

export const getContainerByBarcodeApi = async (barcode: string, config?: Parameters<typeof apiClient.get>[1]) =>
  apiClient.get<{
    containerId: number; barcode: string; productId: number; productCode: string
    productName: string; warehouseId: number; warehouseName: string
    locationId: number | null; locationCode: string | null
    remainingQty: number; unit: string
    containerKind?: 'inventory' | 'plastic_box'
    containerStatus?: 'waiting_putaway' | 'stored'
    lockedByTaskId?: number | null   // 非空=已被拣货任务锁定，不可拆分（拆分须在拣货前完成）
    lockedByTaskNo?: string | null
    individual?: boolean             // 单件库存条码（一件一码）：不可拆分/并货
    inboundTaskId?: number | null
  }>(`/inventory/containers/barcode/${encodeURIComponent(barcode)}`, config)

// ─── PDA 只读库存查询（无副作用）──────────────────────────────────────────

export interface InventoryQueryContainer {
  containerId: number
  barcode: string
  productId: number
  productCode: string
  productName: string
  warehouseId: number
  warehouseName: string
  locationId: number | null
  locationCode: string | null
  batchNo: string | null
  mfgDate: string | null
  expDate: string | null
  remainingQty: number
  unit: string | null
  containerKind: 'inventory' | 'plastic_box'
  containerStatus: 'waiting_putaway' | 'stored'
  individual: boolean
  lockedByTaskId: number | null
  lockedByTaskNo: string | null
  isLegacy?: boolean
  remark?: string | null
}

export const queryInventoryByBarcodeApi = async (barcode: string) =>
  apiClient.get<InventoryQueryContainer[]>(`/inventory/query-by-barcode`, {
    params: { barcode },
    skipGlobalError: true,
  })

export interface InventoryQueryByProductResult {
  productId: number
  productCode: string
  productName: string
  unit: string | null
  containers: Array<{
    containerId: number
    barcode: string
    warehouseId: number
    warehouseName: string
    locationCode: string | null
    batchNo: string | null
    mfgDate: string | null
    expDate: string | null
    remainingQty: number
    containerKind: 'inventory' | 'plastic_box'
    individual: boolean
    lockedByTaskId: number | null
    lockedByTaskNo: string | null
  }>
}

export const queryInventoryByProductApi = async (productId: number, warehouseId?: number | null) =>
  apiClient.get<InventoryQueryByProductResult>(`/inventory/query-by-product`, {
    params: { productId, ...(warehouseId ? { warehouseId } : {}) },
  })

export interface SplitContainerResult {
  sourceContainerId: number
  sourceBarcode: string
  sourceRemainingAfter: number
  newContainerId: number
  newBarcode: string
  newContainerKind?: 'inventory' | 'plastic_box'
  productId: number
  warehouseId: number
  targetContainerId?: number
  targetBarcode?: string
  targetQtyAfter?: number
  printJobId?: number | null
  printJobIds?: number[]
  noPrinterCount?: number
  renderFailedCount?: number
}

export interface SplitContainerBody { qty: number; remark?: string; printLabel?: boolean; targetContainerId?: number }
export const splitContainerApi = async (
  containerId: number,
  body: SplitContainerBody,
  requestKey?: string,
  client?: 'pda',
  config?: import('axios').AxiosRequestConfig,
) =>
  apiClient.post<SplitContainerResult>(`/inventory/containers/${containerId}/split`, body, { ...config, skipGlobalError: true,
    headers: { ...config?.headers, ...(requestKey ? { 'X-Request-Key': requestKey } : {}), ...(client ? { 'X-Client': client } : {}) },
  })

// ─── 塑料盒作业流（批 A）：放货 / 还原整件 / 来源贡献 ─────────────────────────

export interface PlasticBoxFillResult {
  sourceContainerId: number
  sourceBarcode: string
  sourceRemainingAfter: number
  targetContainerId: number
  targetBarcode: string
  targetQtyAfter: number
  mixedBatch: boolean
}

/**
 * 放货：把来源整件的**全部实存**倒入指定塑料盒（不设可选数量）。
 *
 * `client` 显式声明调用方：PDA 必须传 `'pda'`（后端按「带 X-Client: pda 或缺票即拒」
 * 校验设备与设备仓）；PC 走默认，保持普通路径（权限 + 数据范围）。
 */
export const fillPlasticBoxApi = async (
  boxId: number,
  body: { sourceContainerId: number; expectedSourceQty?: number },
  requestKey: string,
  client?: 'pda',
) =>
  apiClient.post<PlasticBoxFillResult>(`/plastic-boxes/${boxId}/fill`, body, {
    skipGlobalError: true,
    headers: { 'X-Request-Key': requestKey, ...(client === 'pda' ? { 'X-Client': 'pda' } : {}) },
  })

export interface PlasticBoxRepackResult {
  boxId: number
  boxRemainingAfter: number
  created: Array<{ containerId: number; barcode: string; qty: number }>
  printJobIds: number[]
  /** 未打印：没有可用打印机 */
  noPrinterCount: number
  /** 未打印：标签渲染失败（与「无打印机」是两种不同降级） */
  renderFailedCount: number
}

/** 还原整件：人工逐箱 qty（等量时用 perBoxQty + boxCount 快捷），生成独立整件库存码 */
export const repackPlasticBoxApi = async (
  boxId: number,
  body: { perBoxQty?: number; boxCount?: number; items?: number[] },
  requestKey: string,
  client?: 'pda',
  config?: AxiosRequestConfig,
) =>
  apiClient.post<PlasticBoxRepackResult>(`/plastic-boxes/${boxId}/repack`, body, {
    ...config,
    skipGlobalError: true,
    headers: { ...config?.headers, 'X-Request-Key': requestKey, ...(client === 'pda' ? { 'X-Client': 'pda' } : {}) },
  })

export interface PlasticBoxSourcesResult {
  boxId: number
  barcode: string
  mixedBatch: boolean
  sources: Array<{
    sourceContainerId: number
    sourceBarcode: string | null
    sourceBatchNo: string | null
    contributedQty: number
  }>
}

/** 来源贡献：本盒各来源容器及其贡献量（历史贡献口径，不是当前余额，也不做逐批分摊） */
export const getPlasticBoxSourcesApi = async (boxId: number) =>
  apiClient.get<PlasticBoxSourcesResult>(`/plastic-boxes/${boxId}/sources`, { skipGlobalError: true })

// ─── 补货建议与补货策略（文档 01）──────────────────────────────────────────────

export interface ReplenishmentItem extends ProcurementSupply {
  id: string
  productId: number
  productCode: string
  productName: string
  unit: string
  articleNumber: string | null
  spec: string | null
  color: string | null
  warehouseId: number
  warehouseName: string
  onHand: number
  reserved: number
  available: number
  inTransit: number
  safetyStock: number
  reorderPoint: number
  targetStock: number
  suggestQty: number
  adu: number
  leadTimeDays: number
  suggestReorderPoint: number
}

export const getReplenishmentApi = async (p: { page?: number; pageSize?: number; keyword?: string; warehouseId?: number | null; categoryId?: number | null }) =>
  apiClient.get<PaginatedData<ReplenishmentItem>>('/inventory/replenishment', { params: p })

/** 保存补货策略（warehouseId=0 表示通用默认）；采纳「建议补货点」时调用 */
export const saveStockPoliciesApi = async (items: Array<{ productId: number; warehouseId: number; safetyStock?: number; reorderPoint?: number; targetStock?: number | null }>) =>
  apiClient.put<{ saved: number; deleted: number }>('/inventory/stock-policies', { items })

// ─── 存放时长与滞销报表（文档 09）──────────────────────────────────────────────────

export interface AgingBucket { bucket: string; skuCount: number; totalQty: number; totalValue: number }
export interface AgingItem {
  id: string
  productId: number; productCode: string; productName: string; unit: string
  articleNumber: string | null; spec: string | null; color: string | null
  warehouseId: number; warehouseName: string
  qty0_30: number; qty30_60: number; qty60_90: number; qty90p: number
  totalQty: number; avgAgeDays: number; maxAgeDays: number; totalValue: number
  lastOutboundAt: string | null; daysSinceOutbound: number | null; isStale: boolean
}
export interface InventoryAgingReport {
  buckets: AgingBucket[]
  list: AgingItem[]
  pagination: { page: number; pageSize: number; total: number }
  staleDays: number
}
export interface ExpiryAlert {
  id: string
  productId: number; productCode: string; productName: string; unit: string
  articleNumber: string | null; spec: string | null; color: string | null
  warehouseId: number; warehouseName: string
  batchNo: string | null; expDate: string | null; remainingQty: number
  daysToExpiry: number | null; expiryState: 'expired' | 'near_expiry' | 'ok'
}

export const getInventoryAgingApi = (p: { page?: number; pageSize?: number; keyword?: string; warehouseId?: number | null; staleDays?: number }) =>
  apiClient.get<InventoryAgingReport>('/inventory/aging', { params: p })

export const getExpiryAlertsApi = (p: { warehouseId?: number | null; warnDays?: number }) =>
  apiClient.get<{ warnDays: number; list: ExpiryAlert[] }>('/inventory/aging/expiry', { params: p })

// ─── 库存初始化导入（POST /import/stock）────────────────────────────────────────────────

// 注意：后端 importStock 返回的 errors 是字符串数组（每项已是完整文案"第N行：..."），
// 不是 {row, message} 对象——旧类型声明成对象导致前端 map(e=>e.row) 取到 undefined（静默错）。
export interface ImportStockResult {
  success: number
  errors: string[]
}

export const importStockApi = (file: File) => {
  const form = new FormData()
  form.append('file', file)
  return apiClient.post<ImportStockResult>('/import/stock', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    // 导入失败时拦截器会弹全局 toast，这里只需页面 catch 兜底一次，避免双重弹窗
    skipGlobalError: true,
    timeout: 60_000,
  })
}
