import { useEffect, useRef, useSyncExternalStore } from 'react'
import { ApiClientError } from '@/api/client'
import { splitContainerApi, type SplitContainerBody, type SplitContainerResult } from '@/api/inventory'
import { getOperationRequestStatusApi } from '@/api/operation-requests'
import { useAuthStore } from '@/store/authStore'
import { hasPermission } from '@/lib/permissions'
import { PERMISSIONS } from '@/lib/permission-codes'
import { claimSplitRecovery, noticeSplitRecovery, ownsStoredSplit, reloadSplitRecovery, removeSplitRecovery, splitEndpoint, splitRecoverySnapshot, splitRecoveryStorageKey, splitRetryPayload, splitServerEpoch, splitOwnerEpoch, subscribeSplitRecovery, validatedSplitResult, type SplitRecoveryRecord } from '@/lib/pdaSplitRecovery'

const flights = new Set<string>()
const permissionIdentity = () => { const u = useAuthStore.getState().user; return JSON.stringify([u?.roleId, [...(u?.permissions ?? [])].sort()]) }
export function usePdaSplitRecovery({ active = true, onConfirmed }: { active?: boolean; onConfirmed?: (result: SplitContainerResult, recovered: boolean) => void }) {
  const accountId = useAuthStore(s => s.user?.id ?? null)
  const generation = useAuthStore(s => s.sessionGeneration)
  const role = useAuthStore(s => s.user?.roleId)
  const permissions = useAuthStore(s => s.user?.permissions)
  const epoch = useSyncExternalStore(subscribeSplitRecovery, splitServerEpoch)
  const snapshot = useSyncExternalStore(subscribeSplitRecovery, () => splitRecoverySnapshot(accountId))
  const opts = useRef({ active, onConfirmed }); opts.current = { active, onConfirmed }
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { if (accountId != null) reloadSplitRecovery(accountId) }, [accountId, generation])
  useEffect(() => {
    const read = (e: StorageEvent) => { if (accountId != null && (e.key == null || e.key === splitRecoveryStorageKey(accountId))) reloadSplitRecovery(accountId) }
    window.addEventListener('storage', read); return () => window.removeEventListener('storage', read)
  }, [accountId])
  const visibility = useRef({ active, epoch: 0 })
  if (visibility.current.active !== active) visibility.current = { active, epoch: visibility.current.epoch + 1 }
  const context = `${generation}:${epoch}:${splitOwnerEpoch()}:${role}:${JSON.stringify(permissions)}`
  const executable = () => {
    const u = useAuthStore.getState().user
    return !!u && hasPermission(u.permissions ?? [], PERMISSIONS.INVENTORY_CONTAINER_SPLIT, u.roleId ?? 5)
  }
  const capture = (record: SplitRecoveryRecord) => {
    const a = useAuthStore.getState(); const server = splitServerEpoch(); const permission = permissionIdentity(); const owner = splitOwnerEpoch(); const visible = visibility.current.epoch
    if (!opts.current.active || a.user?.id !== record.accountId || !a.token || splitEndpoint() !== record.endpoint || !ownsStoredSplit(record)) throw new Error('请回到原服务器、账号和拆分作业核对原结果')
    const current = () => mounted.current && opts.current.active && useAuthStore.getState().user?.id === record.accountId
      && useAuthStore.getState().sessionGeneration === a.sessionGeneration && splitServerEpoch() === server && permissionIdentity() === permission && splitEndpoint() === record.endpoint && ownsStoredSplit(record)
      && splitOwnerEpoch() === owner && visibility.current.epoch === visible
    const config = { baseURL: record.endpoint, _erpApiFallbackTried: true, _authSessionGeneration: a.sessionGeneration, skipGlobalError: true, headers: { 'X-Client': 'pda' } }
    return { current, config, flight: `${record.accountId}:${record.requestKey}`, context }
  }
  const start = (record: SplitRecoveryRecord) => {
    const c = capture(record)
    if (flights.has(c.flight)) throw new Error('原请求正在提交或查询，请等待结果')
    flights.add(c.flight); noticeSplitRecovery(record, { busy: true, notFoundAt: undefined, context: c.context, message: '正在核对原拆分请求' }); return c
  }
  const finish = (record: SplitRecoveryRecord, data: unknown, recovered: boolean) => {
    const result = validatedSplitResult(data, record)
    if (!result) { noticeSplitRecovery(record, { busy: false, message: '返回结果与原拆分身份不一致，请保留记录人工核对' }); return }
    // 成功必须来自完整原结果；不会读取当前余量推测。
    if (removeSplitRecovery(record)) opts.current.onConfirmed?.(result, recovered)
    return result
  }
  const send = async (record: SplitRecoveryRecord, body: SplitContainerBody, recovered: boolean) => {
    const c = start(record)
    try {
      const data = await splitContainerApi(record.sourceContainerId, body, record.requestKey, 'pda', c.config)
      if (c.current()) return finish(record, data, recovered)
    } catch (error) {
      if (c.current()) {
        const rejection = error instanceof ApiClientError && error.status != null && error.status >= 400 && error.status < 500
          && (['VALIDATION_ERROR', 'PERMISSION_DENIED', 'WAREHOUSE_SCOPE_DENIED', 'PDA_SESSION_REQUIRED'].includes(error.code ?? '') || typeof error.data === 'object' && error.data !== null && 'containerSplitNotExecuted' in error.data && error.data.containerSplitNotExecuted === true)
        // 原未知请求的重试即便被明确拒绝，也不能证明更早一次未执行。
        if (!recovered && rejection && removeSplitRecovery(record)) throw error
        noticeSplitRecovery(record, { busy: false, message: '原拆分结果未确认，请查询原请求；暂勿改目标或重新提交' })
      }
    } finally {
      flights.delete(c.flight)
      if (ownsStoredSplit(record)) noticeSplitRecovery(record, { busy: false })
    }
  }
  const run = async (source: { sourceContainerId: number; sourceBarcode: string; productId: number; warehouseId: number; remaining: number }, body: SplitContainerBody) => {
    if (accountId == null || useAuthStore.getState().sessionGeneration !== generation || !executable() || !opts.current.active) throw new Error('登录状态或拆分权限已改变')
    const record = claimSplitRecovery(accountId, source, body)
    return send(record, record.body!, false)
  }
  const query = async (record: SplitRecoveryRecord) => {
    const c = start(record)
    try {
      const receipt = await getOperationRequestStatusApi(record.requestKey, record.action, c.config)
      if (!c.current()) return
      if (receipt.status === 'success') {
        if (receipt.resourceType !== 'inventory_container' || receipt.resourceId !== record.sourceContainerId) { noticeSplitRecovery(record, { message: '原结果资源不一致，请保留记录人工核对' }); return }
        return finish(record, receipt.data, true)
      }
      if (receipt.status === 'failed') { if (removeSplitRecovery(record)) noticeSplitRecovery(record, { message: '已确认原拆分失败' }); return }
      const retryable = splitRetryPayload(record) !== null
      noticeSplitRecovery(record, { notFoundAt: receipt.status === 'not_found' && retryable ? Date.now() : undefined, context: c.context,
        message: !retryable ? '原提交已过保留期或原数据不完整，只可查询并人工核对，禁止重新扣量' : receipt.status === 'not_found' ? '新鲜查询未找到原请求；可主动按原键原内容重试，暂勿改目标' : '原请求仍待确认，请稍后查询，暂勿重新提交' })
    } catch { if (c.current()) noticeSplitRecovery(record, { message: '查询失败，原拆分仍待确认，请稍后再次核对' }) }
    finally { flights.delete(c.flight); if (ownsStoredSplit(record)) noticeSplitRecovery(record, { busy: false }) }
  }
  const canRetry = (record: SplitRecoveryRecord) => {
    const n = snapshot.notices[record.requestKey]
    return active && executable() && splitEndpoint() === record.endpoint && !!splitRetryPayload(record) && !flights.has(`${record.accountId}:${record.requestKey}`)
      && n?.context === context && typeof n.notFoundAt === 'number' && Date.now() - n.notFoundAt < 60000
  }
  const retry = (record: SplitRecoveryRecord) => {
    if (!canRetry(record)) return Promise.reject(new Error('请先在原账号与服务器新鲜查询原结果；过期或不完整记录只可人工核对'))
    return send(record, splitRetryPayload(record)!, true)
  }
  return { ...snapshot, run, query, retry, canRetry, blocked: !!snapshot.error || snapshot.records.length > 0 }
}
