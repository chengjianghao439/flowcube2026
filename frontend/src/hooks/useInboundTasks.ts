import { useQuery, useMutation } from '@tanstack/react-query'
import { useInvalidate } from '@/hooks/useInvalidate'
import {
  getInboundTasksApi,
  getInboundTaskByIdApi,
  getInboundTaskContainersApi,
  createInboundTaskApi,
  getInboundPurchaseCandidatesApi,
  submitInboundTaskApi,
  cancelInboundApi,
  voidInboundReceiptApi,
  closeReceivingInboundApi,
} from '@/api/inbound-tasks'
import type { QueryParams } from '@/types'
import type { CreateInboundTaskParams } from '@/types/inbound-tasks'

const QUERY_KEY = 'inbound-tasks'

export function useInboundTasks(params: QueryParams & { status?: number; productId?: number }, options?: { refetchInterval?: number | false }) {
  return useQuery({
    queryKey: [QUERY_KEY, params],
    queryFn: () => getInboundTasksApi(params),
    refetchInterval: options?.refetchInterval,
  })
}

export function useInboundTaskDetail(id: number | null, options?: { refetchInterval?: number | false }) {
  return useQuery({
    queryKey: [QUERY_KEY, 'detail', id],
    queryFn: () => getInboundTaskByIdApi(id!),
    enabled: !!id,
    refetchInterval: options?.refetchInterval,
  })
}

export function useInboundTaskContainers(id: number | null) {
  return useQuery({
    queryKey: [QUERY_KEY, 'containers', id],
    queryFn: () => getInboundTaskContainersApi(id!),
    enabled: !!id,
  })
}

export function useInboundPurchaseCandidates(supplierId: number | null, keyword: string) {
  return useQuery({
    queryKey: [QUERY_KEY, 'purchase-items', supplierId, keyword],
    queryFn: () => getInboundPurchaseCandidatesApi({ supplierId: supplierId!, keyword }).then(r => r ?? []),
    enabled: !!supplierId,
  })
}

export function useCreateInboundTask() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (data: CreateInboundTaskParams) => createInboundTaskApi(data, { skipGlobalError: true }),
    onSettled: () => invalidate('inbound_create'),
  })
}

export function useSubmitInboundTask() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: number) => submitInboundTaskApi(id, { skipGlobalError: true }),
    onSuccess: () => invalidate('inbound_submit'),
  })
}

export function useCancelInbound() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: number) => cancelInboundApi(id, { skipGlobalError: true }),
    onSuccess: () => invalidate('inbound_cancel'),
  })
}

export function useVoidInboundReceipt() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: number) => voidInboundReceiptApi(id, { skipGlobalError: true }),
    onSuccess: () => invalidate('inbound_void_receipt'),
  })
}

export function useCloseReceivingInbound() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: number) => closeReceivingInboundApi(id, { skipGlobalError: true }),
    onSuccess: () => invalidate('inbound_close_receiving'),
  })
}
