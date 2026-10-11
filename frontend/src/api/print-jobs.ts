import { payloadClient as client } from './client'
import { withRequestKeyHeaders } from '@/lib/requestKey'
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
  recovery?: boolean
  inboundTaskItemId?: number
}) =>
  client.get<BarcodePrintRecordPage>('/print-jobs/barcodes', { params: { ...params, recovery: params.recovery ? '1' : undefined } }, barcodeRecordIdentity)

export const reprintBarcodeRecordApi = (data: {
  category: BarcodePrintCategory
  recordId: number
  recovery?: boolean
}, config?: Parameters<typeof client.post>[2], requestKey = '') =>
  client.post<{
    queued: boolean
    category: BarcodePrintCategory
    recordId: number
    requestId: number
    id?: number
    printStateLabel?: string
    printerCode?: string | null
    printerName?: string | null
    statusKey?: string
    dispatchHint?: PrintQueueDispatchHint | null
  }>('/print-jobs/barcodes/reprint', data, { ...config, headers: withRequestKeyHeaders(requestKey, config?.headers as Record<string, string>) })
