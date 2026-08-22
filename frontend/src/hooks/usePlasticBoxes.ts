import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { payloadClient } from '@/api/client'

const QUERY_KEY = 'plastic-boxes'

export interface PlasticBox {
  id: number
  barcode: string
  productId: number | null
  productName: string | null
  productCode: string | null
  warehouseId: number | null
  warehouseName: string | null
  locationId: number | null
  locationName: string | null
  remainingQty: number
  status: number
  unit: string
  createdAt: string
  updatedAt: string
}

export function getPlasticBoxesApi(params?: Record<string, string | number>) {
  return payloadClient.get<{ list: PlasticBox[]; pagination: { page: number; pageSize: number; total: number } }>('/plastic-boxes', { params })
}
export function createPlasticBoxApi(data: Record<string, unknown>, config?: Parameters<typeof payloadClient.post>[2]) {
  return payloadClient.post<{ id: number; barcode: string }>('/plastic-boxes', data, config)
}
export function deletePlasticBoxApi(id: number, config?: Parameters<typeof payloadClient.delete>[1]) {
  return payloadClient.delete(`/plastic-boxes/${id}`, config)
}

export function usePlasticBoxes(keyword: string) {
  return useQuery({
    queryKey: [QUERY_KEY, keyword],
    queryFn: () => getPlasticBoxesApi({ pageSize: 500, keyword }),
  })
}

export function useCreatePlasticBox() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => createPlasticBoxApi(data, { skipGlobalError: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [QUERY_KEY] }),
  })
}

export function useDeletePlasticBox() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deletePlasticBoxApi(id, { skipGlobalError: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [QUERY_KEY] }),
  })
}

// ── 塑料盒流水（详情弹窗）───────────────────────────────────────────────────
export interface PlasticBoxMovement {
  qty: number
  type: number
  moveType: number | null
  moveTypeName: string | null
  remark: string | null
  refNo: string | null
  operatorName: string | null
  productName: string | null
  createdAt: string
}
export function getPlasticBoxMovementsApi(id: number) {
  return payloadClient.get<PlasticBoxMovement[]>(`/plastic-boxes/${id}/movements`)
}

export function usePlasticBoxMovements(boxId: number | null) {
  return useQuery({
    queryKey: ['plastic-box-movements', boxId],
    queryFn: () => getPlasticBoxMovementsApi(boxId!),
    enabled: !!boxId,
  })
}
