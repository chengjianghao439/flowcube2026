import { payloadClient as client } from './client'
import { recordIdentityByFields } from './allRecords'

import type { BarcodePrintCategory, BarcodePrintRecordPage } from '@/types/print-jobs'
import type { PrintQueueDispatchHint } from '@/lib/printQueue'

const barcodeRecordIdentity = recordIdentityByFields('category', 'recordId')

export const getBarcodePrintRecordsApi = (params: {
  category: BarcodePrintCategory
  keyword?: string
  status?: string
  page?: number
  pageSize?: number
  inboundTaskId?: number
  inboundTaskItemId?: number
}) =>
  client.get<BarcodePrintRecordPage>('/print-jobs/barcodes', { params }, barcodeRecordIdentity)

export const reprintBarcodeRecordApi = (data: {
  category: BarcodePrintCategory
  recordId: number
}, config?: Parameters<typeof client.post>[2]) =>
  client.post<{
    queued: boolean
    id?: number
    printStateLabel?: string
    printerCode?: string | null
    printerName?: string | null
    statusKey?: string
    dispatchHint?: PrintQueueDispatchHint | null
  }>('/print-jobs/barcodes/reprint', data, config)
