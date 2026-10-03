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
  const result = await collectAllRecords(async (page, pageSize) => {
    const data = await payloadClient.get<PartyLedgerResult>('/payments/party-ledger', {
      params: { ...params, page, pageSize: pageSize ?? 200, snapshotId, snapshotCount },
      signal, listMode: 'summary', _authSessionGeneration: generation,
    })
    if (!data || !Number.isSafeInteger(data.snapshotId) || data.snapshotId < 0
      || !Number.isSafeInteger(data.snapshotCount) || data.snapshotCount < 0
      || !Array.isArray(data.list) || !data.pagination || typeof data.pagination !== 'object') {
      throw new Error('列表数据不完整，请刷新后重试')
    }
    if (snapshotCount !== undefined && data.snapshotCount !== snapshotCount) {
      throw new Error('列表数据已变化，请刷新后重试')
    }
    snapshotId ??= data.snapshotId
    snapshotCount ??= data.snapshotCount
    // 往来接口使用数字事件 ID（含无事件的 0）；只在统一列表校验边界转换，请求和页面 DTO 仍用数字。
    return { ...data, snapshotId: String(data.snapshotId) }
  }, signal)
  return { ...result, snapshotId: Number(result.snapshotId) }
}
