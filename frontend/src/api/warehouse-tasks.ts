import client from './client'
import type { ApiResponse, PaginatedData } from '@/types'

export type TaskStatus = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
export type TaskPriority = 1 | 2 | 3

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  1: '待拣货', 2: '拣货中', 3: '待分拣', 4: '待复核', 5: '待打包', 6: '待出库', 7: '已出库', 8: '已取消',
}
export const TASK_STATUS_COLOR: Record<TaskStatus, string> = {
  1: 'bg-gray-100 text-gray-600',
  2: 'bg-blue-100 text-blue-700',
  3: 'bg-yellow-100 text-yellow-700',
  4: 'bg-purple-100 text-purple-700',
  5: 'bg-orange-100 text-orange-700',
  6: 'bg-cyan-100 text-cyan-700',
  7: 'bg-green-100 text-green-700',
  8: 'bg-red-100 text-red-600',
}
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

export const getMyTasksApi = () =>
  client.get<ApiResponse<MyTask[]>>('/warehouse-tasks/my')

export type TaskListParams = {
  page?: number; pageSize?: number; keyword?: string; status?: number; warehouseId?: number
}

export const getTasksApi = (params: TaskListParams) =>
  client.get<ApiResponse<PaginatedData<WarehouseTask>>>('/warehouse-tasks', { params })

export const getTaskByIdApi = (id: number) =>
  client.get<ApiResponse<WarehouseTask>>(`/warehouse-tasks/${id}`)

export const assignTaskApi = (id: number, userId: number, userName: string) =>
  client.put(`/warehouse-tasks/${id}/assign`, { userId, userName })

export const startPickingApi = (id: number) =>
  client.put(`/warehouse-tasks/${id}/start-picking`, {}, { headers: { 'X-Client': 'pda' } })

export const readyToShipApi = (id: number) =>
  client.put(`/warehouse-tasks/${id}/ready`, {}, { headers: { 'X-Client': 'pda' } })

export const sortDoneApi = (id: number, items?: { itemId: number; sortedQty: number }[]) =>
  client.put(`/warehouse-tasks/${id}/sort-done`, { items: items ?? null }, { headers: { 'X-Client': 'pda' } })

export const checkDoneApi = (id: number) =>
  client.put(`/warehouse-tasks/${id}/check-done`, {}, {
    headers: { 'X-Client': 'pda' },
    skipGlobalError: true,
  })

export const packDoneApi = (id: number) =>
  client.put(`/warehouse-tasks/${id}/pack-done`, {}, { headers: { 'X-Client': 'pda' } })

export const shipTaskApi = (id: number) =>
  client.put(`/warehouse-tasks/${id}/ship`, {}, { headers: { 'X-Client': 'pda' } })

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
  client.get<ApiResponse<PickSuggestionsData>>(`/warehouse-tasks/${taskId}/pick-suggestions`)

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
  client.get<ApiResponse<PickRouteData>>(`/warehouse-tasks/${taskId}/pick-route`)

// ── 复核（须扫描容器，禁止手填明细）──────────────────────────────────────────

/** 复核扫码：确认本任务拣货时扫过的容器 */
export const submitCheckScanApi = (taskId: number, barcode: string) =>
  client.post<ApiResponse<{ id: number; allChecked: boolean; itemId: number; qty: number }>>(
    '/scan-logs/check',
    { taskId, barcode },
    { headers: { 'X-Client': 'pda' } },
  )
