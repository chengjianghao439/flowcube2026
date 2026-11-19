import { useQuery } from '@tanstack/react-query'
import { getSuppliersApi, getSuppliersActiveApi } from '@/api/suppliers'
import type { QueryParams } from '@/types'
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
