import { payloadClient as apiClient } from './client'
import { desktopLocalPrintRequestHeaders } from '@/lib/desktopLocalPrint'
import type { PaginatedData, QueryParams } from '@/types'
import type { Location, CreateLocationParams, UpdateLocationParams } from '@/types/locations'
import type { PrintDispatchHint } from './racks'

export async function getLocationsApi(
  params: QueryParams & { warehouseId?: number; zone?: string },
): Promise<PaginatedData<Location>> {
  const res = await apiClient.get<PaginatedData<Location>>('/locations', { params })
  return res
}

export async function createLocationApi(data: CreateLocationParams, config?: Parameters<typeof apiClient.post>[2]): Promise<{ id: number }> {
  const res = await apiClient.post<{ id: number }>('/locations', data, config)
  return res
}

export async function updateLocationApi(id: number, data: UpdateLocationParams, config?: Parameters<typeof apiClient.put>[2]): Promise<void> {
  await apiClient.put(`/locations/${id}`, data, config)
}

export async function deleteLocationApi(id: number, config?: Parameters<typeof apiClient.delete>[1]): Promise<void> {
  await apiClient.delete(`/locations/${id}`, config)
}

/** 按库位条码查库位（PDA 扫码库位确认用），查不到返回 null */
export async function getLocationByCodeApi(code: string, config?: Parameters<typeof apiClient.get>[1]): Promise<{ id: number; code: string } | null> {
  const res = await apiClient.get<{ id: number; code: string }>(`/locations/code/${encodeURIComponent(code)}`, config)
  return res ?? null
}

/** 库位标签打印（与货架标签打印同构：入队 + 桌面端本机 RAW 出纸） */
export interface PrintLocationLabelResult {
  queued: boolean
  jobId: number | null
  printerCode: string | null
  printerName: string | null
  dispatchHint?: PrintDispatchHint | null
  /** 入队成功时返回 ZPL，供桌面端本机 RAW 出纸 */
  contentType?: string | null
  content?: string | null
}

export async function printLocationLabelApi(id: number): Promise<PrintLocationLabelResult> {
  const res = await apiClient.post<PrintLocationLabelResult>(
    `/locations/${Number(id)}/print-label`,
    {},
    { skipGlobalError: true, headers: desktopLocalPrintRequestHeaders() },
  )
  return (
    res ?? {
      queued: false,
      jobId: null,
      printerCode: null,
      printerName: null,
    }
  )
}
