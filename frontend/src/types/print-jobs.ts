import type { PaginatedData } from '@/types'

export type BarcodePrintCategory = 'inbound' | 'outbound' | 'logistics'

export interface BarcodePrintJobInfo {
  id: number
  status: number
  statusKey: 'no_job' | 'unassigned' | 'queued' | 'printing' | 'success' | 'failed' | 'timeout' | 'cancelled' | 'voided' | 'voided_job' | 'unknown'
  printStateLabel: string
  printerId: number | null
  printerCode: string | null
  printerName: string | null
  errorMessage: string | null
  dispatchReason: string | null
  createdAt: string
  updatedAt: string
}

export interface BarcodePrintRecord {
  category: BarcodePrintCategory
  recordId: number
  inboundTaskId?: number | null
  inboundTaskItemId?: number | null
  warehouseTaskId?: number | null
  waveId?: number | null
  waveNo?: string | null
  barcode: string
  barcodeLabel: string
  barcodeKind: string
  bizNo: string | null
  title: string
  subtitle: string | null
  extraInfo: string | null
  warehouseName: string | null
  locationCode: string | null
  qty: number
  createdAt: string
  latestJob: BarcodePrintJobInfo | null
  canReprint: boolean
  /**
   * 行级**业务状态**（入库条码才有：作废/取消/正常这类条码本身的状态）。
   * 与 `latestJob.statusKey`（**最近一次打印任务自身的结果**）是两件事，不要互相替代：
   * 作废容器既有的任务可能仍是「已打印」，两者必须能同时看到。
   */
  barcodeStatusKey?: string | null
  barcodeStatusLabel?: string | null
  /** 作废原因（仅入库条码、容器已作废时有值；取不到原因为 null），与打印历史一并展示。 */
  voidReason?: string | null
}

export type BarcodePrintRecordPage = PaginatedData<BarcodePrintRecord>
