import { useEffect, useRef, useSyncExternalStore } from 'react'
import apiClient from '@/api/client'
import { repackPlasticBoxApi, type PlasticBoxRepackResult } from '@/api/inventory'
import { getOperationRequestStatusApi } from '@/api/operation-requests'
import { hasPermission } from '@/lib/permissions'
import { PERMISSIONS } from '@/lib/permission-codes'
import { useAuthStore } from '@/store/authStore'
import {
  claimRecovery, loadRecovery, normalizeRecoveryEndpoint, noticeRecovery, ownsRecovery,
  recoverySnapshot, reloadRecovery, removeRecovery, subscribeRecovery, sameRecoveryRecord,
  type RepackBody, type RepackRecoveryRecord,
} from '@/lib/criticalOperationRecovery'

export function currentRecoveryEndpoint() { return normalizeRecoveryEndpoint(apiClient.defaults.baseURL ?? '/api') }
export function isRecoveryEndpointCurrent(record: RepackRecoveryRecord) {
  try { return currentRecoveryEndpoint() === record.endpoint } catch { return false }
}
export function recoveryRequestConfig(record: RepackRecoveryRecord, sessionGeneration: number) {
  return { baseURL: record.endpoint, _erpApiFallbackTried: true, _authSessionGeneration: sessionGeneration, skipGlobalError: true }
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
export function validatedRepackResult(value: unknown, boxId: number): PlasticBoxRepackResult | null {
  if (!object(value) || value.boxId !== boxId || typeof value.boxRemainingAfter !== 'number' || !Number.isFinite(value.boxRemainingAfter) || value.boxRemainingAfter < 0 || !Array.isArray(value.created)) return null
  if (!value.created.every(c => object(c) && Number.isSafeInteger(c.containerId) && Number(c.containerId) > 0 && typeof c.barcode === 'string' && !!c.barcode && typeof c.qty === 'number' && Number.isFinite(c.qty) && c.qty > 0)) return null
  if (!Array.isArray(value.printJobIds) || !value.printJobIds.every(id => Number.isSafeInteger(id) && id > 0)) return null
  if (![value.noPrinterCount, value.renderFailedCount].every(n => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0)) return null
  return {
    boxId, boxRemainingAfter: value.boxRemainingAfter,
    created: value.created.map(c => ({ containerId: c.containerId, barcode: c.barcode, qty: c.qty })),
    printJobIds: [...value.printJobIds], noPrinterCount: Number(value.noPrinterCount), renderFailedCount: Number(value.renderFailedCount),
  }
}
const flights = new Set<string>()
interface Options {
  canExecute: boolean
  onFailed?: (record: RepackRecoveryRecord) => void
  onConfirmed?: (record: RepackRecoveryRecord, result: PlasticBoxRepackResult | null) => void
}
/** 首个 PC 试点：只接受塑料盒还原的原数字参数，恢复不会自动发 POST。 */
export function useCriticalOperationRecovery(options: Options) {
  const accountId = useAuthStore(s => s.user?.id ?? null)
  const sessionGeneration = useAuthStore(s => s.sessionGeneration)
  const snapshot = useSyncExternalStore(subscribeRecovery, () => recoverySnapshot(accountId))
  const optionsRef = useRef(options)
  optionsRef.current = options
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { if (accountId != null) reloadRecovery(accountId) }, [accountId, sessionGeneration])
  useEffect(() => {
    const reload = (event: StorageEvent) => { if (accountId != null && (event.key == null || event.key === `flowcube_pc_repack_v1:${accountId}`)) reloadRecovery(accountId) }
    window.addEventListener('storage', reload)
    return () => window.removeEventListener('storage', reload)
  }, [accountId])

  const capture = (record: RepackRecoveryRecord) => {
    const auth = useAuthStore.getState()
    if (record.accountId !== auth.user?.id || !isRecoveryEndpointCurrent(record)) throw new Error('当前服务器或账号已改变，请回到原服务器和账号确认原操作')
    const generation = auth.sessionGeneration
    const current = () => {
      const now = useAuthStore.getState()
      return now.user?.id === record.accountId && now.sessionGeneration === generation && isRecoveryEndpointCurrent(record) && ownsRecovery(record)
    }
    return { generation, current, config: recoveryRequestConfig(record, generation), flight: `${record.accountId}:${generation}:${record.requestKey}` }
  }
  const finish = (record: RepackRecoveryRecord, status: 'success' | 'failed', data?: unknown) => {
    // 响应到达前也核对磁盘身份，不能依赖尚未送达的 storage event。
    reloadRecovery(record.accountId)
    if (!ownsRecovery(record)) return
    // 明确错盒的数据不是合法原回执；保持身份，不能拿它 patch 另一只盒。
    if (object(data) && 'boxId' in data && data.boxId !== record.boxId) {
      noticeRecovery(record, { busy: false, message: '返回结果与原盒不一致，结果仍待确认，请核对原操作' }); return
    }
    const result = status === 'success' ? validatedRepackResult(data, record.boxId) : null
    noticeRecovery(record, { busy: false, confirmed: status, message: status === 'success' ? '已确认原操作成功' : '已确认原操作失败，可以重新提交' })
    const cleared = removeRecovery(record)
    if (mounted.current) {
      if (status === 'success') optionsRef.current.onConfirmed?.(record, result)
      else optionsRef.current.onFailed?.(record)
    }
    return { status, result, cleared }
  }
  const canonical = (record: RepackRecoveryRecord) => {
    if (accountId == null || record.accountId !== accountId) throw new Error('原操作不属于当前账号')
    const state = loadRecovery(accountId)
    if (state.error) throw new Error(state.error)
    const found = state.records.find(r => sameRecoveryRecord(r, record))
    if (!found) throw new Error('原操作身份已变化，请重新读取记录')
    return found
  }
  const send = async (record: RepackRecoveryRecord, first: boolean) => {
    const captured = capture(record)
    if (flights.has(captured.flight)) throw new Error('原操作正在提交或查询，请等待结果')
    flights.add(captured.flight)
    noticeRecovery(record, { busy: true, sessionGeneration: captured.generation, message: '正在提交原操作' })
    try {
      const data = await repackPlasticBoxApi(record.boxId, record.body, record.requestKey, undefined, captured.config)
      if (captured.current()) return finish(record, 'success', data)
    } catch (error) {
      if (!captured.current()) return
      const status = object(error) && typeof error.status === 'number' ? error.status : null
      // 只有首发明确 4xx 才能证明未做成；恢复重试的 4xx 不能推翻原未知结果。
      if (first && status != null && status >= 400 && status < 500) return finish(record, 'failed')
      noticeRecovery(record, { busy: false, message: '还原整件结果未确认，请查询原提交；按原内容重试使用同一笔身份' })
    } finally { flights.delete(captured.flight) }
  }
  const executable = () => {
    const user = useAuthStore.getState().user
    return optionsRef.current.canExecute && !!user && hasPermission(user.permissions ?? [], PERMISSIONS.INVENTORY_CONTAINER_SPLIT, user.roleId ?? 5)
  }
  const run = (boxId: number, body: RepackBody) => {
    try {
      const auth = useAuthStore.getState()
      if (auth.user?.id !== accountId || auth.sessionGeneration !== sessionGeneration || accountId == null) throw new Error('登录状态已改变，请重新操作')
      if (!executable()) throw new Error('当前无还原整件权限')
      const record = claimRecovery(accountId, boxId, currentRecoveryEndpoint(), body)
      return send(record, true)
    } catch (error) { return Promise.reject(error) }
  }
  const retry = (input: RepackRecoveryRecord) => {
    try {
      if (!executable()) throw new Error('当前无还原整件权限，请先查询原结果')
      const record = canonical(input)
      const notice = recoverySnapshot(record.accountId).notices[record.requestKey]
      if (notice?.confirmed) throw new Error('业务结果已确认，请先清理恢复记录，不能再次提交')
      return send(record, false)
    } catch (error) { return Promise.reject(error) }
  }
  const query = async (input: RepackRecoveryRecord) => {
    const record = canonical(input)
    const captured = capture(record)
    if (flights.has(captured.flight)) throw new Error('原操作正在提交或查询，请等待结果')
    flights.add(captured.flight)
    noticeRecovery(record, { busy: true, sessionGeneration: captured.generation, message: '正在查询原结果' })
    try {
      const receipt = await getOperationRequestStatusApi(record.requestKey, record.action, captured.config)
      if (!captured.current()) return
      if (receipt.resourceType != null && receipt.resourceType !== 'inventory_container') { noticeRecovery(record, { busy: false, message: '原操作结果对应的记录类型与原塑料盒不一致，结果仍待确认，请核对原操作' }); return }
      if (receipt.resourceId != null && receipt.resourceId !== record.boxId) { noticeRecovery(record, { busy: false, message: '原操作结果对应的塑料盒与原盒不一致，请核对原操作' }); return }
      if (receipt.status === 'success' || receipt.status === 'failed') return finish(record, receipt.status, receipt.data)
      noticeRecovery(record, { busy: false, message: receipt.status === 'pending' ? '原操作仍在服务器处理中，请稍后查询' : '暂时查不到原提交，可能仍在处理或未送达；保留原身份' })
    } catch {
      if (captured.current()) noticeRecovery(record, { busy: false, message: '查询失败，原操作结果仍待确认，请稍后再查' })
    } finally { flights.delete(captured.flight) }
  }
  const clearConfirmed = (record: RepackRecoveryRecord) => {
    const original = canonical(record)
    capture(original)
    if (!recoverySnapshot(original.accountId).notices[original.requestKey]?.confirmed) throw new Error('请先查询并确认原操作结果')
    return removeRecovery(original)
  }
  const records = snapshot.records
  const notices = Object.fromEntries(Object.entries(snapshot.notices).map(([key, n]) => [key, { ...n, busy: !!n.busy && n.sessionGeneration === sessionGeneration && flights.has(`${accountId}:${sessionGeneration}:${key}`) }]))
  return { records, notices, error: snapshot.error, run, query, retry, clearConfirmed,
    blocked: (boxId: number) => !!snapshot.error || records.some(r => r.boxId === boxId),
    reload: () => { if (accountId != null) reloadRecovery(accountId) },
  }
}
