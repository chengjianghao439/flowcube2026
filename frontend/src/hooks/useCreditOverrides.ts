import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  listCreditOverridesApi,
  getCreditOverrideApi,
  createCreditOverrideApi,
  submitCreditOverrideApi,
  cancelCreditOverrideApi,
  approveCreditOverrideApi,
  rejectCreditOverrideApi,
} from '@/api/credit-overrides'
import type { CreateCreditOverrideParams } from '@/types/credit-override'
import { useInvalidate } from './useInvalidate'

const QUERY_KEY = 'credit-overrides'

export function useCreditOverrides(params: Record<string, unknown>) {
  return useQuery({
    queryKey: [QUERY_KEY, params],
    queryFn: () => listCreditOverridesApi(params),
  })
}

export function useCreditOverride(id: number | null) {
  return useQuery({
    queryKey: [QUERY_KEY, 'detail', id],
    queryFn: () => (id ? getCreditOverrideApi(id) : Promise.resolve(null)),
    enabled: !!id,
  })
}

export function useCreateCreditOverride() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (d: CreateCreditOverrideParams) => createCreditOverrideApi(d),
    onSuccess: () => qc.invalidateQueries({ queryKey: [QUERY_KEY] }),
  })
}

export function useSubmitCreditOverride() {
  const qc = useQueryClient()
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (id: number) => submitCreditOverrideApi(id), onSuccess: () => { invalidate('approval_pending_changed'); return qc.invalidateQueries({ queryKey: [QUERY_KEY] }) } })
}

export function useCancelCreditOverride() {
  const qc = useQueryClient()
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (id: number) => cancelCreditOverrideApi(id), onSuccess: () => { invalidate('approval_pending_changed'); return qc.invalidateQueries({ queryKey: [QUERY_KEY] }) } })
}

export function useApproveCreditOverride() {
  const qc = useQueryClient()
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (id: number) => approveCreditOverrideApi(id), onSuccess: () => { invalidate('approval_pending_changed'); return qc.invalidateQueries({ queryKey: [QUERY_KEY] }) } })
}

export function useRejectCreditOverride() {
  const qc = useQueryClient()
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: ({ id, reason }: { id: number; reason: string }) => rejectCreditOverrideApi(id, reason), onSuccess: () => { invalidate('approval_pending_changed'); return qc.invalidateQueries({ queryKey: [QUERY_KEY] }) } })
}
