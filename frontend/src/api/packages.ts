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
  /** 来源取货标签：null 表示按商品码装的旧 SKU 份额。同一商品可能多行（旧 SKU + 各标签各一行） */
  labelContainerId?: number | null
  labelBarcode?: string | null
  /** **本次增量**：`qty` 是该行累计量，提示要区分「本次装了多少」与「累计多少」 */
  addedQty?: number
}

export interface Package {
  id: number
  barcode: string
  warehouseTaskId?: number
  status: 1 | 2 | 3
  statusName: string
  remark: string | null
  createdAt: string
  items: PackageItem[]
  /** 箱贴（L 条码）打印状态；未生成打印任务时为 no_job。完成打包要求 success */
  printStatus?: { key: string; label: string; errorMessage?: string | null }
}

export const getPackagesApi = (taskId: number, config?: Parameters<typeof client.get>[1]) =>
  client.get<Package[]>('/packages', { params: { taskId }, ...config })

export const createPackageApi = (warehouseTaskId: number, remark?: string) =>
  client.post<Package>('/packages', { warehouseTaskId, remark }, { headers: { 'X-Client': 'pda' }, skipGlobalError: true })

/**
 * 两种形态互斥：
 * · 商品码 `{ productCode, qty }`——旧 SKU 份额；
 * · 取货标签 `{ labelBarcode }`——**省略数量即整份装入该标签的未装余量**（扫码作业的默认语义）。
 * 传条码而不是容器 id：`I` 码的条码是独立序号，与容器 id 并不相等。
 */
export type AddPackageItemPayload =
  | { productCode: string; qty: number }
  | { labelBarcode: string; qty?: number }

export const addPackageItemApi = (
  packageId: number,
  payload: AddPackageItemPayload,
  requestKey?: string,
) =>
  client.post<PackageItem>(`/packages/${packageId}/add-item`, payload, {
    headers: requestKey
      ? withRequestKeyHeaders(requestKey, { 'X-Client': 'pda' })
      : { 'X-Client': 'pda' },
    skipGlobalError: true,
  })

export const removePackageItemApi = (
  packageId: number,
  itemId: number,
  qty?: number,
) =>
  client.post<{ itemId: number; productId: number; productCode: string; productName: string; unit: string; removed: boolean; qty: number }>(
    `/packages/${packageId}/remove-item`,
    { itemId, qty },
    { headers: { 'X-Client': 'pda' }, skipGlobalError: true },
  )

export const voidPackageApi = (packageId: number) =>
  client.post<{ id: number; warehouseTaskId: number; status: number; statusName: string }>(
    `/packages/${packageId}/void`,
    undefined,
    { headers: { 'X-Client': 'pda' }, skipGlobalError: true },
  )

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
    { headers: requestKey ? withRequestKeyHeaders(requestKey, { 'X-Client': 'pda' }) : { 'X-Client': 'pda' }, skipGlobalError: true },
  )

export const printPackageLabelApi = (packageId: number, requestKey?: string) =>
  client.post<{
    queued: boolean
    job: PackagePrintJob | unknown
  }>(`/packages/${packageId}/print-label`, undefined, {
    skipGlobalError: true,
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
  client.get<PackageShipInfo>(`/packages/barcode/${encodeURIComponent(barcode)}`, { skipGlobalError: true })
