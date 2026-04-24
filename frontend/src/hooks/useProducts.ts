import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getProductsApi, getProductsActiveApi, createProductApi, updateProductApi, deleteProductApi, getProductsForFinderApi } from '@/api/products'
import type { QueryParams } from '@/types'
import type { CreateProductParams, UpdateProductParams, ProductFinderParams } from '@/types/products'
import { toast } from '@/lib/toast'

const K = 'products'
export const useProducts        = (p: QueryParams) => useQuery({ queryKey:[K,p], queryFn:()=>getProductsApi(p) })
export const useProductsActive  = () => useQuery({ queryKey:[K,'active'], queryFn:getProductsActiveApi, staleTime:600000 })
export const useProductFinder   = (p: ProductFinderParams, enabled=true) =>
  useQuery({ queryKey:[K,'finder',p], queryFn:()=>getProductsForFinderApi(p), enabled, placeholderData:(prev) => prev })
export function useCreateProduct() { const qc=useQueryClient(); return useMutation({ mutationFn:(d:CreateProductParams)=>createProductApi(d), onSuccess:()=>qc.invalidateQueries({queryKey:[K]}) }) }
export function useUpdateProduct() { const qc=useQueryClient(); return useMutation({ mutationFn:({id,data}:{id:number;data:UpdateProductParams})=>updateProductApi(id,data), onSuccess:()=>qc.invalidateQueries({queryKey:[K]}) }) }
export function useDeleteProduct() {
  const qc=useQueryClient()
  return useMutation({
    mutationFn:deleteProductApi,
    onSuccess:()=>qc.invalidateQueries({queryKey:[K]}),
    onError:(e:unknown)=>toast.error(e instanceof Error ? e.message : '删除失败'),
  })
}
