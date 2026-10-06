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

export interface CustomerAddressGuard { epoch: number; isCurrent: () => boolean }
const assertAddressGuard = (guard?: CustomerAddressGuard) => { if (guard && !guard.isCurrent()) throw new Error('原地址读取或操作已暂停，输入保留，请回原草稿核对') }

const key = (customerId: number, readOwner?: KitReadOwner) => readOwner
  ? ['customer-addresses', customerId, readOwner.baseURL, readOwner.userId, readOwner.sessionGeneration]
  : ['customer-addresses', customerId]

export const useCustomerAddresses = (customerId: number | null, enabled = true, readOwner?: KitReadOwner, readGuard?: CustomerAddressGuard) => {
  const context = useRef({ customerId, enabled, epoch: readGuard?.epoch, generation: 0 })
  if (readGuard && (context.current.customerId !== customerId || context.current.enabled !== enabled || context.current.epoch !== readGuard.epoch)) {
    context.current = { customerId, enabled, epoch: readGuard.epoch, generation: context.current.generation + 1 }
  }
  const currentGuard = useRef(readGuard)
  currentGuard.current = readGuard
  const generation = context.current.generation
  const assertCurrent = () => {
    if (readGuard && (generation !== context.current.generation || !context.current.enabled)) throw new Error('原地址读取代次已暂停，输入保留')
    assertAddressGuard(currentGuard.current)
  }
  return useQuery({
    queryKey: readGuard ? [...key(customerId!, readOwner), 'repeat', readGuard.epoch, generation] : key(customerId!, readOwner),
    queryFn: async () => {
      assertCurrent()
      if (!readOwner) { const data = await getCustomerAddressesApi(customerId!); assertCurrent(); return data ?? [] }
      assertKitReadOwner(readOwner)
      const data = await getCustomerAddressesApi(customerId!, commercialReadConfig(readOwner))
      assertKitReadOwner(readOwner)
      assertCurrent()
      return data ?? []
    },
    // 原调用保留客户缓存；R9暂停/恢复隔离读取代次，不接受隐藏期间迟到的地址列表。
    enabled: !!customerId && enabled && (!readGuard || readGuard.isCurrent()),
  })
}

export const useCreateCustomerAddress = (customerId: number, readOwner?: KitReadOwner, getDraftContext?: () => string, readGuard?: CustomerAddressGuard) => {
  const qc = useQueryClient()
  const currentCustomer = useRef(customerId)
  currentCustomer.current = customerId
  return useMutation({
    onMutate: () => ({ customerId, readOwner, readGuard, getDraftContext, draftContext: getDraftContext?.() }),
    mutationFn: async (data: CreateCustomerAddressParams) => {
      assertAddressGuard(readGuard)
      if (readOwner) assertKitReadOwner(readOwner)
      const result = await createCustomerAddressApi(data, readOwner ? commercialReadConfig(readOwner) : { skipGlobalError: true })
      assertAddressGuard(readGuard)
      if (readOwner) assertKitReadOwner(readOwner)
      return result
    },
    onSuccess: (_data, _variables, context) => {
      assertAddressGuard(context?.readGuard)
      if (context?.readOwner) {
        assertKitReadOwner(context.readOwner)
        if (currentCustomer.current !== context.customerId) throw new Error('地址属于原客户，请回原客户核对处理结果')
      }
      qc.invalidateQueries({ queryKey: context?.readGuard ? [...key(context.customerId, context.readOwner), 'repeat', context.readGuard.epoch] : key(context?.customerId ?? customerId, context?.readOwner), ...(context?.readOwner && !context.readGuard ? { exact: true } : {}) })
      if (context?.readOwner && context.getDraftContext && context.getDraftContext() !== context.draftContext) {
        toast.success('原地址操作已完成，当前输入仍未保存；请核对地址列表')
        return
      }
      toast.success('已保存为常用地址')
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : '保存失败'),
  })
}

