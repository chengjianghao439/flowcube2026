import type { PaginatedData } from '@/types'

export type BarcodePrintCategory = 'inbound' | 'outbound' | 'logistics'

export interface BarcodePrintJobInfo {
  id: number
  status: number
  statusKey: 'pending' | 'printing' | 'success' | 'failed' | 'unknown'
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
}

export type BarcodePrintRecordPage = PaginatedData<BarcodePrintRecord>
