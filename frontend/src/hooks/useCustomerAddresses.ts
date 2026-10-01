import { useRef } from 'react'
import type { KitReadOwner } from '@/api/kits'
import { assertKitReadOwner } from './useKits'
import { commercialReadConfig } from '@/api/sale-commercial'
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

const key = (customerId: number, readOwner?: KitReadOwner) => readOwner
  ? ['customer-addresses', customerId, readOwner.baseURL, readOwner.userId, readOwner.sessionGeneration]
  : ['customer-addresses', customerId]

export const useCustomerAddresses = (customerId: number | null, enabled = true, readOwner?: KitReadOwner) =>
  useQuery({
    queryKey: readOwner ? ['customer-addresses', customerId, readOwner.baseURL, readOwner.userId, readOwner.sessionGeneration] : ['customer-addresses', customerId],
    queryFn: async () => {
      if (!readOwner) return getCustomerAddressesApi(customerId!).then(r => r ?? [])
      assertKitReadOwner(readOwner)
      const data = await getCustomerAddressesApi(customerId!, commercialReadConfig(readOwner))
      assertKitReadOwner(readOwner)
      return data ?? []
    },
    // 键始终保持在 customerId 上（不随关闭切成 null），这样重开弹窗能立刻命中缓存、
    // 不会先闪一下空状态再刷出来；仅用 enabled 控制关闭时不发请求。
    enabled: !!customerId && enabled,
  })

export const useCreateCustomerAddress = (customerId: number, readOwner?: KitReadOwner, getDraftContext?: () => string) => {
  const qc = useQueryClient()
  const currentCustomer = useRef(customerId)
  currentCustomer.current = customerId
  return useMutation({
    onMutate: () => ({ customerId, readOwner, getDraftContext, draftContext: getDraftContext?.() }),
    mutationFn: async (data: CreateCustomerAddressParams) => {
      if (readOwner) assertKitReadOwner(readOwner)
      const result = await createCustomerAddressApi(data, readOwner ? commercialReadConfig(readOwner) : { skipGlobalError: true })
      if (readOwner) assertKitReadOwner(readOwner)
      return result
    },
    onSuccess: (_data, _variables, context) => {
      if (context?.readOwner) {
        assertKitReadOwner(context.readOwner)
        if (currentCustomer.current !== context.customerId) throw new Error('地址属于原客户，请回原客户核对处理结果')
      }
      qc.invalidateQueries({ queryKey: key(context?.customerId ?? customerId, context?.readOwner), ...(context?.readOwner ? { exact: true } : {}) })
      if (context?.readOwner && context.getDraftContext && context.getDraftContext() !== context.draftContext) {
        toast.success('原地址操作已完成，当前输入仍未保存；请核对地址列表')
        return
      }
      toast.success('已保存为常用地址')
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : '保存失败'),
  })
}

export const useUpdateCustomerAddress = (customerId: number, readOwner?: KitReadOwner, getDraftContext?: () => string) => {
  const qc = useQueryClient()
  const currentCustomer = useRef(customerId)
  currentCustomer.current = customerId
  return useMutation({
    onMutate: () => ({ customerId, readOwner, getDraftContext, draftContext: getDraftContext?.() }),
    mutationFn: async ({ id, data }: { id: number; data: CustomerAddressWritable }) => {
      if (readOwner) assertKitReadOwner(readOwner)
      const result = await updateCustomerAddressApi(id, data, readOwner ? commercialReadConfig(readOwner) : { skipGlobalError: true })
      if (readOwner) assertKitReadOwner(readOwner)
      return result
    },
    onSuccess: (_data, _variables, context) => {
      if (context?.readOwner) {
        assertKitReadOwner(context.readOwner)
        if (currentCustomer.current !== context.customerId) throw new Error('地址属于原客户，请回原客户核对处理结果')
      }
      qc.invalidateQueries({ queryKey: key(context?.customerId ?? customerId, context?.readOwner), ...(context?.readOwner ? { exact: true } : {}) })
      if (context?.readOwner && context.getDraftContext && context.getDraftContext() !== context.draftContext) {
        toast.success('原地址操作已完成，当前输入仍未保存；请核对地址列表')
        return
      }
      toast.success('地址已更新')
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : '更新失败'),
  })
}

export const useSetDefaultCustomerAddress = (customerId: number, readOwner?: KitReadOwner, getDraftContext?: () => string) => {
  const qc = useQueryClient()
  const currentCustomer = useRef(customerId)
  currentCustomer.current = customerId
  return useMutation({
    onMutate: () => ({ customerId, readOwner, getDraftContext, draftContext: getDraftContext?.() }),
    mutationFn: async (id: number) => {
      if (readOwner) assertKitReadOwner(readOwner)
      const result = await setDefaultCustomerAddressApi(id, readOwner ? commercialReadConfig(readOwner) : { skipGlobalError: true })
      if (readOwner) assertKitReadOwner(readOwner)
      return result
    },
    onSuccess: (_data, _variables, context) => {
      if (context?.readOwner) {
        assertKitReadOwner(context.readOwner)
        if (currentCustomer.current !== context.customerId) throw new Error('地址属于原客户，请回原客户核对处理结果')
      }
      qc.invalidateQueries({ queryKey: key(context?.customerId ?? customerId, context?.readOwner), ...(context?.readOwner ? { exact: true } : {}) })
      if (context?.readOwner && context.getDraftContext && context.getDraftContext() !== context.draftContext) {
        toast.success('原地址操作已完成，当前输入仍未保存；请核对地址列表')
        return
      }
      toast.success('已设为默认')
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : '设置失败'),
  })
}

export const useDeleteCustomerAddress = (customerId: number, readOwner?: KitReadOwner, getDraftContext?: () => string) => {
  const qc = useQueryClient()
  const currentCustomer = useRef(customerId)
  currentCustomer.current = customerId
  return useMutation({
    onMutate: () => ({ customerId, readOwner, getDraftContext, draftContext: getDraftContext?.() }),
    mutationFn: async (id: number) => {
      if (readOwner) assertKitReadOwner(readOwner)
      const result = await deleteCustomerAddressApi(id, readOwner ? commercialReadConfig(readOwner) : { skipGlobalError: true })
      if (readOwner) assertKitReadOwner(readOwner)
      return result
    },
    onSuccess: (_data, _variables, context) => {
      if (context?.readOwner) {
        assertKitReadOwner(context.readOwner)
        if (currentCustomer.current !== context.customerId) throw new Error('地址属于原客户，请回原客户核对处理结果')
      }
      qc.invalidateQueries({ queryKey: key(context?.customerId ?? customerId, context?.readOwner), ...(context?.readOwner ? { exact: true } : {}) })
      if (context?.readOwner && context.getDraftContext && context.getDraftContext() !== context.draftContext) {
        toast.success('原地址操作已完成，当前输入仍未保存；请核对地址列表')
        return
      }
      toast.success('地址已删除')
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : '删除失败'),
  })
}
