import apiClient from './client'
import { desktopLocalPrintRequestHeaders } from '@/lib/desktopLocalPrint'
import type { ApiResponse, PaginatedData, QueryParams } from '@/types'
import type { Rack, CreateRackParams, UpdateRackParams } from '@/types/racks'

export async function getRacksApi(
  params: QueryParams & { warehouseId?: number; zone?: string },
): Promise<PaginatedData<Rack>> {
  const res = await apiClient.get<ApiResponse<PaginatedData<Rack>>>('/racks', { params })
  return res.data.data
}

export async function getRacksActiveApi(warehouseId?: number): Promise<Rack[]> {
  const res = await apiClient.get<ApiResponse<Rack[]>>('/racks/active', {
    params: warehouseId ? { warehouseId } : {},
  })
  return res.data.data
}

export async function getRackByIdApi(id: number): Promise<Rack> {
  const res = await apiClient.get<ApiResponse<Rack>>(`/racks/${id}`)
  return res.data.data
}

export async function createRackApi(data: CreateRackParams): Promise<Rack> {
  const res = await apiClient.post<ApiResponse<Rack>>('/racks', data)
  return res.data.data
}

export async function updateRackApi(id: number, data: UpdateRackParams): Promise<Rack> {
  const res = await apiClient.put<ApiResponse<Rack>>(`/racks/${id}`, data)
  return res.data.data
}

export async function deleteRackApi(id: number): Promise<void> {
  await apiClient.delete(`/racks/${id}`)
}

export type PrintDispatchHint = {
  code: string
  message: string
  sseClients: number
}

export interface PrintRackLabelResult {
  queued: boolean
  jobId: number | null
  printerCode: string | null
  printerName: string | null
  dispatchHint?: PrintDispatchHint | null
  /** 仅请求头含 X-Flowcube-Desktop-Local-Print: 1 时返回，供本机直连 */
  contentType?: string | null
  content?: string | null
}

export async function printRackLabelApi(id: number): Promise<PrintRackLabelResult> {
  const res = await apiClient.post<ApiResponse<PrintRackLabelResult>>(
    `/racks/${Number(id)}/print-label`,
    {},
    { skipGlobalError: true, headers: desktopLocalPrintRequestHeaders() },
  )
  const body = res.data
  if (!body.success) {
    throw new Error(body.message || '打印失败')
  }
  return (
    body.data ?? {
      queued: false,
      jobId: null,
      printerCode: null,
      printerName: null,
    }
  )
}

export type RackScanHintResult = {
  kind: 'invalid' | 'ok' | 'warn' | 'binding'
  message: string
}

export async function scanRackHintApi(body: {
  warehouseId: number
  rackCode: string
  scanRaw: string
  excludeRackId?: number
}): Promise<RackScanHintResult> {
  const res = await apiClient.post<ApiResponse<RackScanHintResult>>('/racks/scan-hint', body)
  return res.data.data!
}
