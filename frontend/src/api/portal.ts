import { payloadClient as client } from './client'

export interface PortalStatementRow {
  id: number
  statementNo: string
  partyName: string
  periodStart: string | null
  periodEnd: string | null
  totalAmount: number
  settledAmount: number
  balance: number
  status: number
  statusName: string
  itemCount?: number
  confirmedByName: string | null
  confirmedAt: string | null
  remark: string | null
  operatorName: string | null
  createdAt: string
}

export interface PortalStatementResult {
  customer: { id: number; name: string }
  list: PortalStatementRow[]
  pagination: { page: number; pageSize: number; total: number }
}

export interface PortalPurchaseStatusRow {
  id: number
  orderNo: string
  status: number
  statusName: string
  expectedDate: string | null
  totalAmount: number
  warehouseName: string
  orderedQty: number
  receivedQty: number
  remark: string | null
  createdAt: string
}

export interface PortalPurchaseStatusResult {
  supplier: { id: number; name: string }
  list: PortalPurchaseStatusRow[]
  pagination: { page: number; pageSize: number; total: number }
}

export const getPortalStatementsApi = (params: { customerId: number; page?: number; pageSize?: number }) =>
  client.get<PortalStatementResult>('/portal/statements', { params })

export const getPortalPurchaseStatusApi = (params: { supplierId: number; page?: number; pageSize?: number }) =>
  client.get<PortalPurchaseStatusResult>('/portal/purchase-status', { params })
