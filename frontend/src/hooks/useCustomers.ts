import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getCustomersApi, getCustomersActiveApi, createCustomerApi, updateCustomerApi, deleteCustomerApi } from '@/api/customers'
import type { CreateCustomerParams, UpdateCustomerParams } from '@/types/customers'
export const useCustomers = (params: object) => useQuery({ queryKey: ['customers', params], queryFn: () => getCustomersApi(params).then(r=>r.data.data!) })
export const useCustomersActive = () => useQuery({ queryKey: ['customers-active'], queryFn: () => getCustomersActiveApi().then(r=>r.data.data||[]) })
export const useCreateCustomer = () => { const qc=useQueryClient(); return useMutation({ mutationFn:(data:CreateCustomerParams)=>createCustomerApi(data), onSuccess:()=>qc.invalidateQueries({queryKey:['customers']}) }) }
export const useUpdateCustomer = () => { const qc=useQueryClient(); return useMutation({ mutationFn:({id,data}:{id:number;data:UpdateCustomerParams})=>updateCustomerApi(id,data), onSuccess:()=>qc.invalidateQueries({queryKey:['customers']}) }) }
export const useDeleteCustomer = () => { const qc=useQueryClient(); return useMutation({ mutationFn:(id:number)=>deleteCustomerApi(id), onSuccess:()=>qc.invalidateQueries({queryKey:['customers']}) }) }
