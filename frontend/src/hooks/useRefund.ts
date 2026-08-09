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
  return useMutation({ mutationFn: (id: number) => executeRefundApi(id), onSuccess: () => invalidate(qc) })
}
export function useCancelRefund() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (id: number) => cancelRefundApi(id), onSuccess: () => invalidate(qc) })
}
