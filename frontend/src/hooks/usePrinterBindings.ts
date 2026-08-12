import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { payloadClient as apiClient } from '@/api/client'

export const PRINTER_BINDINGS_QUERY_KEY = 'printer-bindings'

export type BindingMap = Record<string, { print_type: string; printer_code: string; printer_name: string }>
export type PrinterBindingsPayload = {
  defaultBindings: BindingMap
  routes: Array<Record<string, unknown>>
}

export function getPrinterBindingsApi() {
  return apiClient.get<PrinterBindingsPayload>('/printer-bindings')
}
export function bindPrinterApi(type: string, printerId: number, config?: Parameters<typeof apiClient.put>[2]) {
  return apiClient.put(`/printer-bindings/${type}`, { printerId }, config)
}
export function unbindPrinterApi(type: string, config?: Parameters<typeof apiClient.delete>[1]) {
  return apiClient.delete(`/printer-bindings/${encodeURIComponent(type)}`, config)
}

export function usePrinterBindings() {
  return useQuery<BindingMap>({
    queryKey: [PRINTER_BINDINGS_QUERY_KEY],
    queryFn: async () => (await getPrinterBindingsApi())?.defaultBindings ?? {},
  })
}

export function useBindPrinter() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ type, printerId }: { type: string; printerId: number }) =>
      bindPrinterApi(type, printerId, { skipGlobalError: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [PRINTER_BINDINGS_QUERY_KEY] }),
  })
}

export function useUnbindPrinter() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (type: string) => unbindPrinterApi(type, { skipGlobalError: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [PRINTER_BINDINGS_QUERY_KEY] }),
  })
}
