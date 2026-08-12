import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { payloadClient as apiClient } from '@/api/client'

export const PRINTERS_QUERY_KEY = 'printers'

export interface Printer {
  id: number
  name: string
  code: string
  type: number
  typeName: string
  description: string
  status: number
  warehouseId?: number | null
  source?: string
  clientId?: string
  clientAliasName?: string | null
  clientHostname?: string | null
  clientDisplayName?: string | null
  createdAt: string
}

export function getPrintersApi() {
  return apiClient.get<Printer[]>('/printers')
}
export function createPrinterApi(
  payload: { name: string; code: string; type: number; description: string | null; clientId?: string | null },
  config?: Parameters<typeof apiClient.post>[2],
) {
  return apiClient.post('/printers', { ...payload, source: 'local_desktop' }, config)
}
export function updatePrinterApi(id: number, data: Record<string, unknown>, config?: Parameters<typeof apiClient.put>[2]) {
  return apiClient.put(`/printers/${id}`, data, config)
}
export function deletePrinterApi(id: number, config?: Parameters<typeof apiClient.delete>[1]) {
  return apiClient.delete(`/printers/${id}`, config)
}
export function updatePrinterClientAliasApi(clientId: string, aliasName: string, config?: Parameters<typeof apiClient.put>[2]) {
  return apiClient.put(`/printers/clients/${clientId}/alias`, { aliasName }, config)
}

export function usePrinters() {
  return useQuery<Printer[]>({
    queryKey: [PRINTERS_QUERY_KEY],
    queryFn: getPrintersApi,
  })
}

export function useCreatePrinter() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: { name: string; code: string; type: number; description: string | null; clientId?: string | null }) =>
      createPrinterApi(payload, { skipGlobalError: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [PRINTERS_QUERY_KEY] }),
  })
}

export function useDeletePrinter() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deletePrinterApi(id, { skipGlobalError: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [PRINTERS_QUERY_KEY] }),
  })
}

export function useTogglePrinterStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (p: Printer) => updatePrinterApi(p.id, { ...p, status: p.status === 1 ? 0 : 1 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [PRINTERS_QUERY_KEY] }),
  })
}

export function useUpdatePrinterClientAlias() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ clientId, aliasName }: { clientId: string; aliasName: string }) =>
      updatePrinterClientAliasApi(clientId, aliasName, { skipGlobalError: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [PRINTERS_QUERY_KEY] }),
  })
}
