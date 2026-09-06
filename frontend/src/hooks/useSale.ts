import { useRef } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { getSaleListApi, getSaleDetailApi, getSaleReservePreviewApi, createSaleApi, updateSaleApi, adjustSaleApi, reserveSaleApi, releaseSaleApi, shipSaleApi, cancelSaleApi, deleteSaleApi } from '@/api/sale'
import { useInvalidate } from '@/hooks/useInvalidate'
import { toast } from '@/lib/toast'
import { ApiClientError } from '@/api/client'
import { createRequestKey } from '@/lib/requestKey'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { confirmAction } from '@/lib/confirm'
import type { CreateSaleParams, UpdateSaleParams, ReserveItemOverride, ShipItemRequest } from '@/types/sale'

export const useSaleList   = (params: object, summary = false) => useQuery({ queryKey: ['sale', params, summary], queryFn: () => getSaleListApi(params, summary) })
export const useSaleDetail = (id: number)     => useQuery({ queryKey: ['sale', id],     queryFn: () => getSaleDetailApi(id), enabled: !!id })
// 占库分仓弹窗打开时才拉取，避免为每个草稿行都请求一次
export const useSaleReservePreview = (id: number, enabled: boolean) =>
  useQuery({ queryKey: ['sale-reserve-preview', id], queryFn: () => getSaleReservePreviewApi(id), enabled: enabled && !!id })

export const useCreateSale = () => {
  const invalidate = useInvalidate()
  // 稳定幂等键：整个组件生命周期内复用同一 key（重试/网络回退不建重单），成功后轮换供下次新建
  const keyRef = useRef(createRequestKey('sale'))
  return useMutation({
    mutationFn: (data: CreateSaleParams) => createSaleApi(data, keyRef.current),
    onSuccess: () => {
      invalidate('sale_create')
      toast.success('销售单创建成功')
      keyRef.current = createRequestKey('sale')
    },
  })
}

export const useUpdateSale = () => {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (data: UpdateSaleParams) => updateSaleApi(data),
    onSuccess: () => { invalidate('sale_update'); toast.success('订单已保存') },
  })
}

export const useAdjustSale = () => {
  const invalidate = useInvalidate()
  const keyRef = useRef(createRequestKey('sale-adjust'))
  return useMutation({
    mutationFn: (data: UpdateSaleParams) => adjustSaleApi(data, keyRef.current),
    onSuccess: (res) => {
      invalidate('sale_adjust')
      keyRef.current = createRequestKey('sale-adjust')
      toast.success(res?.pending ? '改单已提交，等待仓库确认' : '修改成功')
    },
  })
}

// 占库失败若为库存不足（STOCK_SHORTAGE），带结构化明细交给调用页展示"按可用量修改"；
// 其它错误（如状态已变化）仍走全局 toast（reserveSaleApi 关了自动 toast，这里手动补）。
export const useReserveSale = () => {
  const invalidate = useInvalidate()
  const { can } = usePermission()
  // 稳定幂等键：断网重试/连点复用同一 key，后端据此识别「已成功」避免 reserved_qty 二次累加；
  // 仅在确认成功后轮换（失败保持，因第一次可能已提交但响应丢失）。
  const keyRef = useRef(createRequestKey('sale-reserve'))
  return useMutation({
    // items 可选：占库弹窗逐行选好的发货仓库覆盖；confirmCreditOverride 为超额授权放行
    mutationFn: ({ id, items, confirmCreditOverride }: { id: number; items?: ReserveItemOverride[]; confirmCreditOverride?: boolean }) => reserveSaleApi(id, items, confirmCreditOverride, keyRef.current),
    onSuccess: () => { invalidate('sale_reserve'); toast.success('库存已占用'); keyRef.current = createRequestKey('sale-reserve') },
    onError: (e: unknown, variables) => {
      if (e instanceof ApiClientError && e.code === 'STOCK_SHORTAGE') return
      // 客户授信超额：有放行权限者弹授权确认框，确认后带 confirmCreditOverride 重试；无权限仅提示（后端仍会拦）
      if (e instanceof ApiClientError && e.code === 'CREDIT_LIMIT_EXCEEDED') {
        const d = (e.data ?? {}) as { creditLimit?: number; used?: number; thisOrder?: number; overBy?: number }
        if (can(PERMISSIONS.SALE_CREDIT_OVERRIDE)) {
          confirmAction({
            title: '客户授信额度不足',
            description: `授信额度 ${d.creditLimit}，已用 ${d.used}，本单 ${d.thisOrder}，超出 ${d.overBy}。确认授权超额放行、继续占库？`,
            confirmText: '授权放行',
            variant: 'destructive',
            onConfirm: () => {
              reserveSaleApi(variables.id, variables.items, true, keyRef.current)
                .then(() => { invalidate('sale_reserve'); toast.success('已授权放行，库存已占用'); keyRef.current = createRequestKey('sale-reserve') })
                .catch(err => toast.error(err instanceof ApiClientError ? err.message : '放行占库失败'))
            },
          })
        } else {
          toast.error(`客户授信额度不足，超出 ${d.overBy}，你无放行权限`)
        }
        return
      }
      toast.error(e instanceof ApiClientError ? e.message : '占用库存失败')
    },
  })
}

export const useReleaseSale = () => {
  const invalidate = useInvalidate()
  const keyRef = useRef(createRequestKey('sale-release'))
  return useMutation({
    // items 可选：按产品/数量释放；不传 = 整单释放
    mutationFn: ({ id, items }: { id: number; items?: ReserveItemOverride[] }) => releaseSaleApi(id, items, keyRef.current),
    onSuccess: () => { invalidate('sale_reserve'); toast.success('库存已释放'); keyRef.current = createRequestKey('sale-release') },
  })
}

export const useShipSale = () => {
  const invalidate = useInvalidate()
  const keyRef = useRef(createRequestKey('sale-ship'))
  return useMutation({
    // items 可选：分批发货时按选中的明细行和数量提交
    mutationFn: ({ id, items }: { id: number; items?: ShipItemRequest[] }) => shipSaleApi(id, items, keyRef.current),
    onSuccess: () => { invalidate('sale_ship'); toast.success('已发起出库'); keyRef.current = createRequestKey('sale-ship') },
  })
}

export const useCancelSale = () => {
  const invalidate = useInvalidate()
  const keyRef = useRef(createRequestKey('sale-cancel'))
  return useMutation({
    mutationFn: (id: number) => cancelSaleApi(id, keyRef.current),
    onSuccess: () => { invalidate('sale_cancel'); toast.success('订单已取消'); keyRef.current = createRequestKey('sale-cancel') },
  })
}

export const useDeleteSale = () => {
  const invalidate = useInvalidate()
  const keyRef = useRef(createRequestKey('sale-delete'))
  return useMutation({
    mutationFn: (id: number) => deleteSaleApi(id, keyRef.current),
    onSuccess: () => { invalidate('sale_delete'); toast.success('订单删除成功'); keyRef.current = createRequestKey('sale-delete') },
  })
}
