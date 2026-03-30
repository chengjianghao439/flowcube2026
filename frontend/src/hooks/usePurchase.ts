import { useQuery, useMutation } from '@tanstack/react-query'
import { getPurchaseListApi, getPurchaseDetailApi, createPurchaseApi, confirmPurchaseApi, cancelPurchaseApi } from '@/api/purchase'
import { useInvalidate } from '@/hooks/useInvalidate'
import type { CreatePurchaseParams } from '@/types/purchase'

export const usePurchaseList   = (params: object) => useQuery({ queryKey: ['purchase', params], queryFn: () => getPurchaseListApi(params).then(r => r.data.data!) })
export const usePurchaseDetail = (id: number)     => useQuery({ queryKey: ['purchase', id],     queryFn: () => getPurchaseDetailApi(id).then(r => r.data.data!), enabled: !!id })

export const useCreatePurchase = () => {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (data: CreatePurchaseParams) => createPurchaseApi(data),
    onSuccess: () => invalidate('purchase_create'),
  })
}

export const useConfirmPurchase = () => {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: number) => confirmPurchaseApi(id),
    onSuccess: () => invalidate('purchase_confirm'),
  })
}

export const useCancelPurchase = () => {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: number) => cancelPurchaseApi(id),
    onSuccess: () => invalidate('purchase_cancel'),
  })
}
