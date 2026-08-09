import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getDisposalListApi,
  getDisposalDetailApi,
  getDisposalSuggestionsApi,
  createDisposalApi,
  submitDisposalApi,
  approveDisposalApi,
  rejectDisposalApi,
  disposeDisposalApi,
  cancelDisposalApi,
} from '@/api/disposal'
import { useInvalidate } from '@/hooks/useInvalidate'
import type { DisposalSuggestionParams, CreateDisposalParams } from '@/types/disposal'

export const useDisposalList = (params: object) =>
  useQuery({ queryKey: ['disposals', params], queryFn: () => getDisposalListApi(params) })

export const useDisposalDetail = (id: number) =>
  useQuery({ queryKey: ['disposals', id], queryFn: () => getDisposalDetailApi(id), enabled: !!id })

export const useDisposalSuggestions = (params: DisposalSuggestionParams) =>
  useQuery({
    queryKey: ['disposal-suggestions', params],
    queryFn: () => getDisposalSuggestionsApi(params),
    enabled: !!params.warehouseId,
  })

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
    dispose: useMutation({
      mutationFn: (id: number) => disposeDisposalApi(id),
      onSuccess: (_, id) => { qc.invalidateQueries({ queryKey: ['disposals', id] }); invalidate('disposal_execute') },
    }),
    cancel: useMutation({
      mutationFn: (id: number) => cancelDisposalApi(id),
      onSuccess: (_, id) => { qc.invalidateQueries({ queryKey: ['disposals', id] }); invalidate('disposals_action') },
    }),
  }
}
