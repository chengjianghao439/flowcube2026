import type { KitReadOwner } from '@/api/kits'
import { assertKitReadOwner } from './useKits'
import { commercialReadConfig } from '@/api/sale-commercial'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { getCustomersApi, createCustomerApi, updateCustomerApi, deleteCustomerApi } from '@/api/customers'
import type { CreateCustomerParams, UpdateCustomerParams } from '@/types/customers'
import { toast } from '@/lib/toast'
export const useCustomers = (params: object, keepPrevious = false, readOwner?: KitReadOwner) => useQuery({
  queryKey: readOwner ? ['customers', params, readOwner.baseURL, readOwner.userId, readOwner.sessionGeneration] : ['customers', params],
  queryFn: async () => {
    if (!readOwner) return getCustomersApi(params).then(r => r!)
    assertKitReadOwner(readOwner)
    const data = await getCustomersApi(params, commercialReadConfig(readOwner))
    assertKitReadOwner(readOwner)
    return data
  }, placeholderData: keepPrevious ? keepPreviousData : undefined
})
export const useCreateCustomer = () => {
  const qc=useQueryClient()
  return useMutation({
    mutationFn:(data:CreateCustomerParams)=>createCustomerApi(data, { skipGlobalError: true }),
    onSuccess:()=>{ qc.invalidateQueries({queryKey:['customers']}); toast.success('客户已创建') },
    onError:(e:unknown)=>toast.error(e instanceof Error ? e.message : '创建失败'),
  })
}
export const useUpdateCustomer = () => {
  const qc=useQueryClient()
  return useMutation({
    mutationFn:({id,data}:{id:number;data:UpdateCustomerParams})=>updateCustomerApi(id,data, { skipGlobalError: true }),
    onSuccess:()=>{ qc.invalidateQueries({queryKey:['customers']}); toast.success('客户已更新') },
    onError:(e:unknown)=>toast.error(e instanceof Error ? e.message : '更新失败'),
  })
}
export const useDeleteCustomer = () => {
  const qc=useQueryClient()
  return useMutation({
    mutationFn:(id:number)=>deleteCustomerApi(id, { skipGlobalError: true }),
    onSuccess:()=>{ qc.invalidateQueries({queryKey:['customers']}); toast.success('客户已删除') },
    onError:(e:unknown)=>toast.error(e instanceof Error ? e.message : '删除失败'),
  })
}
