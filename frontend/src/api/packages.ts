import client from './client'
import { desktopLocalPrintRequestHeaders } from '@/lib/desktopLocalPrint'
import type { DesktopPrinterCompat } from '@/lib/desktopLocalPrint'
import type { ApiResponse } from '@/types'

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
  client.get<ApiResponse<Package[]>>('/packages', { params: { taskId } })

export const createPackageApi = (warehouseTaskId: number, remark?: string) =>
  client.post<ApiResponse<Package>>('/packages', { warehouseTaskId, remark })

export const addPackageItemApi = (
  packageId: number,
  productCode: string,
  qty: number,
) =>
  client.post<ApiResponse<PackageItem>>(`/packages/${packageId}/add-item`, {
    productCode,
    qty,
  })

export const finishPackageApi = (packageId: number) =>
  client.put<ApiResponse<{ id: number; status: number; statusName: string; autoPacked?: boolean }>>(
    `/packages/${packageId}/finish`,
  )

export const printPackageLabelApi = (packageId: number) =>
  client.post<ApiResponse<{
    queued: boolean
    job: {
      id?: number
      content?: string
      contentType?: string
      printerName?: string | null
      printerCompat?: DesktopPrinterCompat | null
    } | unknown
  }>>(`/packages/${packageId}/print-label`, undefined, {
    headers: desktopLocalPrintRequestHeaders(),
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
  packages: Package[]
}

export const getPackageByBarcodeApi = (barcode: string) =>
  client.get<ApiResponse<PackageShipInfo>>(`/packages/barcode/${encodeURIComponent(barcode)}`)
