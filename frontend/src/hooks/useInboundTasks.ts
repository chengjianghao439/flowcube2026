import { useQuery, useMutation } from '@tanstack/react-query'
import { useInvalidate } from '@/hooks/useInvalidate'
import {
  getInboundTasksApi,
  getInboundTaskByIdApi,
  getInboundTaskContainersApi,
  createInboundTaskApi,
  getInboundPurchaseCandidatesApi,
  submitInboundTaskApi,
  auditInboundTaskApi,
  reprintInboundTaskApi,
  receiveInboundApi,
  cancelInboundApi,
} from '@/api/inbound-tasks'
import type { QueryParams } from '@/types'
import type { AuditInboundTaskParams, CreateInboundTaskParams, ReceiveParams, ReceivePackageResult, ReprintInboundTaskParams } from '@/types/inbound-tasks'

const QUERY_KEY = 'inbound-tasks'

export function useInboundTasks(params: QueryParams & { status?: number; productId?: number }) {
  return useQuery({
    queryKey: [QUERY_KEY, params],
    queryFn: () => getInboundTasksApi(params),
  })
}

export function useInboundTaskDetail(id: number | null) {
  return useQuery({
    queryKey: [QUERY_KEY, 'detail', id],
    queryFn: () => getInboundTaskByIdApi(id!),
    enabled: !!id,
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
    mutationFn: (data: CreateInboundTaskParams) => createInboundTaskApi(data),
    onSettled: () => invalidate('inbound_create'),
  })
}

export function useReceiveInbound() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: ReceiveParams }) => {
      const res = await receiveInboundApi(id, data)
      return res as ReceivePackageResult
    },
    onSuccess: () => invalidate('inbound_receive'),
  })
}

export function useSubmitInboundTask() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: number) => submitInboundTaskApi(id),
    onSuccess: () => invalidate('inbound_submit'),
  })
}

export function useAuditInboundTask() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: AuditInboundTaskParams }) => auditInboundTaskApi(id, data),
    onSuccess: () => invalidate('inbound_submit'),
  })
}

export function useReprintInboundTask() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: ReprintInboundTaskParams }) => reprintInboundTaskApi(id, data),
    onSuccess: () => invalidate('inbound_receive'),
  })
}

export function useCancelInbound() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: number) => cancelInboundApi(id),
    onSuccess: () => invalidate('inbound_cancel'),
  })
}
