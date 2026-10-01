import { payloadClient } from './client'
import type { KitReadOwner } from './kits'
import type { SaleOrder } from '@/types/sale'
import type {
  CommercialBody,
  CommercialOperationPlan,
  CommercialPreview,
  CommercialWriteResult
} from '@/types/sale-commercial'
import { withRequestKeyHeaders } from '@/lib/requestKey'
export function commercialReadConfig(owner: KitReadOwner) {
  return {
    baseURL: owner.baseURL,
    _authSessionGeneration: owner.sessionGeneration,
    _erpApiFallbackTried: true,
    skipGlobalError: true
  }
}
export const getCommercialSaleApi = (id: number, owner: KitReadOwner) =>
  payloadClient.get<SaleOrder>(`/sale/${id}`, commercialReadConfig(owner))
export const previewCommercialSaleApi = (
  body: CommercialBody,
  owner: KitReadOwner,
  id?: number,
  signal?: AbortSignal
) => {
  if (id)
    return payloadClient.post<CommercialPreview>(`/sale/${id}/commercial-preview`, body, {
      ...commercialReadConfig(owner),
      signal
    })
  // The new quote schema is distinct from the formal sale schema, including its group warehouse fields.
  const groups = body.commercialGroups.map(({ warehouseId: _warehouseId, ...group }) => ({
    ...group,
    ...(group.priceSource === 'list' ? { priceSource: 'default' as const } : {})
  }))
  return payloadClient.post<CommercialPreview>(
    '/kits/preview',
    { customerId: body.customerId, warehouseId: body.warehouseId, groups },
    { ...commercialReadConfig(owner), signal }
  )
}
export function executeCommercialSaleApi(plan: CommercialOperationPlan): Promise<CommercialWriteResult> {
  const { operation: op } = plan
  const config = { ...commercialReadConfig(plan), headers: withRequestKeyHeaders(plan.requestKey) }
  if (op.action === 'create') return payloadClient.post('/sale', op.body, config)
  if (op.action === 'update' || op.action === 'adjust')
    return payloadClient.put(`/sale/${op.id}${op.action === 'adjust' ? '/adjust' : ''}`, op.body, config)
  if (op.action === 'delete') return payloadClient.delete(`/sale/${op.id}`, { ...config, data: op.body })
  return payloadClient.post(`/sale/${op.id}/${op.action}`, op.body, config)
}
