import { payloadClient as apiClient } from './client'
import { desktopLocalPrintRequestHeaders } from '@/lib/desktopLocalPrint'
import type { PaginatedData, QueryParams } from '@/types'
import type { Product, CreateProductParams, UpdateProductParams, ProductFinderResult, ProductFinderParams, ProductQtyPolicy } from '@/types/products'

export const getProductsForFinderApi = async (p: ProductFinderParams) =>
  apiClient.get<PaginatedData<ProductFinderResult>>('/products/finder', { params: p })

// 数量小数策略（迁移 254）：一次批量查，供数量输入框把 step 在 1 与 0.01 之间切换
export const getProductQtyPoliciesApi = async (ids: number[]) =>
  apiClient.get<ProductQtyPolicy[]>('/products/qty-policies', { params: { ids: ids.join(',') } })

export const getProductApi        = async (id: number) => apiClient.get<Product>(`/products/${id}`)
export const getProductsApi       = async (p: QueryParams, signal?: AbortSignal) => apiClient.get<PaginatedData<Product>>('/products', { params: p, signal })
export const createProductApi     = async (d: CreateProductParams) => apiClient.post<{id:number}>('/products', d)
export const updateProductApi     = async (id:number, d: UpdateProductParams) => { await apiClient.put(`/products/${id}`, d) }
export const deleteProductApi     = async (id:number, config?: Parameters<typeof apiClient.delete>[1]) => { await apiClient.delete(`/products/${id}`, config) }
export const printProductLabelApi = async (id: number) =>
  apiClient.post<{
    queued: boolean
    jobId: number | null
    printerCode: string | null
    printerName: string | null
    dispatchHint?: {
      code: string
      message: string
      onlineClients: number
      sseClients?: number
    } | null
    contentType?: string | null
    content?: string | null
  }>(`/products/${id}/print-label`, {}, {
    skipGlobalError: true,
    headers: desktopLocalPrintRequestHeaders(),
  })
