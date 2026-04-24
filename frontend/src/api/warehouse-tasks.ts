import { payloadClient as client } from './client'
import type { PaginatedData } from '@/types'
import { withRequestKeyHeaders } from '@/lib/requestKey'
import { WT_STATUS_NAME, WT_STATUS_CLASS, type WtStatus } from '@/constants/warehouseTaskStatus'

export type TaskStatus = WtStatus
export type TaskPriority = 1 | 2 | 3

export const TASK_STATUS_LABEL = WT_STATUS_NAME
export const TASK_STATUS_COLOR = WT_STATUS_CLASS
export const PRIORITY_LABEL: Record<TaskPriority, string> = { 1: '紧急', 2: '普通', 3: '低' }
export const PRIORITY_COLOR: Record<TaskPriority, string> = {
  1: 'bg-red-100 text-red-700', 2: 'bg-blue-50 text-blue-600', 3: 'bg-gray-50 text-gray-500',
}

export interface WarehouseTaskItem {
  id: number
  productId: number
  productCode: string
  productName: string
  unit: string
  requiredQty: number
  pickedQty: number
}

export interface WarehouseTask {
  id: number
  taskNo: string
  saleOrderId: number
  saleOrderNo: string
  customerId: number
  customerName: string
  warehouseId: number
  warehouseName: string
  status: TaskStatus
  statusName: string
  priority: TaskPriority
  priorityName: string
  assignedTo: number | null
  assignedName: string | null
  expectedShipDate: string | null
  remark: string | null
  shippedAt: string | null
  createdAt: string
  updatedAt: string
  packageSummary?: {
    totalPackages: number
    openPackages: number
    donePackages: number
    totalItems: number
  }
  printSummary?: {
    totalPackages: number
    successCount: number
    failedCount: number
    timeoutCount: number
    processingCount: number
    recentError: string | null
    recentPrinter: string | null
  }
  items?: WarehouseTaskItem[]
}

export interface MyTask {
  id: number
  taskNo: string
  customerName: string
  warehouseName: string
  status: TaskStatus
  statusName: string
  priority: TaskPriority
  priorityName: string
  assignedTo: number | null
  assignedName: string | null
  itemCount: number
  totalRequired: number
  totalPicked: number
  createdAt: string
}

export interface PdaTaskSkuSummary {
  productId: number
  productCode: string
  productName: string
  unit: string
  totalRequired: number
  totalPicked: number
  orderCount: number
  taskIds: number[]
}

export interface WarehouseTaskStats {
  picking: number
  sorting: number
  checking: number
  packing: number
  shipping: number
  done: number
  urgent: number
}

export const getMyTasksApi = () =>
  client.get<MyTask[]>('/warehouse-tasks/my')

export const getMyTaskSkuSummaryApi = () =>
  client.get<PdaTaskSkuSummary[]>('/warehouse-tasks/my-sku-summary')

export const getTaskStatsApi = () =>
  client.get<WarehouseTaskStats>('/warehouse-tasks/stats')

export type TaskListParams = {
  page?: number; pageSize?: number; keyword?: string; status?: number; warehouseId?: number
}

export const getTasksApi = (params: TaskListParams) =>
  client.get<PaginatedData<WarehouseTask>>('/warehouse-tasks', { params })

export const getTaskByIdApi = (id: number) =>
  client.get<WarehouseTask>(`/warehouse-tasks/${id}`)

export const assignTaskApi = (id: number, userId: number, userName: string) =>
  client.put(`/warehouse-tasks/${id}/assign`, { userId, userName })

export const startPickingApi = (id: number) =>
  client.put(`/warehouse-tasks/${id}/start-picking`, {}, { headers: { 'X-Client': 'pda' } })

export const readyToShipApi = (id: number, requestKey?: string) =>
  client.put(`/warehouse-tasks/${id}/ready`, {}, {
    headers: requestKey
      ? withRequestKeyHeaders(requestKey, { 'X-Client': 'pda' })
      : { 'X-Client': 'pda' },
  })

export const sortDoneApi = (id: number, items?: { itemId: number; sortedQty: number }[], requestKey?: string) =>
  client.put(`/warehouse-tasks/${id}/sort-done`, { items: items ?? null }, {
    headers: requestKey
      ? withRequestKeyHeaders(requestKey, { 'X-Client': 'pda' })
      : { 'X-Client': 'pda' },
  })

export const checkDoneApi = (id: number) =>
  client.put(`/warehouse-tasks/${id}/check-done`, {}, {
    headers: { 'X-Client': 'pda' },
    skipGlobalError: true,
  })

export const packDoneApi = (id: number, requestKey?: string) =>
  client.put(`/warehouse-tasks/${id}/pack-done`, {}, {
    headers: requestKey
      ? withRequestKeyHeaders(requestKey, { 'X-Client': 'pda' })
      : { 'X-Client': 'pda' },
  })

export const shipTaskApi = (id: number, requestKey?: string) =>
  client.put(`/warehouse-tasks/${id}/ship`, {}, {
    headers: requestKey
      ? withRequestKeyHeaders(requestKey, { 'X-Client': 'pda' })
      : { 'X-Client': 'pda' },
  })

export const cancelTaskApi = (id: number) =>
  client.put(`/warehouse-tasks/${id}/cancel`)

export const updateTaskPriorityApi = (id: number, priority: number) =>
  client.put(`/warehouse-tasks/${id}/priority`, { priority })

// ── 推荐拣货容器 ─────────────────────────────────────────────────────────────

export interface PickSuggestionContainer {
  containerId: number
  barcode: string
  containerKind?: 'inventory' | 'plastic_box'
  locationCode: string | null
  remainingQty: number
  locked: boolean
}

export interface PickSuggestionItem extends WarehouseTaskItem {
  remaining: number
  suggestions: PickSuggestionContainer[]
}

export interface PickSuggestionsData {
  taskId: number
  taskNo: string
  items: PickSuggestionItem[]
}

export const getPickSuggestionsApi = (taskId: number) =>
  client.get<PickSuggestionsData>(`/warehouse-tasks/${taskId}/pick-suggestions`)

// ── 拣货路线 ─────────────────────────────────────────────────────────────────

export interface PickRouteStep {
  step: number
  itemId: number
  productName: string
  productCode: string
  unit: string
  containerId: number
  barcode: string
  locationCode: string | null
  qty: number
  locked: boolean
}

export interface PickRouteData {
  taskId: number
  taskNo: string
  totalSteps: number
  route: PickRouteStep[]
}

export const getPickRouteApi = (taskId: number) =>
  client.get<PickRouteData>(`/warehouse-tasks/${taskId}/pick-route`)

// ── 复核（须扫描容器，禁止手填明细）──────────────────────────────────────────

/** 复核扫码：确认本任务拣货时扫过的容器 */
export const submitCheckScanApi = (taskId: number, barcode: string, requestKey?: string) =>
  client.post<{ id: number; allChecked: boolean; itemId: number; qty: number }>(
    '/scan-logs/check',
    { taskId, barcode },
    {
      headers: requestKey
        ? withRequestKeyHeaders(requestKey, { 'X-Client': 'pda' })
        : { 'X-Client': 'pda' },
    },
  )
