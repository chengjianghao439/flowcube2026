import { useRef } from 'react'
import { captureInboundEditOwner, inboundEditConfig, inboundEditOwnerCurrent, mayUpdateInbound, type InboundEditOwner } from './useInboundTaskEditRecovery'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useInvalidate } from '@/hooks/useInvalidate'
import {
  getInboundTasksApi,
  getInboundTaskEditContextApi,
  getInboundEditPurchaseCandidatesApi,
  getInboundTaskByIdApi,
  getInboundTaskContainersApi,
  getInboundPurchaseCandidatesApi,
  submitInboundTaskApi,
  cancelInboundApi,
  voidInboundReceiptApi,
} from '@/api/inbound-tasks'
import type { QueryParams } from '@/types'

const QUERY_KEY = 'inbound-tasks'

export function useInboundTasks(params: QueryParams & { status?: number; productId?: number }, options?: { refetchInterval?: number | false }) {
  return useQuery({
    queryKey: [QUERY_KEY, params],
    queryFn: () => getInboundTasksApi(params),
    refetchInterval: options?.refetchInterval,
  })
}

export function useInboundTaskDetail(id: number | null, options?: { refetchInterval?: number | false; visible?: boolean }) {
  return useQuery({
    queryKey: [QUERY_KEY, 'detail', id],
    queryFn: ({ signal }) => getInboundTaskByIdApi(id!, { signal, skipGlobalError: true }),
    enabled: !!id && options?.visible !== false,
    subscribed: options?.visible !== false,
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

export function useInboundPurchaseCandidates(supplierId: number | null, keyword: string, edit?: { taskId: number; owner: InboundEditOwner; visible: boolean }) {
  const readable = !edit || edit.visible && inboundEditOwnerCurrent(edit.owner) && mayUpdateInbound()
  return useQuery({
    queryKey: [QUERY_KEY, 'purchase-items', supplierId, keyword, edit?.taskId, edit?.owner],
    queryFn: async ({ signal }) => {
      if (!readable) throw Error('原编辑来源已暂停')
      const data = edit ? await getInboundEditPurchaseCandidatesApi(edit.taskId, keyword, { ...inboundEditConfig(edit.owner), signal }) : await getInboundPurchaseCandidatesApi({ supplierId: supplierId!, keyword }, { signal, skipGlobalError: true })
      if (edit && !inboundEditOwnerCurrent(edit.owner)) throw Error('原账号或服务器已变化，已选数量保留')
      return data
    },
    enabled: !!supplierId && readable,
    ...(edit ? { staleTime: 0, gcTime: 0, refetchOnMount: 'always' as const } : {}),
  })
}

export { useInboundTaskCreateRecovery as useCreateInboundTask } from './useInboundTaskCreateRecovery'

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

export { useCloseReceivingInbound } from './useCloseReceivingInbound'

export { useInboundTaskEditRecovery } from './useInboundTaskEditRecovery'

/** 新编辑实例只使用本次成功读取；原标签和账号端点固定，不共享详情轮询基线。 */
export function useInboundTaskEditContext(id: number | null, active: boolean, owner: InboundEditOwner = captureInboundEditOwner()) {
  const latest = useRef({ active, generation: 0 })
  if (latest.current.active !== active) latest.current = { active, generation: latest.current.generation + 1 }
  const generation = latest.current.generation
  const readable = !!id && active && inboundEditOwnerCurrent(owner) && mayUpdateInbound()
  const current = () => latest.current.active && latest.current.generation === generation && inboundEditOwnerCurrent(owner) && mayUpdateInbound()
  return useQuery({
    queryKey: [QUERY_KEY, 'edit-context', id, owner, generation],
    queryFn: async ({ signal }) => {
      if (!current()) throw Error('原编辑读取已暂停')
      const context = await getInboundTaskEditContextApi(id!, { ...inboundEditConfig(owner), signal })
      if (!current() || context.task.id !== id) throw Error('返回资料不属于原收货单，草稿保持')
      return context
    },
    enabled: readable, subscribed: readable, staleTime: 0, gcTime: 0, refetchOnMount: 'always', retry: false,
  })
}
