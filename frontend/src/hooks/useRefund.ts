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
function invalidateFinance(qc: ReturnType<typeof useQueryClient>) {
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
  return useMutation({ mutationFn: (id: number) => executeRefundApi(id), onSuccess: () => invalidateFinance(qc) })
}
export function useCancelRefund() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (id: number) => cancelRefundApi(id), onSuccess: () => invalidate(qc) })
}
