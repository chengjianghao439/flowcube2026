import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getRefundListApi, getRefundDetailApi, createRefundApi, submitRefundApi, executeRefundApi, cancelRefundApi } from '@/api/refund'
import type { CreateRefundParams } from '@/types/refund'

const QK = 'refund-orders'

export const useRefundList = (params: object) =>
  useQuery({ queryKey: [QK, 'list', params], queryFn: () => getRefundListApi(params) })

export const useRefundDetail = (id: number) =>
  useQuery({ queryKey: [QK, id], queryFn: () => getRefundDetailApi(id), enabled: !!id })

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: [QK] })
}

// 退款执行（execute）会写 payment_records 并刷新对账单投影（后端同事务 refreshSettlement），
// 财务页收款核销/对账/资金账户/看板须同步失效（审计 2026-08-30：此前只刷退款列表）。
// 退出「未确认」状态查回执确认成功时，调用点也要用它刷新（见 RefundDetailDialog）。
export function invalidateFinance(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: [QK] })
  qc.invalidateQueries({ queryKey: ['payments'] })
  qc.invalidateQueries({ queryKey: ['reconciliation'] })
  qc.invalidateQueries({ queryKey: ['finance-accounts'] })
  qc.invalidateQueries({ queryKey: ['finance-dashboard'] })
}

export function useCreateRefund() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (d: CreateRefundParams) => createRefundApi(d), onSuccess: () => invalidate(qc) })
}
export function useSubmitRefund() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (id: number) => submitRefundApi(id), onSuccess: () => invalidate(qc) })
}
export function useExecuteRefund() {
  const qc = useQueryClient()
  // 请求键由调用点持有（见 useIdempotentSubmit）：什么时候换键是「这笔到底做没做成」的判断，
  // 只有调用点知道。这里只管发请求与刷新视图。
  return useMutation({
    mutationFn: ({ id, requestKey, backfillReason }: { id: number; requestKey: string; backfillReason?: string }) =>
      executeRefundApi(id, requestKey, backfillReason ? { reason: backfillReason } : undefined, { skipGlobalError: true }),
    onSuccess: () => invalidateFinance(qc),
  })
}
export function useCancelRefund() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (id: number) => cancelRefundApi(id), onSuccess: () => invalidate(qc) })
}
