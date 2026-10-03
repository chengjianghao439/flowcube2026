import { useEffect, useId, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { assertKitReadOwner, captureKitReadOwner } from './useKits'
import type { KitReadOwner } from '@/api/kits'
import { executeCommercialSaleApi, getCommercialSaleApi, previewCommercialSaleApi } from '@/api/sale-commercial'
import type {
  CommercialBody,
  CommercialOperation,
  CommercialPreview,
  CommercialWriteConfirmation,
  CommercialWriteResult
} from '@/types/sale-commercial'
import { PERMISSIONS } from '@/lib/permission-codes'
import { hasPermission } from '@/lib/permissions'
import { useKitOperation, type KitOperationConfirmation } from './useKitOperation'
import { useAuthStore } from '@/store/authStore'
const permission = {
  create: PERMISSIONS.SALE_ORDER_CREATE,
  update: PERMISSIONS.SALE_ORDER_UPDATE,
  adjust: PERMISSIONS.SALE_ORDER_UPDATE,
  ship: PERMISSIONS.SALE_ORDER_SHIP,
  cancel: PERMISSIONS.SALE_ORDER_CANCEL,
  reserve: PERMISSIONS.SALE_ORDER_RESERVE,
  release: PERMISSIONS.SALE_ORDER_RELEASE,
  delete: PERMISSIONS.SALE_ORDER_DELETE
}
export async function readCommercialSaleOwned(id: number, owner: KitReadOwner) {
  assertKitReadOwner(owner)
  const order = await getCommercialSaleApi(id, owner)
  assertKitReadOwner(owner)
  if (order.id !== id) throw new Error('返回订单不属于原单，请保留输入并重新核对')
  return order
}
export function useCommercialSaleRead(id: number) {
  const [readOwner] = useState(captureKitReadOwner)
  const query = useQuery({
    queryKey: ['sale', 'commercial-detail', id, readOwner.baseURL, readOwner.userId, readOwner.sessionGeneration],
    queryFn: () => readCommercialSaleOwned(id, readOwner),
    refetchOnMount: 'always',
    staleTime: 0
  })
  return { ...query, readOwner }
}
export function useCommercialPreview(body: CommercialBody | null, owner: KitReadOwner, id?: number) {
  const signature = JSON.stringify(body),
    serial = useRef(0)
  const [result, setResult] = useState<{ signature: string; data?: CommercialPreview; error?: string } | null>(null)
  useEffect(() => {
    const generation = ++serial.current,
      controller = new AbortController()
    if (!body) {
      setResult(null)
      return
    }
    setResult({ signature })
    void (async () => {
      try {
        assertKitReadOwner(owner)
        const data = await previewCommercialSaleApi(body, owner, id, controller.signal)
        assertKitReadOwner(owner)
        if (serial.current === generation && !controller.signal.aborted) setResult({ signature, data })
      } catch (e) {
        if (serial.current === generation && !controller.signal.aborted)
          setResult({ signature, error: e instanceof Error ? e.message : '预览读取失败' })
      }
    })()
    return () => controller.abort()
    // signature is the complete immutable request body; rerenders do not issue another identical quote.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Use the serialized body as the preview identity rather than object allocation.
  }, [signature, owner, id])
  const current = body && result?.signature === signature ? result : null
  let validOwner = true
  try {
    assertKitReadOwner(owner)
  } catch {
    validOwner = false
  }
  return {
    data: validOwner ? current?.data : undefined,
    error: validOwner ? current?.error : '读取来源已变化，草稿仍保留',
    loading: !!body && validOwner && !current?.data && !current?.error
  }
}
export function useCommercialWrite(owner: KitReadOwner, scope?: string) {
  const cache = useQueryClient(), instance = useId()
  const write = useKitOperation<CommercialOperation, CommercialWriteResult>(owner, scope ?? `commercial-mounted:${instance}`, {
    execute: (operation, query, originalOwner) => executeCommercialSaleApi({ operation, requestKey: query.requestKey, ...originalOwner, userId: query.userId, uncertain: true, queryHint: { action: query.action, resourceType: 'sale_order', resourceId: query.resourceId } }),
    mayWrite: operation => { const a = useAuthStore.getState(); return hasPermission(a.user?.permissions ?? [], permission[operation.action], a.user?.roleId) },
    validate: (data, query) => query.kind === 'create' ? (!!data?.id && Number.isSafeInteger(data.id) && data.id > 0) : data?.id == null || data.id === query.resourceId
  })
  const last = useRef<{ raw: KitOperationConfirmation<CommercialOperation, CommercialWriteResult>; public: CommercialWriteConfirmation } | null>(null)
  function convert(raw: KitOperationConfirmation<CommercialOperation, CommercialWriteResult> | null) {
    if (!raw) return null
    const plan = { ...raw.owner, userId: raw.query.userId, requestKey: raw.query.requestKey, uncertain: false,
      operation: raw.payload ?? { action: raw.query.kind as CommercialOperation['action'], id: raw.query.resourceId },
      queryHint: { action: raw.query.action, resourceType: 'sale_order' as const, resourceId: raw.query.resourceId } }
    const answer: CommercialWriteConfirmation = { confirmed: true, result: raw.data, plan, queryOnly: raw.queryOnly }
    last.current = { raw, public: answer }
    if (!raw.queryOnly && write.canApply(raw)) { void cache.invalidateQueries({ queryKey: ['sale'] }) }
    return answer
  }
  return {
    ...write,
    pending: write.pending ? { ...write.pending, uncertain: true, operation: write.pendingPayload } : null,
    submit: async (operation: CommercialOperation) => convert(await write.submit(operation, { kind: operation.action, action: `sale.${operation.action}${operation.id ? `.${operation.id}` : ''}`, resourceType: 'sale_order', resourceId: operation.id })),
    retry: async () => convert(await write.retry()),
    queryOriginal: async () => convert(await write.queryOriginal()),
    canApplyConfirmation: (answer: CommercialWriteConfirmation) => last.current?.public === answer && write.canApply(last.current.raw)
  }
}
