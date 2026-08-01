import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getInvoicesApi, createInvoiceApi, updateInvoiceApi, changeInvoiceStatusApi, deleteInvoiceApi,
  type InvoiceQuery,
} from '@/api/accounting'
import type { CreateInvoiceParams } from '@/types/accounting'

const QK = 'acct-invoices'

export const useInvoices = (params: InvoiceQuery) =>
  useQuery({ queryKey: [QK, 'list', params], queryFn: () => getInvoicesApi(params) })

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: [QK] })
}

export function useCreateInvoice() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (d: CreateInvoiceParams) => createInvoiceApi(d), onSuccess: () => invalidate(qc) })
}
export function useUpdateInvoice() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: ({ id, d }: { id: number; d: Partial<CreateInvoiceParams> }) => updateInvoiceApi(id, d), onSuccess: () => invalidate(qc) })
}
export function useChangeInvoiceStatus() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: ({ id, action }: { id: number; action: 'certify' | 'deduct' | 'redFlush' }) => changeInvoiceStatusApi(id, action), onSuccess: () => invalidate(qc) })
}
export function useDeleteInvoice() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (id: number) => deleteInvoiceApi(id), onSuccess: () => invalidate(qc) })
}
