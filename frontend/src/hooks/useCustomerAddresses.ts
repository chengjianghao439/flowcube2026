import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getCustomerAddressesApi,
  createCustomerAddressApi,
  updateCustomerAddressApi,
  setDefaultCustomerAddressApi,
  deleteCustomerAddressApi,
} from '@/api/customer-addresses'
import type { CreateCustomerAddressParams, CustomerAddressWritable } from '@/types/customers'
import { toast } from '@/lib/toast'

const key = (customerId: number) => ['customer-addresses', customerId]

export const useCustomerAddresses = (customerId: number | null, enabled = true) =>
  useQuery({
    queryKey: ['customer-addresses', customerId],
    queryFn: () => getCustomerAddressesApi(customerId!).then(r => r ?? []),
    // 键始终保持在 customerId 上（不随关闭切成 null），这样重开弹窗能立刻命中缓存、
    // 不会先闪一下空状态再刷出来；仅用 enabled 控制关闭时不发请求。
    enabled: !!customerId && enabled,
  })

export const useCreateCustomerAddress = (customerId: number) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateCustomerAddressParams) => createCustomerAddressApi(data, { skipGlobalError: true }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: key(customerId) }); toast.success('已保存为常用地址') },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : '保存失败'),
  })
}

export const useUpdateCustomerAddress = (customerId: number) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: CustomerAddressWritable }) => updateCustomerAddressApi(id, data, { skipGlobalError: true }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: key(customerId) }); toast.success('地址已更新') },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : '更新失败'),
  })
}

export const useSetDefaultCustomerAddress = (customerId: number) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => setDefaultCustomerAddressApi(id, { skipGlobalError: true }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: key(customerId) }); toast.success('已设为默认') },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : '设置失败'),
  })
}

export const useDeleteCustomerAddress = (customerId: number) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteCustomerAddressApi(id, { skipGlobalError: true }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: key(customerId) }); toast.success('地址已删除') },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : '删除失败'),
  })
}
