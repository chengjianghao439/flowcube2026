import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getCheckListApi, getCheckDetailApi, createCheckApi, updateCheckItemsApi, submitCheckApi, cancelCheckApi } from '@/api/stockcheck'
import { useInvalidate } from '@/hooks/useInvalidate'
import type { CreateCheckParams } from '@/types/stockcheck'

export const useCheckList   = (params: object) => useQuery({ queryKey: ['stockcheck', params], queryFn: () => getCheckListApi(params) })
export const useCheckDetail = (id: number)     => useQuery({ queryKey: ['stockcheck', id],     queryFn: () => getCheckDetailApi(id), enabled: !!id, refetchInterval: false })

export const useCreateCheck = () => {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (data: CreateCheckParams) => createCheckApi(data), onSuccess: () => invalidate('stockcheck_action') })
}

export const useUpdateCheckItems = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, items }: { id: number; items: { id: number; actualQty: number }[] }) => updateCheckItemsApi(id, items),
    onSuccess: (_, v) => qc.invalidateQueries({ queryKey: ['stockcheck', v.id] }),
  })
}

export const useSubmitCheck = () => {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (id: number) => submitCheckApi(id), onSuccess: () => invalidate('stockcheck_submit') })
}

export const useCancelCheck = () => {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (id: number) => cancelCheckApi(id), onSuccess: () => invalidate('stockcheck_action') })
}
