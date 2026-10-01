import { useEffect, useRef, useState } from 'react'
import apiClient from '@/api/client'
import { closeReceivingInboundApi, type CloseReceivingResult } from '@/api/inbound-tasks'
import { getOperationRequestStatusApi } from '@/api/operation-requests'
import { useAuthStore } from '@/store/authStore'
import { hasPermission } from '@/lib/permissions'
import { PERMISSIONS } from '@/lib/permission-codes'
import { createRequestKey } from '@/lib/requestKey'
import { toast } from '@/lib/toast'
import { useInvalidate } from '@/hooks/useInvalidate'
import { isUncertainError } from '@/components/shared/payments/useIdempotentSubmit'

interface CloseRecord {
  taskId: number
  requestKey: string
  action: string
  userId: number
  sessionGeneration: number
  baseURL: string
  uncertain: boolean
}
export function closeReceivingMessage(result: CloseReceivingResult) {
  return result.status === 4 ? '已结束收货，实收已全部上架并完成结算' : '已结束收货，待实收全部上架后结算'
}
function validResult(value: unknown, taskId: number): value is CloseReceivingResult {
  const r = value as CloseReceivingResult | null
  return !!r && r.taskId === taskId && (r.status === 3 || r.status === 4)
}
/** 本页保存原关闭身份；刷新后只读最新单据，不自动重发或声称恢复旧键。 */
export function useCloseReceivingInbound() {
  const invalidate = useInvalidate()
  const recordRef = useRef<CloseRecord | null>(null)
  const busyRef = useRef(false)
  const mounted = useRef(true)
  const [pendingRecord, setPendingRecord] = useState<CloseRecord | null>(null)
  const [isPending, setBusy] = useState(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  function sameSession(r: CloseRecord) {
    const auth = useAuthStore.getState()
    return mounted.current && auth.user?.id === r.userId && auth.sessionGeneration === r.sessionGeneration && !!auth.token
  }
  function mayExecute() {
    const user = useAuthStore.getState().user
    return !!user && hasPermission(user.permissions ?? [], PERMISSIONS.INBOUND_ORDER_CANCEL, user.roleId)
  }
  function config(r: CloseRecord) {
    return { baseURL: r.baseURL, _erpApiFallbackTried: true, _authSessionGeneration: r.sessionGeneration, skipGlobalError: true }
  }
  function keep(r: CloseRecord) { r.uncertain = true; recordRef.current = r; if (mounted.current) setPendingRecord({ ...r }) }
  function resolve(r: CloseRecord, value: unknown) {
    if (!sameSession(r) || recordRef.current !== r) return null
    if (!validResult(value, r.taskId)) { keep(r); toast.warning('返回结果与原收货单不一致，请查询原提交结果'); return null }
    recordRef.current = null; setPendingRecord(null)
    if ((apiClient.defaults.baseURL ?? '/api') !== r.baseURL) {
      toast.success(`原服务器收货单 #${r.taskId}：${closeReceivingMessage(value)}`)
      return null
    }
    void invalidate('inbound_close_receiving')
    toast.success(closeReceivingMessage(value))
    return value
  }
  async function execute(r: CloseRecord) {
    if (busyRef.current || !sameSession(r) || !mayExecute()) return null
    busyRef.current = true; setBusy(true)
    try {
      const result = await closeReceivingInboundApi(r.taskId, config(r), r.requestKey)
      return resolve(r, result)
    } catch (error) {
      if (!sameSession(r) || recordRef.current !== r) return null
      const e = error as { status?: number; response?: { status?: number }; message?: string }
      const status = e.status ?? e.response?.status
      // 重试被拒绝不能证明先前未知提交失败；继续查询原键。
      if (r.uncertain || isUncertainError(error) || status == null || status >= 500) {
        keep(r); toast.warning(`收货单 #${r.taskId} 结束收货结果未确认，请查询或按原请求重试`)
      } else { recordRef.current = null; setPendingRecord(null); toast.error(e.message ?? '结束收货被拒绝，请刷新核对') }
      return null
    } finally { busyRef.current = false; if (mounted.current) setBusy(false) }
  }
  async function submit(taskId: number) {
    if (recordRef.current || busyRef.current || !mayExecute()) return null
    const auth = useAuthStore.getState()
    if (!auth.user || !auth.token) return null
    const r: CloseRecord = { taskId, requestKey: createRequestKey('inbound-close'), action: `inbound.closeReceiving.${taskId}`, userId: auth.user.id, sessionGeneration: auth.sessionGeneration, baseURL: apiClient.defaults.baseURL ?? '/api', uncertain: false }
    recordRef.current = r
    return execute(r)
  }
  async function retry() { return recordRef.current ? execute(recordRef.current) : null }
  async function check() {
    const r = recordRef.current
    if (!r || busyRef.current || !sameSession(r)) return null
    busyRef.current = true; setBusy(true)
    try {
      const receipt = await getOperationRequestStatusApi(r.requestKey, r.action, config(r))
      if (!sameSession(r) || recordRef.current !== r) return null
      if (receipt.status === 'success') {
        if (receipt.resourceType !== 'inbound_task' || receipt.resourceId !== r.taskId) { keep(r); toast.warning('回执归属与原收货单不一致，结果仍未确认'); return null }
        return resolve(r, receipt.data)
      }
      if (receipt.status === 'failed') {
        // 现有 failed 契约无资源字段，由原端点的本人 key/action 查询确定归属；若返回资源字段则必须自洽。
        if ((receipt.resourceType != null || receipt.resourceId != null) && (receipt.resourceType !== 'inbound_task' || receipt.resourceId !== r.taskId)) {
          keep(r); toast.warning('回执归属与原收货单不一致，结果仍未确认'); return null
        }
        recordRef.current = null; setPendingRecord(null); toast.error('原提交已确认失败，请刷新单据后再操作'); return null
      }
      keep(r)
      toast.warning(receipt.status === 'pending' ? '原提交仍在处理中，请稍后查询' : '暂未查到原提交，可能仍在处理中；可按原请求重试')
    } catch { if (sameSession(r)) { keep(r); toast.error('查询失败，原提交结果仍未确认') } }
    finally { busyRef.current = false; if (mounted.current) setBusy(false) }
    return null
  }
  return { submit, retry, check, pendingRecord, isPending }
}
