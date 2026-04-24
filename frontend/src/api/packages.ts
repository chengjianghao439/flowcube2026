import { payloadClient as client } from './client'
import { desktopLocalPrintRequestHeaders } from '@/lib/desktopLocalPrint'

import { withRequestKeyHeaders } from '@/lib/requestKey'

export interface PackageItem {
  id: number
  productId: number
  productCode: string
  productName: string
  unit: string
  qty: number
}

export interface Package {
  id: number
  barcode: string
  warehouseTaskId?: number
  status: 1 | 2
  statusName: string
  remark: string | null
  createdAt: string
  items: PackageItem[]
}

export const getPackagesApi = (taskId: number) =>
  client.get<Package[]>('/packages', { params: { taskId } })

export const createPackageApi = (warehouseTaskId: number, remark?: string) =>
  client.post<Package>('/packages', { warehouseTaskId, remark })

export const addPackageItemApi = (
  packageId: number,
  productCode: string,
  qty: number,
) =>
  client.post<PackageItem>(`/packages/${packageId}/add-item`, {
    productCode,
    qty,
  })

export const finishPackageApi = (packageId: number, requestKey?: string) =>
  client.put<{ id: number; status: number; statusName: string; allPackagesDone?: boolean; printQueued?: boolean; printJobId?: number | null }>(
    `/packages/${packageId}/finish`,
    undefined,
    requestKey ? { headers: withRequestKeyHeaders(requestKey) } : undefined,
  )

export const printPackageLabelApi = (packageId: number, requestKey?: string) =>
  client.post<{
    queued: boolean
    job: {
      id?: number
      content?: string
      contentType?: string
      printerName?: string | null
    } | unknown
  }>(`/packages/${packageId}/print-label`, undefined, {
    headers: requestKey
      ? withRequestKeyHeaders(requestKey, desktopLocalPrintRequestHeaders())
      : desktopLocalPrintRequestHeaders(),
  })

export interface PackageShipInfo {
  packageId: number
  barcode: string
  packageStatus: 1 | 2
  packageStatusName: string
  warehouseTaskId: number
  taskNo: string
  customerName: string
  warehouseName: string
  taskStatus: number
  taskStatusName?: string
  printSummary?: {
    totalPackages: number
    successCount: number
    failedCount: number
    timeoutCount: number
    processingCount: number
    recentError: string | null
    recentPrinter: string | null
  }
  packages: Package[]
}

export const getPackageByBarcodeApi = (barcode: string) =>
  client.get<PackageShipInfo>(`/packages/barcode/${encodeURIComponent(barcode)}`)
