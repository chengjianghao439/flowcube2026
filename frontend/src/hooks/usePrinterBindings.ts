import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { payloadClient as apiClient } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { hasPermission } from '@/lib/permissions'
import { PERMISSIONS } from '@/lib/permission-codes'

export const PRINTER_BINDINGS_QUERY_KEY = 'printer-bindings'

export type BindingMap = Record<string, { print_type: string; printer_code: string; printer_name: string }>
export type PrinterBindingsPayload = {
  defaultBindings: BindingMap
  routes: Array<Record<string, unknown>>
}

export function getPrinterBindingsApi() {
  return apiClient.get<PrinterBindingsPayload>('/printer-bindings', { skipGlobalError: true })
}
export function bindPrinterApi(type: string, printerId: number, config?: Parameters<typeof apiClient.put>[2]) {
  return apiClient.put(`/printer-bindings/${type}`, { printerId }, config)
}
export function unbindPrinterApi(type: string, config?: Parameters<typeof apiClient.delete>[1]) {
  return apiClient.delete(`/printer-bindings/${encodeURIComponent(type)}`, config)
}

function canReadPrinterBindings() {
  const { token, user } = useAuthStore.getState()
  return Boolean(token && user && hasPermission(user.permissions, PERMISSIONS.PRINT_PRINTER_VIEW, user.roleId))
}

export function usePrinterBindings() {
  const token = useAuthStore(s => s.token)
  const user = useAuthStore(s => s.user)
  return useQuery<BindingMap>({
    queryKey: [PRINTER_BINDINGS_QUERY_KEY],
    enabled: Boolean(token && user && hasPermission(user.permissions, PERMISSIONS.PRINT_PRINTER_VIEW, user.roleId)),
    // refetch可绕过enabled；撤权或退出后也必须在请求边界检查。
    queryFn: async () => canReadPrinterBindings() ? (await getPrinterBindingsApi())?.defaultBindings ?? {} : {},
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
