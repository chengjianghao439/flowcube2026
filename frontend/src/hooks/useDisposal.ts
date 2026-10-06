import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getDisposalListApi,
  getDisposalDetailApi,
  getDisposalSuggestionsApi,
  createDisposalApi,
  submitDisposalApi,
  approveDisposalApi,
  rejectDisposalApi,
  cancelDisposalApi,
} from '@/api/disposal'
import { useSectionActive } from '@/components/layout/SectionVisibilityContext'
import { useSyncExternalStore } from 'react'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { captureDisposalOwner, disposalConfig, disposalOwnerCurrent, disposalRevision, subscribeDisposalRecovery } from '@/lib/disposalRecovery'
import { useInvalidate } from '@/hooks/useInvalidate'
import type { DisposalSuggestionParams, CreateDisposalParams } from '@/types/disposal'

function useReadContext(enabled = true) {
  useSyncExternalStore(subscribeDisposalRecovery, disposalRevision)
  const owner = captureDisposalOwner(), active = useSectionActive(), { can } = usePermission()
  return { owner, allowed: enabled && active && can(PERMISSIONS.INVENTORY_DISPOSAL_VIEW), key: [owner.userId, owner.baseURL, owner.sessionGeneration, owner.epoch], async read<T>(get: () => Promise<T>) { if (!disposalOwnerCurrent(owner)) throw Error('读取归属已变化'); const data = await get(); if (!disposalOwnerCurrent(owner)) throw Error('读取归属已变化，忽略旧结果'); return data } }
}
export function useDisposalList(params: object) {
  const scope = useReadContext()
  return useQuery({ queryKey: ['disposals', 'list', scope.key, params], queryFn: () => scope.read(() => getDisposalListApi(params, disposalConfig(scope.owner))), enabled: scope.allowed })
}
export function useDisposalDetail(id: number, enabled = true) {
  const scope = useReadContext(enabled && !!id)
  return useQuery({ queryKey: ['disposals', id, scope.key], queryFn: () => scope.read(() => getDisposalDetailApi(id, disposalConfig(scope.owner))), enabled: scope.allowed })
}
export function useDisposalSuggestions(params: DisposalSuggestionParams, enabled = true) {
  const scope = useReadContext(enabled && !!params.warehouseId)
  return useQuery({ queryKey: ['disposal-suggestions', scope.key, params], queryFn: () => scope.read(() => getDisposalSuggestionsApi(params, disposalConfig(scope.owner))), enabled: scope.allowed })
}

/** 处置链路动作会改变单据状态 + 可能动库存，成功后整体失效列表与详情 */
export const useDisposalMutation = () => {
  const invalidate = useInvalidate()
  const qc = useQueryClient()
  return {
    create: useMutation({
      mutationFn: (data: CreateDisposalParams) => createDisposalApi(data),
      onSuccess: () => invalidate('disposals_action'),
    }),
    submit: useMutation({
      mutationFn: (id: number) => submitDisposalApi(id),
      onSuccess: (_, id) => { qc.invalidateQueries({ queryKey: ['disposals', id] }); invalidate('disposals_action') },
    }),
    approve: useMutation({
      mutationFn: (id: number) => approveDisposalApi(id),
      onSuccess: (_, id) => { qc.invalidateQueries({ queryKey: ['disposals', id] }); invalidate('disposals_action') },
    }),
    reject: useMutation({
      mutationFn: ({ id, reason }: { id: number; reason?: string }) => rejectDisposalApi(id, reason),
      onSuccess: (_, v) => { qc.invalidateQueries({ queryKey: ['disposals', v.id] }); invalidate('disposals_action') },
    }),
    cancel: useMutation({
      mutationFn: (id: number) => cancelDisposalApi(id),
      onSuccess: (_, id) => { qc.invalidateQueries({ queryKey: ['disposals', id] }); invalidate('disposals_action') },
    }),
  }
}