export const useUpdateCustomerAddress = (customerId: number, readOwner?: KitReadOwner, getDraftContext?: () => string, readGuard?: CustomerAddressGuard) => {
  const qc = useQueryClient()
  const currentCustomer = useRef(customerId)
  currentCustomer.current = customerId
  return useMutation({
    onMutate: () => ({ customerId, readOwner, readGuard, getDraftContext, draftContext: getDraftContext?.() }),
    mutationFn: async ({ id, data }: { id: number; data: CustomerAddressWritable }) => {
      assertAddressGuard(readGuard)
      if (readOwner) assertKitReadOwner(readOwner)
      const result = await updateCustomerAddressApi(id, data, readOwner ? commercialReadConfig(readOwner) : { skipGlobalError: true })
      assertAddressGuard(readGuard)
      if (readOwner) assertKitReadOwner(readOwner)
      return result
    },
    onSuccess: (_data, _variables, context) => {
      assertAddressGuard(context?.readGuard)
      if (context?.readOwner) {
        assertKitReadOwner(context.readOwner)
        if (currentCustomer.current !== context.customerId) throw new Error('地址属于原客户，请回原客户核对处理结果')
      }
      qc.invalidateQueries({ queryKey: context?.readGuard ? [...key(context.customerId, context.readOwner), 'repeat', context.readGuard.epoch] : key(context?.customerId ?? customerId, context?.readOwner), ...(context?.readOwner && !context.readGuard ? { exact: true } : {}) })
      if (context?.readOwner && context.getDraftContext && context.getDraftContext() !== context.draftContext) {
        toast.success('原地址操作已完成，当前输入仍未保存；请核对地址列表')
        return
      }
      toast.success('地址已更新')
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : '更新失败'),
  })
}

export const useSetDefaultCustomerAddress = (customerId: number, readOwner?: KitReadOwner, getDraftContext?: () => string, readGuard?: CustomerAddressGuard) => {
  const qc = useQueryClient()
  const currentCustomer = useRef(customerId)
  currentCustomer.current = customerId
  return useMutation({
    onMutate: () => ({ customerId, readOwner, readGuard, getDraftContext, draftContext: getDraftContext?.() }),
    mutationFn: async (id: number) => {
      assertAddressGuard(readGuard)
      if (readOwner) assertKitReadOwner(readOwner)
      const result = await setDefaultCustomerAddressApi(id, readOwner ? commercialReadConfig(readOwner) : { skipGlobalError: true })
      assertAddressGuard(readGuard)
      if (readOwner) assertKitReadOwner(readOwner)
      return result
    },
    onSuccess: (_data, _variables, context) => {
      assertAddressGuard(context?.readGuard)
      if (context?.readOwner) {
        assertKitReadOwner(context.readOwner)
        if (currentCustomer.current !== context.customerId) throw new Error('地址属于原客户，请回原客户核对处理结果')
      }
      qc.invalidateQueries({ queryKey: context?.readGuard ? [...key(context.customerId, context.readOwner), 'repeat', context.readGuard.epoch] : key(context?.customerId ?? customerId, context?.readOwner), ...(context?.readOwner && !context.readGuard ? { exact: true } : {}) })
      if (context?.readOwner && context.getDraftContext && context.getDraftContext() !== context.draftContext) {
        toast.success('原地址操作已完成，当前输入仍未保存；请核对地址列表')
        return
      }
      toast.success('已设为默认')
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : '设置失败'),
  })
}

export const useDeleteCustomerAddress = (customerId: number, readOwner?: KitReadOwner, getDraftContext?: () => string, readGuard?: CustomerAddressGuard) => {
  const qc = useQueryClient()
  const currentCustomer = useRef(customerId)
  currentCustomer.current = customerId
  return useMutation({
    onMutate: () => ({ customerId, readOwner, readGuard, getDraftContext, draftContext: getDraftContext?.() }),
    mutationFn: async (id: number) => {
      assertAddressGuard(readGuard)
      if (readOwner) assertKitReadOwner(readOwner)
      const result = await deleteCustomerAddressApi(id, readOwner ? commercialReadConfig(readOwner) : { skipGlobalError: true })
      assertAddressGuard(readGuard)
      if (readOwner) assertKitReadOwner(readOwner)
      return result
    },
    onSuccess: (_data, _variables, context) => {
      assertAddressGuard(context?.readGuard)
      if (context?.readOwner) {
        assertKitReadOwner(context.readOwner)
        if (currentCustomer.current !== context.customerId) throw new Error('地址属于原客户，请回原客户核对处理结果')
      }
      qc.invalidateQueries({ queryKey: context?.readGuard ? [...key(context.customerId, context.readOwner), 'repeat', context.readGuard.epoch] : key(context?.customerId ?? customerId, context?.readOwner), ...(context?.readOwner && !context.readGuard ? { exact: true } : {}) })
      if (context?.readOwner && context.getDraftContext && context.getDraftContext() !== context.draftContext) {
        toast.success('原地址操作已完成，当前输入仍未保存；请核对地址列表')
        return
      }
      toast.success('地址已删除')
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : '删除失败'),
  })
}
