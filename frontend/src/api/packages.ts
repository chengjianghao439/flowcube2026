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

export interface PackagePrintDispatchHint {
  code?: string
  message?: string
  onlineClients?: number
  sseClients?: number
  printerId?: number | null
  printerCode?: string | null
  printerName?: string | null
  clientId?: string | null
  clientOnline?: boolean
  clientLastSeen?: string | null
}

export interface PackagePrintJob {
  id?: number
  jobType?: string | null
  status?: number
  statusKey?: string | null
  printStateLabel?: string | null
  content?: string
  contentType?: string
  printerId?: number | null
  printerCode?: string | null
  printerName?: string | null
  dispatchHint?: PackagePrintDispatchHint | null
}

export const finishPackageApi = (packageId: number, requestKey?: string) =>
  client.put<{
    id: number
    status: number
    statusName: string
    allPackagesDone?: boolean
    printQueued?: boolean
    printJobId?: number | null
    printJobStatus?: number | null
    printJob?: PackagePrintJob
  }>(
    `/packages/${packageId}/finish`,
    undefined,
    requestKey ? { headers: withRequestKeyHeaders(requestKey) } : undefined,
  )

export const printPackageLabelApi = (packageId: number, requestKey?: string) =>
  client.post<{
    queued: boolean
    job: PackagePrintJob | unknown
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
  warehouseTaskStatus?: number
  warehouseTaskStatusName?: string | null
  /** @deprecated Use warehouseTaskStatus. Kept for older backend payloads. */
  taskStatus: number
  /** @deprecated Use warehouseTaskStatusName. Kept for older backend payloads. */
  taskStatusName?: string | null
  printSummary?: {
    totalPackages: number
    noJobCount?: number
    pendingCount?: number
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
