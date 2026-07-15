import { useQuery, useMutation } from '@tanstack/react-query'
import { getSaleListApi, getSaleDetailApi, createSaleApi, updateSaleApi, reserveSaleApi, releaseSaleApi, shipSaleApi, cancelSaleApi, deleteSaleApi } from '@/api/sale'
import { useInvalidate } from '@/hooks/useInvalidate'
import { toast } from '@/lib/toast'
import type { CreateSaleParams, UpdateSaleParams } from '@/types/sale'

export const useSaleList   = (params: object) => useQuery({ queryKey: ['sale', params], queryFn: () => getSaleListApi(params) })
export const useSaleDetail = (id: number)     => useQuery({ queryKey: ['sale', id],     queryFn: () => getSaleDetailApi(id), enabled: !!id })

export const useCreateSale = () => {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (data: CreateSaleParams) => createSaleApi(data),
    onSuccess: () => { invalidate('sale_create'); toast.success('销售单创建成功') },
  })
}

export const useUpdateSale = () => {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (data: UpdateSaleParams) => updateSaleApi(data),
    onSuccess: () => { invalidate('sale_update'); toast.success('订单已保存') },
  })
}

export const useReserveSale = () => {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: number) => reserveSaleApi(id),
    onSuccess: () => { invalidate('sale_reserve'); toast.success('库存已占用') },
  })
}

export const useReleaseSale = () => {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: number) => releaseSaleApi(id),
    onSuccess: () => { invalidate('sale_reserve'); toast.success('库存已释放') },
  })
}

export const useShipSale = () => {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: number) => shipSaleApi(id),
    onSuccess: () => { invalidate('sale_ship'); toast.success('已发起出库') },
  })
}

export const useCancelSale = () => {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: number) => cancelSaleApi(id),
    onSuccess: () => { invalidate('sale_cancel'); toast.success('订单已取消') },
  })
}

export const useDeleteSale = () => {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: number) => deleteSaleApi(id),
    onSuccess: () => { invalidate('sale_delete'); toast.success('订单删除成功') },
  })
}
