import { payloadClient } from './client'
import { collectAllRecords } from './allRecords'
import { useAuthStore } from '@/store/authStore'

export interface PartyLedgerRow {
  id: number; occurredAt: string; businessDate: string | null
  eventType: string; eventName: string; documentNo: string
  orderId: number | null; recordId: number | null; receiptId: number | null
  increase: number; decrease: number; balanceAfter: number
}
export interface PartyLedgerResult {
  party: { id: number; code: string; name: string }; type: 1 | 2
  snapshotId: number; snapshotCount: number; historyStartedAt: string; historyIncomplete: boolean; unassignedCount: number
  summary: { openingBalance: number; increase: number; decrease: number; closingBalance: number }
  list: PartyLedgerRow[]
  pagination: { page: number; pageSize: number; total: number }
}
export async function getPartyLedger(params: { type: number; partyId: number; startDate?: string; endDate?: string }, signal?: AbortSignal) {
  let snapshotCount: number | undefined
  let snapshotId: number | undefined
  const generation = useAuthStore.getState().sessionGeneration
  return collectAllRecords(async (page, pageSize) => {
    const data = await payloadClient.get<PartyLedgerResult>('/payments/party-ledger', {
      params: { ...params, page, pageSize: pageSize ?? 200, snapshotId, snapshotCount },
      signal, listMode: 'summary', _authSessionGeneration: generation,
    })
    snapshotId ??= data.snapshotId
    snapshotCount ??= data.snapshotCount
    return data
  }, signal)
}
