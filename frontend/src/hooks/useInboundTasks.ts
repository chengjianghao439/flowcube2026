import { useQuery, useMutation } from '@tanstack/react-query'
import { useInvalidate } from '@/hooks/useInvalidate'
import {
  getInboundTasksApi,
  getInboundTaskByIdApi,
  getInboundTaskContainersApi,
  createInboundTaskApi,
  receiveInboundApi,
  cancelInboundApi,
} from '@/api/inbound-tasks'
import type { QueryParams } from '@/types'
import type { ReceiveParams, ReceivePackageResult } from '@/types/inbound-tasks'

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

export function useInboundTaskContainers(id: number | null) {
  return useQuery({
    queryKey: [QUERY_KEY, 'containers', id],
    queryFn: () => getInboundTaskContainersApi(id!).then(r => r.data.data!),
    enabled: !!id,
  })
}

export function useCreateInboundTask() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (poId: number) => createInboundTaskApi(poId).then(r => r.data.data!),
    /**
     * 成功 / 失败（含「已有未完结入库任务」）都要刷新采购单：
     * 避免中途离开页面、仅收到错误响应等情况下 UI 仍显示「创建入库任务」。
     */
    onSettled: () => invalidate('inbound_create'),
  })
}

export function useReceiveInbound() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: ReceiveParams }) => {
      const res = await receiveInboundApi(id, data)
      return res.data.data as ReceivePackageResult
    },
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
