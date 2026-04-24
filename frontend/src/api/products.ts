import { payloadClient as apiClient } from './client'
import { desktopLocalPrintRequestHeaders } from '@/lib/desktopLocalPrint'
import type { ApiResponse, PaginatedData, QueryParams } from '@/types'
import type { Product, ProductOption, CreateProductParams, UpdateProductParams, ProductFinderResult, ProductFinderParams } from '@/types/products'

export const getProductsForFinderApi = async (p: ProductFinderParams) =>
  apiClient.get<ApiResponse<PaginatedData<ProductFinderResult>>>('/products/finder', { params: p })

export const getProductsApi       = async (p: QueryParams) => apiClient.get<ApiResponse<PaginatedData<Product>>>('/products', { params: p })
export const getProductsActiveApi = async () => apiClient.get<ApiResponse<ProductOption[]>>('/products/active')
export const createProductApi     = async (d: CreateProductParams) => apiClient.post<ApiResponse<{id:number}>>('/products', d)
export const updateProductApi     = async (id:number, d: UpdateProductParams) => { await apiClient.put(`/products/${id}`, d) }
export const deleteProductApi     = async (id:number) => { await apiClient.delete(`/products/${id}`) }
export const printProductLabelApi = async (id: number) =>
  apiClient.post<ApiResponse<{
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
  }>>(`/products/${id}/print-label`, {}, {
    skipGlobalError: true,
    headers: desktopLocalPrintRequestHeaders(),
  })
