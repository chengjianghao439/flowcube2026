import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { assertKitReadOwner, captureKitReadOwner } from './useKits'
import type { KitReadOwner } from '@/api/kits'
import { executeCommercialSaleApi, getCommercialSaleApi, previewCommercialSaleApi } from '@/api/sale-commercial'
import type {
  CommercialBody,
  CommercialOperation,
  CommercialOperationPlan,
  CommercialPreview,
  CommercialWriteConfirmation
} from '@/types/sale-commercial'
import { createRequestKey } from '@/lib/requestKey'
import { PERMISSIONS } from '@/lib/permission-codes'
import { hasPermission } from '@/lib/permissions'
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
export function useCommercialWrite(owner: KitReadOwner) {
  const cache = useQueryClient(),
    record = useRef<CommercialOperationPlan | null>(null),
    lastConfirmed = useRef<CommercialOperationPlan | null>(null),
    busyRef = useRef(false),
    mounted = useRef(true)
  const [pending, setPending] = useState<CommercialOperationPlan | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [conflict, setConflict] = useState(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  function owns(plan: CommercialOperationPlan) {
    const a = useAuthStore.getState()
    return !!a.token && a.user?.id === plan.userId && a.sessionGeneration === plan.sessionGeneration
  }
  async function execute(plan: CommercialOperationPlan): Promise<CommercialWriteConfirmation | null> {
    const a = useAuthStore.getState()
    if (busyRef.current) return null
    if (!owns(plan) || !hasPermission(a.user?.permissions ?? [], permission[plan.operation.action], a.user?.roleId)) {
      setError('原账号会话或操作权限已变化，原请求保留，请回原会话核对')
      return null
    }
    busyRef.current = true
    setBusy(true)
    setError('')
    setConflict(false)
    try {
      const result = await executeCommercialSaleApi(plan)
      if (!mounted.current || record.current !== plan) return null
      if (!owns(plan)) {
        plan.uncertain = true
        setPending({ ...plan })
        setError('原操作响应已到达，但账号会话已变化；当前草稿保持冻结，请回原会话核对结果')
        return null
      }
      if (plan.operation.action === 'create' && (!result?.id || !Number.isSafeInteger(result.id)))
        throw new Error('原新单提交结果无法确认')
      record.current = null
      setPending(null)
      try {
        assertKitReadOwner(owner)
      } catch {
        setError(
          `原服务器的${plan.operation.action === 'create' ? '新单' : `订单 #${plan.operation.id}`}操作已确认，请回原来源核对；当前页面保留。`
        )
        return null
      }
      void cache.invalidateQueries({ queryKey: ['sale', 'commercial-detail', plan.operation.id] })
      void cache.invalidateQueries({ queryKey: ['sale'] })
      lastConfirmed.current = plan
      return { confirmed: true, result, plan }
    } catch (e) {
      if (!mounted.current || record.current !== plan) return null
      if (!owns(plan)) {
        plan.uncertain = true
        setPending({ ...plan })
        setError('原操作响应已到达，但账号会话已变化；当前草稿保持冻结，请回原会话核对结果')
        return null
      }
      const caught = e as { status?: number; response?: { status?: number }; message?: string },
        status = caught.status ?? caught.response?.status
      if (plan.uncertain || status == null || status === 408 || status >= 500) {
        plan.uncertain = true
        setPending({ ...plan })
        setError('提交结果待确认。当前草稿和原请求已冻结，请按原请求重试；不能修改输入另发请求。')
      } else {
        record.current = null
        setPending(null)
        setConflict(status === 409)
        setError(caught.message ?? '操作被拒绝，请核对原单')
      }
      return null
    } finally {
      busyRef.current = false
      if (mounted.current) setBusy(false)
    }
  }
  async function submit(operation: CommercialOperation) {
    if (record.current || busyRef.current) return null
    try {
      assertKitReadOwner(owner)
    } catch (e) {
      setError(e instanceof Error ? e.message : '来源已变化')
      return null
    }
    const auth = useAuthStore.getState()
    if (!hasPermission(auth.user?.permissions ?? [], permission[operation.action], auth.user?.roleId)) {
      setError('你没有本次操作权限，草稿保留')
      return null
    }
    const plan: CommercialOperationPlan = {
      operation: JSON.parse(JSON.stringify(operation)) as CommercialOperation,
      requestKey: createRequestKey(`sale-${operation.action}`),
      ...owner,
      userId: owner.userId!,
      uncertain: false,
      queryHint: {
        action: `sale.${operation.action}${operation.id ? `.${operation.id}` : ''}`,
        resourceType: 'sale_order',
        resourceId: operation.id
      }
    }
    record.current = plan
    lastConfirmed.current = null
    return execute(plan)
  }
  return {
    submit,
    retry: () => (record.current ? execute(record.current) : Promise.resolve(null)),
    canApplyConfirmation: (confirmation: CommercialWriteConfirmation) => {
      if (lastConfirmed.current !== confirmation.plan || record.current || busyRef.current || !mounted.current)
        return false
      try {
        assertKitReadOwner(confirmation.plan)
      } catch {
        return false
      }
      return true
    },
    pending,
    busy,
    error,
    conflict
  }
}
