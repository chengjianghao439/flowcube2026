import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSuppliersApi, getSuppliersActiveApi, createSupplierApi, updateSupplierApi, deleteSupplierApi } from '@/api/suppliers'
import type { QueryParams } from '@/types'
import type { CreateSupplierParams, UpdateSupplierParams } from '@/types/suppliers'
import { toast } from '@/lib/toast'
import type { ProductFinderReadContext } from './useProducts'

const K = 'suppliers'
export const useSuppliers = (p: QueryParams, context?: ProductFinderReadContext) => useQuery({
  queryKey: context ? [K, 'owned', ...context.key, p] : [K, p],
  queryFn: async query => {
    context?.assertCurrent()
    const data = context ? await getSuppliersApi(p, { ...context.config, signal: query.signal }) : await getSuppliersApi(p)
    context?.assertCurrent()
    return data
  }, enabled: !context || context.enabled,
})
export const useSuppliersActive = () => useQuery({ queryKey:[K,'active'], queryFn:getSuppliersActiveApi, staleTime:600000 })
export function useCreateSupplier() {
  const qc=useQueryClient(); return useMutation({ mutationFn:(d:CreateSupplierParams)=>createSupplierApi(d), onSuccess:()=>qc.invalidateQueries({queryKey:[K]}) })
}
export function useUpdateSupplier() {
  const qc=useQueryClient(); return useMutation({ mutationFn:({id,data}:{id:number;data:UpdateSupplierParams})=>updateSupplierApi(id,data), onSuccess:()=>qc.invalidateQueries({queryKey:[K]}) })
}
export function useDeleteSupplier() {
  const qc=useQueryClient()
  return useMutation({
    mutationFn:(id:number)=>deleteSupplierApi(id, { skipGlobalError: true }),
    onSuccess:()=>qc.invalidateQueries({queryKey:[K]}),
    onError:(e:unknown)=>toast.error(e instanceof Error ? e.message : '删除失败'),
  })
}
