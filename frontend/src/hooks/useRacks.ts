import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  createRackApi,
  updateRackApi,
} from '@/api/racks'
import type { CreateRackParams, UpdateRackParams } from '@/types/racks'

const QUERY_KEY = 'racks'

export function useCreateRack() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateRackParams) => createRackApi(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: [QUERY_KEY] }),
  })
}

export function useUpdateRack() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateRackParams }) =>
      updateRackApi(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: [QUERY_KEY] }),
  })
}
