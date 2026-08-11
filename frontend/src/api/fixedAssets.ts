import { payloadClient as client } from './client'
import type { PaginatedData } from '@/types'

export interface FixedAsset {
  id: number
  assetNo: string
  assetName: string
  category: string | null
  departmentId: number | null
  departmentName: string | null
  acquireDate: string
  originalCost: number
  residualRate: number
  usefulMonths: number
  deprMethod: number
  status: number
  disposeDate: string | null
  disposeType: number | null
  disposeTypeName: string | null
  disposeIncome: number | null
  isActive: boolean
  remark: string | null
  monthlyDepr: number
  periodsDepreciated: number
  accumDepr: number
  netBookValue: number
  createdAt: string
  deprHistory?: Array<{
    id: number
    period: string
    deprDate: string
    monthlyAmount: number
    accumAmount: number
    isDisposal: boolean
  }>
}

export interface CreateFixedAssetParams {
  assetName: string
  category?: string | null
  departmentId?: number | null
  departmentName?: string | null
  acquireDate: string
  originalCost: number
  residualRate?: number
  usefulMonths: number
  remark?: string | null
}

export interface DeprResult {
  period: string
  ran: number
  skipped: number
  vouchers: Array<{ assetId: number; assetName: string; monthly: number }>
}

export const listFixedAssetsApi = (params: Record<string, unknown>) =>
  client.get<PaginatedData<FixedAsset>>('/fixed-assets', { params })
export const createFixedAssetApi = (data: CreateFixedAssetParams) => client.post<{ id: number; assetNo: string }>('/fixed-assets', data)
export const runDepreciationApi = (period?: string) => client.post<DeprResult>('/fixed-assets/depreciation/run', period ? { period } : {})
export const disposeFixedAssetApi = (id: number, data: { disposeType: number; disposeDate: string; income?: number; expense?: number }) =>
  client.post<{ id: number; disposeNo: string; netBook: number; gain: number }>(`/fixed-assets/${id}/dispose`, data)
