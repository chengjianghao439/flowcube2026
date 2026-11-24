import { payloadClient as client } from './client'
import { withRequestKeyHeaders } from '@/lib/requestKey'
export type FulfillmentType = 'sale' | 'purchase' | 'inbound' | 'transfer'
export interface FulfillmentIssue {
  id: number; document_type: FulfillmentType; document_id: number; source: 'auto' | 'manual'; source_key: string
  documentNo?: string | null; partyName?: string | null; warehouseName?: string | null
  title: string; reason: string; action_path: string; owner_id: number | null; ownerName: string | null
  status: 'open' | 'processing' | 'resolved'; due_at: string | null; result: string | null; version: number
  overdue: number; dueSoon: number; conditionActive?: boolean
}
interface Commitment { itemId: number; promisedDate: string | null; originalDate: string | null; processingDays: number | null }
export interface FulfillmentDocument {
  type: FulfillmentType; id: number; canManage: boolean; issues: FulfillmentIssue[]; owners: { id: number; name: string }[]
  commitments: Commitment[]; expectedDate: string | null; detectedCount: number
  impacts: { saleId: number; orderNo: string; itemId: number; productCode: string; productName: string; unit: string; quantity: number }[]
}
export const getFulfillment = (type: Exclude<FulfillmentType, 'sale'>, id: number, signal?: AbortSignal) => client.get<FulfillmentDocument>(`/fulfillment/${type}/${id}`, { signal, skipGlobalError: true })
export type FulfillmentCommand =
  | { action: 'sync' }
  | { action: 'dates'; itemId: number; date: string | null; processingDays: number | null; reason: string }
  | { action: 'create'; title: string; reason: string; ownerId?: number | null; dueDate: string | null }
  | { action: 'issue'; issueId: number; operation: 'claim' | 'assign' | 'progress' | 'resolve' | 'reopen'; version: number; result?: string; ownerId?: number | null; dueDate?: string | null }
export function runFulfillmentCommand(type: Exclude<FulfillmentType, 'sale'>, id: number, command: FulfillmentCommand, requestKey: string) {
  const path = `/fulfillment/${type}/${id}`
  const config = { headers: withRequestKeyHeaders(requestKey), skipGlobalError: true }
  if (command.action === 'sync') return client.post(`${path}/sync`, {}, config)
  if (command.action === 'dates') return client.put(`${path}/dates`, command, config)
  if (command.action === 'create') return client.post(`${path}/issues`, command, config)
  return client.patch(`${path}/issues/${command.issueId}`, { ...command, action: command.operation }, config)
}
