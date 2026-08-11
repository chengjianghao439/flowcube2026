import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getCategoryTreeApi, getCategoryFlatApi, getCategoryLeavesApi,
  createCategoryApi, updateCategoryApi, deleteCategoryApi, toggleCategoryStatusApi,
} from '@/api/categories'
import type { CreateCategoryParams, UpdateCategoryParams } from '@/types/categories'

const QK = 'categories'

export const useCategoryTree   = () => useQuery({ queryKey: [QK, 'tree'],   queryFn: getCategoryTreeApi,   staleTime: 60000 })
export const useCategoryFlat   = () => useQuery({ queryKey: [QK, 'flat'],   queryFn: getCategoryFlatApi,   staleTime: 60000 })
export const useCategoryLeaves = () => useQuery({ queryKey: [QK, 'leaves'], queryFn: getCategoryLeavesApi, staleTime: 60000 })

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: [QK] })
  // 同时让商品分类缓存失效（products 页面也在用）
  qc.invalidateQueries({ queryKey: ['product-categories'] })
}

export function useCreateCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (d: CreateCategoryParams) => createCategoryApi(d),
    onSuccess: () => invalidate(qc),
  })
}

export function useUpdateCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, d }: { id: number; d: UpdateCategoryParams }) => updateCategoryApi(id, d),
    onSuccess: () => invalidate(qc),
  })
}

export function useDeleteCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteCategoryApi(id),
    onSuccess: () => invalidate(qc),
  })
}

export function useToggleCategoryStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: boolean }) => toggleCategoryStatusApi(id, status),
    onSuccess: () => invalidate(qc),
  })
}
