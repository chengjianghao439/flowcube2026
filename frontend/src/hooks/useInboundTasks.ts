import { useQuery, useMutation } from '@tanstack/react-query'
import { useInvalidate } from '@/hooks/useInvalidate'
import {
  getInboundTasksApi,
  getInboundTaskByIdApi,
  receiveInboundApi,
  putawayInboundApi,
  cancelInboundApi,
} from '@/api/inbound-tasks'
import type { QueryParams } from '@/types'
import type { ReceiveParams, PutawayParams } from '@/types/inbound-tasks'

const QUERY_KEY = 'inbound-tasks'

export function useInboundTasks(params: QueryParams & { status?: number }) {
  return useQuery({
    queryKey: [QUERY_KEY, params],
    queryFn: () => getInboundTasksApi(params).then(r => r.data.data),
  })
}

export function useInboundTaskDetail(id: number | null) {
  return useQuery({
    queryKey: [QUERY_KEY, 'detail', id],
    queryFn: () => getInboundTaskByIdApi(id!).then(r => r.data.data),
    enabled: !!id,
  })
}

export function useReceiveInbound() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: ReceiveParams }) => receiveInboundApi(id, data),
    onSuccess: () => invalidate('inbound_receive'),
  })
}

export function usePutawayInbound() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: PutawayParams }) => putawayInboundApi(id, data),
    onSuccess: () => invalidate('inbound_putaway'),
  })
}

export function useCancelInbound() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: number) => cancelInboundApi(id),
    onSuccess: () => invalidate('inbound_cancel'),
  })
}
