import { payloadClient } from './client'
import type { KitReadOwner } from './kits'
import { commercialReadConfig } from './sale-commercial'
export type DocumentType = 'sale' | 'purchase' | 'inbound' | 'purchase-return' | 'sale-return' | 'transfer' | 'stockcheck' | 'disposal' | 'requisition' | 'refund' | 'expense' | 'credit' | 'price' | 'plan' | 'wave' | 'logistics'
export type ActivityView = 'progress' | 'scan' | 'containers' | 'print' | 'log'
export interface DocumentEvent { id: string; title: string; description?: string | null; createdByName?: string | null; createdAt: string; source?: string }
export interface ActivitySection { group: ActivityView; title: string; description?: string; columns: { key: string; label: string; format?: 'date' }[]; rows: Record<string, string | number | null>[] }
export interface DocumentActivity { status: string; sections: ActivitySection[]; events: DocumentEvent[]; historyNote: string }
export const getDocumentActivityApi = (type: DocumentType, id: number, signal?: AbortSignal, readOwner?: KitReadOwner) => payloadClient.get<DocumentActivity>(`/document-activity/${type}/${id}`, { ...(readOwner ? commercialReadConfig(readOwner) : {}), signal, skipGlobalError: true })
