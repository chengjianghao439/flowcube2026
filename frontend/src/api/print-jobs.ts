import { payloadClient as client } from './client'

import type { BarcodePrintCategory, BarcodePrintRecordPage } from '@/types/print-jobs'

export const getBarcodePrintRecordsApi = (params: {
  category: BarcodePrintCategory
  keyword?: string
  status?: string
  page?: number
  pageSize?: number
  inboundTaskId?: number
  inboundTaskItemId?: number
}) =>
  client.get<BarcodePrintRecordPage>('/print-jobs/barcodes', { params })

export const reprintBarcodeRecordApi = (data: {
  category: BarcodePrintCategory
  recordId: number
}) =>
  client.post<{
    id: number
    printStateLabel: string
    printerCode: string | null
    printerName: string | null
    statusKey: string
  }>('/print-jobs/barcodes/reprint', data)
