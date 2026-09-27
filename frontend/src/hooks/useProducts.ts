import { useVisibleQuery } from './useVisibleQuery'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { getProductApi, getProductsApi, createProductApi, updateProductApi, deleteProductApi, getProductsForFinderApi } from '@/api/products'
import type { QueryParams } from '@/types'
import type { CreateProductParams, UpdateProductParams, ProductFinderParams } from '@/types/products'
import { toast } from '@/lib/toast'

const K = 'products'
export const useProduct         = (id: number) => useQuery({ queryKey:[K,id], queryFn:()=>getProductApi(id), enabled:!!id })

/**
 * 改价审批完成后的商品缓存失效（key 与上面的 `K` 同源）。
 *
 * 只有审批**真正完成**（`finished`）时价格才被 `applyApprovedPrice` 落库；此时必须连带失效
 * 商品缓存——`[K]` 是前缀，会一并失效详情 `[K,id]`、列表与 Finder——否则商品编辑页会在全局
 * 5min `staleTime` 内继续显示旧的 `labelSalePrice`，正好削弱 §18 的可见性修复。
 * 未 finished 的多级中间步骤不改价格，因此不做无谓刷新（这也不是轮询）。
 */
export function invalidateAfterPriceChange(qc: QueryClient, result: { finished?: boolean } | null | undefined) {
  if (result?.finished) qc.invalidateQueries({ queryKey: [K] })
}
export const useProducts        = (p: QueryParams) => useVisibleQuery({ queryKey:[K,p], queryFn:({ signal })=>getProductsApi(p, signal) })
export const useProductFinder   = (p: ProductFinderParams, enabled=true) =>
  useQuery({ queryKey:[K,'finder',p], queryFn:()=>getProductsForFinderApi(p), enabled })
export function useCreateProduct() { const qc=useQueryClient(); return useMutation({ mutationFn:(d:CreateProductParams)=>createProductApi(d), onSuccess:()=>qc.invalidateQueries({queryKey:[K]}) }) }
export function useUpdateProduct() { const qc=useQueryClient(); return useMutation({ mutationFn:({id,data}:{id:number;data:UpdateProductParams})=>updateProductApi(id,data), onSuccess:()=>qc.invalidateQueries({queryKey:[K]}) }) }
export function useDeleteProduct() {
  const qc=useQueryClient()
  return useMutation({
    mutationFn:(id:number)=>deleteProductApi(id, { skipGlobalError: true }),
    onSuccess:()=>qc.invalidateQueries({queryKey:[K]}),
    onError:(e:unknown)=>toast.error(e instanceof Error ? e.message : '删除失败'),
  })
}
