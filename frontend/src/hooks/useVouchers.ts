import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getVouchersApi, getVoucherApi, generateVouchersApi,
  createManualVoucherApi, reverseVoucherApi, deleteVoucherApi, getReconciliationApi,
  type VoucherQuery,
} from '@/api/accounting'
import type { CreateManualVoucherParams } from '@/types/accounting'

const QK = 'acct-vouchers'

export const useVouchers = (params: VoucherQuery) =>
  useQuery({ queryKey: [QK, 'list', params], queryFn: () => getVouchersApi(params) })

export const useVoucher = (id: number | null) =>
  useQuery({ queryKey: [QK, 'detail', id], queryFn: () => getVoucherApi(id as number), enabled: !!id })

export const useReconciliation = () =>
  useQuery({ queryKey: [QK, 'reconciliation'], queryFn: getReconciliationApi, staleTime: 30000 })

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: [QK] })
}

export function useGenerateVouchers() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (period?: string | null) => generateVouchersApi(period),
    onSuccess: () => invalidate(qc),
  })
}

export function useCreateManualVoucher() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (d: CreateManualVoucherParams) => createManualVoucherApi(d),
    onSuccess: () => invalidate(qc),
  })
}

export function useReverseVoucher() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => reverseVoucherApi(id),
    onSuccess: () => invalidate(qc),
  })
}

export function useDeleteVoucher() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteVoucherApi(id),
    onSuccess: () => invalidate(qc),
  })
}
