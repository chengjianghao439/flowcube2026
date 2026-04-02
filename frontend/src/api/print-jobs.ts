import client from './client'
import type { ApiResponse } from '@/types'
import type { BarcodePrintCategory, BarcodePrintRecordPage } from '@/types/print-jobs'

export const getBarcodePrintRecordsApi = (params: {
  category: BarcodePrintCategory
  keyword?: string
  status?: string
  page?: number
  pageSize?: number
}) =>
  client.get<ApiResponse<BarcodePrintRecordPage>>('/print-jobs/barcodes', { params })

export const reprintBarcodeRecordApi = (data: {
  category: BarcodePrintCategory
  recordId: number
}) =>
  client.post<ApiResponse<{
    id: number
    printStateLabel: string
    printerCode: string | null
    printerName: string | null
    statusKey: string
  }>>('/print-jobs/barcodes/reprint', data)
