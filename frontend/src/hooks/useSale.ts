import { useQuery, useMutation } from '@tanstack/react-query'
import { getSaleListApi, getSaleDetailApi, createSaleApi, updateSaleApi, reserveSaleApi, releaseSaleApi, shipSaleApi, cancelSaleApi, deleteSaleApi } from '@/api/sale'
import { useInvalidate } from '@/hooks/useInvalidate'
import { toast } from '@/lib/toast'
import type { CreateSaleParams, UpdateSaleParams } from '@/types/sale'

export const useSaleList   = (params: object) => useQuery({ queryKey: ['sale', params], queryFn: () => getSaleListApi(params).then(r => r.data.data!) })
export const useSaleDetail = (id: number)     => useQuery({ queryKey: ['sale', id],     queryFn: () => getSaleDetailApi(id).then(r => r.data.data!), enabled: !!id })

export const useCreateSale = () => {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (data: CreateSaleParams) => createSaleApi(data),
    onSuccess: () => invalidate('sale_create'),
  })
}

export const useUpdateSale = () => {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (data: UpdateSaleParams) => updateSaleApi(data),
    onSuccess: () => invalidate('sale_update'),
  })
}

export const useReserveSale = () => {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: number) => reserveSaleApi(id),
    onSuccess: () => invalidate('sale_reserve'),
  })
}

export const useReleaseSale = () => {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: number) => releaseSaleApi(id),
    onSuccess: () => invalidate('sale_reserve'),
  })
}

export const useShipSale = () => {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: number) => shipSaleApi(id),
    onSuccess: () => invalidate('sale_ship'),
  })
}

export const useCancelSale = () => {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: number) => cancelSaleApi(id),
    onSuccess: () => invalidate('sale_cancel'),
  })
}

export const useDeleteSale = () => {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: number) => deleteSaleApi(id),
    onSuccess: () => { invalidate('sale_delete'); toast.success('订单删除成功') },
  })
}
