import apiClient from './client'
import type { ApiResponse, PaginatedData, QueryParams } from '@/types'
import type { Product, ProductCategory, ProductOption, CreateProductParams, UpdateProductParams, ProductFinderResult, ProductFinderParams } from '@/types/products'

export const getCategoriesApi     = async () => (await apiClient.get<ApiResponse<ProductCategory[]>>('/products/categories')).data.data
export const createCategoryApi    = async (d:{name:string;sort?:number}) => (await apiClient.post<ApiResponse<{id:number}>>('/products/categories', d)).data.data
export const updateCategoryApi    = async (id:number, d:{name:string;sort?:number}) => { await apiClient.put(`/products/categories/${id}`, d) }
export const deleteCategoryApi    = async (id:number) => { await apiClient.delete(`/products/categories/${id}`) }

export const getProductsForFinderApi = async (p: ProductFinderParams) =>
  (await apiClient.get<ApiResponse<PaginatedData<ProductFinderResult>>>('/products/finder', { params: p })).data.data

export const getProductsApi       = async (p: QueryParams) => (await apiClient.get<ApiResponse<PaginatedData<Product>>>('/products', { params: p })).data.data
export const getProductsActiveApi = async () => (await apiClient.get<ApiResponse<ProductOption[]>>('/products/active')).data.data
export const createProductApi     = async (d: CreateProductParams) => (await apiClient.post<ApiResponse<{id:number}>>('/products', d)).data.data
export const updateProductApi     = async (id:number, d: UpdateProductParams) => { await apiClient.put(`/products/${id}`, d) }
export const deleteProductApi     = async (id:number) => { await apiClient.delete(`/products/${id}`) }
