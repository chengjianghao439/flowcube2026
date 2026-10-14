import { useVisibleQuery } from './useVisibleQuery'
import { useId, useRef, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { getSaleListApi, getSaleDetailApi, getSaleReservePreviewApi, createSaleApi, updateSaleApi, adjustSaleApi, cancelSaleApi, deleteSaleApi } from '@/api/sale'
import { useInvalidate } from '@/hooks/useInvalidate'
import { toast } from '@/lib/toast'
import { ApiClientError } from '@/api/client'
import { createRequestKey } from '@/lib/requestKey'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { confirmAction } from '@/lib/confirm'
import type { CreateSaleParams, UpdateSaleParams, ReserveItemOverride, ShipItemRequest } from '@/types/sale'
import { captureKitReadOwner } from './useKits'
import { useKitOperation } from './useKitOperation'
import { useActiveWorkspaceTab } from './useActiveWorkspaceTab'
import { commercialReadConfig } from '@/api/sale-commercial'
import { useAuthStore } from '@/store/authStore'
import { hasPermission } from '@/lib/permissions'
import { useOrdinarySaleOperation, type OrdinarySaleBody, type OrdinarySaleKind } from './useOrdinarySaleOperation'
import { captureInboundEditOwner, inboundEditOwnerCurrent } from './useInboundTaskEditRecovery'

export const useSaleList   = (params: object, summary = false) => useVisibleQuery({ queryKey: ['sale', params, summary], queryFn: ({ signal }) => getSaleListApi(params, summary, signal) })
export const useSaleDetail = (id: number)     => useQuery({ queryKey: ['sale', id],     queryFn: () => getSaleDetailApi(id), enabled: !!id })
// 占库分仓弹窗打开时才拉取，避免为每个草稿行都请求一次
export const useSaleReservePreview = (id: number, enabled: boolean) =>
  useQuery({ queryKey: ['sale-reserve-preview', id], queryFn: () => getSaleReservePreviewApi(id), enabled: enabled && !!id })

export const useCreateSale = () => {
  const invalidate = useInvalidate()
  // 稳定幂等键：整个组件生命周期内复用同一 key（重试/网络回退不建重单），成功后轮换供下次新建
  const keyRef = useRef(createRequestKey('sale'))
  return useMutation({
    mutationFn: (data: CreateSaleParams) => createSaleApi(data, keyRef.current),
    onSuccess: () => {
      invalidate('sale_create')
      toast.success('销售单已创建')
      keyRef.current = createRequestKey('sale')
    },
  })
}

export const useUpdateSale = () => {
  const invalidate = useInvalidate()
  const keyRef = useRef(createRequestKey('sale-update'))
  return useMutation({
    mutationFn: (data: UpdateSaleParams) => updateSaleApi(data, keyRef.current),
    onSuccess: () => { invalidate('sale_update'); toast.success('销售单已保存'); keyRef.current = createRequestKey('sale-update') },
  })
}

export const useAdjustSale = () => {
  const invalidate = useInvalidate()
  const keyRef = useRef(createRequestKey('sale-adjust'))
  return useMutation({
    mutationFn: (data: UpdateSaleParams) => adjustSaleApi(data, keyRef.current),
    onSuccess: (res) => {
      invalidate('sale_adjust')
      keyRef.current = createRequestKey('sale-adjust')
      toast.success(res?.pending ? '改单已提交，等待仓库确认' : '销售单已保存')
    },
  })
}

type ReserveVariables = {id:number;items?:ReserveItemOverride[];confirmCreditOverride?:boolean}
type ReleaseVariables = {id:number;items?:ReserveItemOverride[]}
type ShipVariables = {id:number;items?:ShipItemRequest[]}
const ordinaryEvents = {reserve:'sale_reserve',release:'sale_reserve',ship:'sale_ship'} as const
const ordinaryMessages = {reserve:'库存已占用',release:'库存已释放',ship:'已发起出库'} as const
function useOrdinaryMutation<P extends {id:number}>(saleId:number | null | undefined, kind:OrdinarySaleKind, body:(v:P)=>OrdinarySaleBody, onError?:(e:unknown,v:P)=>void) {
  const invalidate=useInvalidate(), active=useActiveWorkspaceTab(), write=useOrdinarySaleOperation(saleId ?? 0,active)
  const mutation=useMutation({
    mutationFn:async(v:P)=>{if(v.id!==saleId)throw Error('当前订单已变化，请回原单核对');return (await write.run(kind,body(v))).data},
    onSuccess:()=>{invalidate(ordinaryEvents[kind]);toast.success(ordinaryMessages[kind])},
    onError:(e:unknown,v:P)=>{if(onError)onError(e,v);else toast.error(e instanceof Error?e.message:'原操作结果待确认，请查询')},
  })
  async function recover(retry:boolean){const answer=await(retry?write.retry():write.queryOriginal());if(answer.status==='success' && 'query' in answer){invalidate(ordinaryEvents[answer.query.kind]);toast.success('原操作已确认成功，请核对原订单')}return answer}
  return {...mutation,recovery:{...write,queryOriginal:()=>recover(false),retry:()=>recover(true)}}
}
// 三动作共用原订单未决闸门；授信明确拒绝后的授权是员工确认的新意图。
export const useReserveSale = (saleId?:number | null) => {
  const {can}=usePermission()
  const mutation=useOrdinaryMutation<ReserveVariables>(saleId,'reserve',v=>({... (v.items?.length?{items:v.items}:{}),...(v.confirmCreditOverride?{confirmCreditOverride:true}:{})}),(e,variables)=>{
    if(e instanceof ApiClientError && e.code==='STOCK_SHORTAGE')return
    if(e instanceof ApiClientError && e.code==='CREDIT_LIMIT_EXCEEDED'){
      const d=(e.data??{}) as {creditLimit?:number;used?:number;thisOrder?:number;overBy?:number}, originalOwner=captureInboundEditOwner()
      if(can(PERMISSIONS.SALE_CREDIT_OVERRIDE)) confirmAction({title:'客户授信额度不足',description:`授信额度 ${d.creditLimit}，已用 ${d.used}，本单 ${d.thisOrder}，超出 ${d.overBy}。确认授权超额放行、继续占库？`,confirmText:'授权放行',variant:'destructive',onConfirm:()=>{
        const auth=useAuthStore.getState()
        if(!inboundEditOwnerCurrent(originalOwner) || !hasPermission(auth.user?.permissions,PERMISSIONS.SALE_CREDIT_OVERRIDE,auth.user?.roleId)){toast.error('原账号、服务器或授权权限已变化，请重新核对');return}
        mutation.mutate({...variables,confirmCreditOverride:true})
      }})
      else toast.error(`客户授信额度不足，超出 ${d.overBy}，你无放行权限`)
      return
    }
    toast.error(e instanceof Error?e.message:'占库结果待确认，请查询原操作')
  })
  return mutation
}
export const useReleaseSale = (saleId?:number | null) => useOrdinaryMutation<ReleaseVariables>(saleId,'release',v=>v.items?.length?{items:v.items}:{})
export const useShipSale = (saleId?:number | null) => useOrdinaryMutation<ShipVariables>(saleId,'ship',v=>v.items?.length?{items:v.items}:{})

export const useCancelSale = (scope?: string) => {
  const invalidate = useInvalidate()
  const instance=useId(), [owner]=useState(captureKitReadOwner), active=useActiveWorkspaceTab()
  type Body={id:number;changeReason?:string}
  const write=useKitOperation<Body,null>(owner,scope || `sale-cancel-mounted:${instance}`,{
    isCurrent:()=>active,
    execute:(body,query,originalOwner)=>cancelSaleApi(body.id,query.requestKey,body.changeReason,commercialReadConfig(originalOwner)),
    validate:data=>data===null,
    mayWrite:()=>{const auth=useAuthStore.getState();return hasPermission(auth.user?.permissions,PERMISSIONS.SALE_ORDER_CANCEL,auth.user?.roleId)},
  })
  function confirmed(){invalidate('sale_cancel');toast.success('取消已提交，请核对订单与仓库归还进度')}
  const mutation=useMutation({
    mutationFn:async(input:number|Body)=>{
      const value=typeof input==='number'?{id:input}:input
      const reason=value.changeReason?.trim()
      const body={id:value.id,...(reason?{changeReason:reason}:{})}
      const answer=await write.submit(body,{kind:'cancel',action:`sale.cancel:${body.id}`,resourceType:'sale_order',resourceId:body.id})
      if(!answer || !write.canApply(answer)) throw new Error('原取消未确认，请核对当前原因与原操作结果')
      return answer.data
    },
    onSuccess:confirmed,
  })
  async function recover(retry:boolean){
    const answer=await(retry?write.retry():write.queryOriginal())
    if(!answer)return false
    if(answer.queryOnly){toast.success('原取消结果已核实，请自行刷新原单；当前输入保留');return false}
    if(!write.canApply(answer))return false
    confirmed();return true
  }
  return {...mutation,recovery:{...write,queryOriginal:()=>recover(false),retry:()=>recover(true)}}
}

export const useDeleteSale = () => {
  const invalidate = useInvalidate()
  const keyRef = useRef(createRequestKey('sale-delete'))
  return useMutation({
    mutationFn: (id: number) => deleteSaleApi(id, keyRef.current),
    onSuccess: () => { invalidate('sale_delete'); toast.success('销售单已删除'); keyRef.current = createRequestKey('sale-delete') },
  })
}
