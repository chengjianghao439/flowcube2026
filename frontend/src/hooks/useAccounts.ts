import { useCompanyQueryKey } from '@/hooks/useCompanyQueryKey'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getAccountTreeApi, getAccountFlatApi,
  createAccountApi, updateAccountApi, deleteAccountApi, toggleAccountStatusApi,
} from '@/api/accounting'
import type { CreateAccountParams, UpdateAccountParams } from '@/types/accounting'

const QK = 'acct-accounts'

export const useAccountTree = () =>
  useQuery({ queryKey: useCompanyQueryKey([QK, 'tree']), queryFn: getAccountTreeApi, staleTime: 60000 })

export const useAccountFlat = (opts?: { onlyLeaf?: boolean; onlyActive?: boolean }) =>
  useQuery({ queryKey: useCompanyQueryKey([QK, 'flat', opts]), queryFn: () => getAccountFlatApi(opts), staleTime: 60000 })

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: [QK] })
}

export function useCreateAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (d: CreateAccountParams) => createAccountApi(d),
    onSuccess: () => invalidate(qc),
  })
}

export function useUpdateAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, d }: { id: number; d: UpdateAccountParams }) => updateAccountApi(id, d),
    onSuccess: () => invalidate(qc),
  })
}

export function useDeleteAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteAccountApi(id),
    onSuccess: () => invalidate(qc),
  })
}

export function useToggleAccountStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) => toggleAccountStatusApi(id, isActive),
    onSuccess: () => invalidate(qc),
  })
}
