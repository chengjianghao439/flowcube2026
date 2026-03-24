import client from './client'
import type { ApiResponse, PaginatedData } from '@/types'

// ── 类型定义 ──────────────────────────────────────────────────────────────────

export type WaveStatus = 1 | 2 | 3 | 4 | 5

export const WAVE_STATUS_LABEL: Record<WaveStatus, string> = {
  1: '待拣货', 2: '拣货中', 3: '待分拣', 4: '已完成', 5: '已取消',
}

export const WAVE_STATUS_COLOR: Record<WaveStatus, string> = {
  1: 'bg-gray-100 text-gray-600',
  2: 'bg-blue-100 text-blue-700',
  3: 'bg-orange-100 text-orange-700',
  4: 'bg-green-100 text-green-700',
  5: 'bg-red-100 text-red-600',
}

export interface WaveTask {
  taskId: number
  taskNo: string
  taskStatus: number
  saleOrderId: number
  saleOrderNo: string
  customerName: string
}

export interface WaveItem {
  id: number
  productId: number
  productCode: string
  productName: string
  unit: string
  totalQty: number
  pickedQty: number
}

export type WavePriority = 1 | 2 | 3

export const WAVE_PRIORITY_LABEL: Record<WavePriority, string> = {
  1: '紧急', 2: '普通', 3: '低',
}
export const WAVE_PRIORITY_COLOR: Record<WavePriority, string> = {
  1: 'text-red-600', 2: 'text-gray-600', 3: 'text-gray-400',
}

export interface PickingWave {
  id: number
  waveNo: string
  warehouseId: number
  warehouseName: string | null
  status: WaveStatus
  statusName: string
  priority: WavePriority
  priorityName: string
  taskCount: number
  operatorId: number | null
  operatorName: string | null
  remark: string | null
  createdAt: string
  updatedAt: string
  itemCount?: number
  totalQty?: number
  pickedQty?: number
  tasks?: WaveTask[]
  items?: WaveItem[]
}

export interface WaveRouteContainer {
  waveItemId: number
  containerId: number
  barcode: string
  productName: string
  productCode: string
  unit: string
  qty: number
  status?: 'pending' | 'completed'
}

export interface WaveRouteStep {
  step: number
  locationCode: string | null
  containers: WaveRouteContainer[]
  status?: 'pending' | 'in_progress' | 'completed'
}

export interface WaveRouteData {
  waveId: number
  waveNo: string
  totalSteps: number
  totalContainers: number
  route: WaveRouteStep[]
}

// ── API ────────────────────────────────────────────────────────────────────────

export const getWavesApi = (params?: Record<string, string | number>) =>
  client.get<ApiResponse<PaginatedData<PickingWave>>>('/picking-waves', { params })

export const getWaveByIdApi = (id: number) =>
  client.get<ApiResponse<PickingWave>>(`/picking-waves/${id}`)

export const createWaveApi = (taskIds: number[], priority?: number, remark?: string) =>
  client.post<ApiResponse<{ waveId: number; waveNo: string }>>('/picking-waves', { taskIds, priority: priority ?? 2, remark })

export const startWaveApi = (id: number) =>
  client.post<ApiResponse<null>>(`/picking-waves/${id}/start`)

export const updateWavePickedQtyApi = (waveId: number, itemId: number, pickedQty: number) =>
  client.put<ApiResponse<null>>(`/picking-waves/${waveId}/items/${itemId}/picked-qty`, { pickedQty })

export const finishPickingApi = (id: number) =>
  client.post<ApiResponse<null>>(`/picking-waves/${id}/finish-picking`)

export const finishWaveApi = (id: number) =>
  client.post<ApiResponse<null>>(`/picking-waves/${id}/finish`)

export const cancelWaveApi = (id: number) =>
  client.post<ApiResponse<null>>(`/picking-waves/${id}/cancel`)

export const getWavePickRouteApi = (id: number) =>
  client.get<ApiResponse<WaveRouteData>>(`/picking-waves/${id}/pick-route`)

export const markRouteCompletedApi = (waveId: number, barcode: string) =>
  client.post<ApiResponse<null>>(`/picking-waves/${waveId}/route-completed`, { barcode })
