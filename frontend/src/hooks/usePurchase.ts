import { useRef } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { getPurchaseListApi, getPurchaseDetailApi, createPurchaseApi, updatePurchaseApi, confirmPurchaseApi, cancelPurchaseApi, closePurchaseApi } from '@/api/purchase'
import { useInvalidate } from '@/hooks/useInvalidate'
import { createRequestKey } from '@/lib/requestKey'
import type { CreatePurchaseParams } from '@/types/purchase'

export const usePurchaseList   = (params: object) => useQuery({ queryKey: ['purchase', params], queryFn: () => getPurchaseListApi(params) })
export const usePurchaseDetail = (id: number)     => useQuery({ queryKey: ['purchase', id],     queryFn: () => getPurchaseDetailApi(id), enabled: !!id })

export const useCreatePurchase = () => {
  const invalidate = useInvalidate()
  // 稳定幂等键：整个组件生命周期内复用同一 key（重试/网络回退不建重单），成功后轮换供下次新建
  const keyRef = useRef(createRequestKey('purchase'))
  return useMutation({
    mutationFn: (data: CreatePurchaseParams) => createPurchaseApi(data, keyRef.current),
    onSuccess: () => {
      invalidate('purchase_create')
      keyRef.current = createRequestKey('purchase')
    },
  })
}

export const useUpdatePurchase = () => {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: CreatePurchaseParams }) => updatePurchaseApi(id, data),
    onSuccess: () => invalidate('purchase_update'),
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

export const useClosePurchase = () => {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: number) => closePurchaseApi(id),
    onSuccess: () => invalidate('purchase_close'),
  })
}
