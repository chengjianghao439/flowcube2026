import { payloadClient as client } from './client'
import type { PaginatedData } from '@/types'
import { withRequestKeyHeaders } from '@/lib/requestKey'
export type FulfillmentType = 'sale' | 'purchase' | 'inbound' | 'transfer'
export interface FulfillmentIssue {
  id: number; document_type: FulfillmentType; document_id: number; source: 'auto' | 'manual'; source_key: string
  title: string; reason: string; action_path: string; owner_id: number | null; ownerName: string | null
  status: 'open' | 'processing' | 'resolved'; due_at: string | null; result: string | null; version: number
  overdue: number; dueSoon: number; conditionActive?: boolean
}
export interface DeliverySource { quantity: number; date: string | null; orderId: number | null; orderNo: string; bound: boolean; stage: string }
export interface DeliveryItem {
  id: number; productId: number; productCode: string; productName: string; articleNumber: string | null; spec: string | null; color: string | null; unit: string
  warehouseId: number; warehouseName: string; actualShipDate: string | null; deliveryOutcome: string; remaining: number; physical: number; boundQty: number; shortage: number
  promisedDate: string | null; processingDays: number | null; firstDate: string | null; allDate: string | null; delayed: boolean; state: string; sources: DeliverySource[]
}
export interface Commitment { itemId: number; promisedDate: string | null; originalDate: string | null; processingDays: number | null }
export interface FulfillmentDocument {
  type: FulfillmentType; id: number; canManage: boolean; issues: FulfillmentIssue[]; owners: { id: number; name: string }[]
  commitments: Commitment[]; expectedDate: string | null; detectedCount: number
  delivery: { items: DeliveryItem[]; firstDate: string | null; allDate: string | null } | null
  impacts: { saleId: number; orderNo: string; itemId: number; productCode: string; productName: string; unit: string; quantity: number; promisedDate: string | null; expectedDate: string | null }[]
}
export interface FulfillmentList extends PaginatedData<FulfillmentIssue> { summary: { open: number; mine: number; overdue: number; unassigned: number } }
export const getFulfillment = (type: FulfillmentType, id: number, signal?: AbortSignal) => client.get<FulfillmentDocument>(`/fulfillment/${type}/${id}`, { signal, skipGlobalError: true })
export const getFulfillmentIssues = (filter: string, summary = false, signal?: AbortSignal) => client.get<FulfillmentList>('/fulfillment/issues', { params: { filter, page: 1, pageSize: summary ? 1 : 200 }, listMode: summary ? 'summary' : undefined, signal, skipGlobalError: true })
export type FulfillmentCommand =
  | { action: 'sync' }
  | { action: 'dates'; itemId: number; date: string | null; processingDays: number | null; reason: string }
  | { action: 'create'; title: string; reason: string; ownerId?: number | null; dueDate: string | null }
  | { action: 'issue'; issueId: number; operation: 'claim' | 'assign' | 'progress' | 'resolve' | 'reopen'; version: number; result?: string; ownerId?: number | null; dueDate?: string | null }
export function runFulfillmentCommand(type: FulfillmentType, id: number, command: FulfillmentCommand, requestKey: string) {
  const path = `/fulfillment/${type}/${id}`
  const config = { headers: withRequestKeyHeaders(requestKey), skipGlobalError: true }
  if (command.action === 'sync') return client.post(`${path}/sync`, {}, config)
  if (command.action === 'dates') return client.put(`${path}/dates`, command, config)
  if (command.action === 'create') return client.post(`${path}/issues`, command, config)
  return client.patch(`${path}/issues/${command.issueId}`, { ...command, action: command.operation }, config)
}
