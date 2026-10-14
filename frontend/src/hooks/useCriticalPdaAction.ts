import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AxiosRequestConfig } from 'axios'
import { useNetworkStatus } from './useNetworkStatus'
import { usePendingRequests, type PendingRequestRecord } from './usePendingRequests'
import { createRequestKey } from '@/lib/requestKey'
import { getOperationRequestStatusApi, type OperationRequestStatus } from '@/api/operation-requests'
import { captureInboundEditOwner, inboundEditOwnerCurrent, inboundEditConfig } from './useInboundTaskEditRecovery'
import { getDeviceCredential, getDeviceSession } from '@/lib/pdaDeviceBinding'
import { isUncertainError } from '@/components/shared/payments/useIdempotentSubmit'
import { reserveTerminalSlot, matchingCompactTerminal, cancelUnsentTerminalSlot, assertTerminalReadyForPost } from '@/lib/criticalTerminalStorage'
import { criticalTerminalKey, readCriticalTerminal } from '@/lib/pendingRequestStorage'

function isUncertain(e: unknown) {
  const error = e as { status?: number; message?: string } | null
  if (isUncertainError(e)) return true
  if (typeof error?.status === 'number' && error.status >= 400 && error.status < 500) return false
  // 原始网络错误和无可证实状态码的异常均保留原身份。
  return true
}
const deviceIdentity = () => ({ deviceCode: getDeviceCredential()?.deviceCode ?? null, deviceWarehouseId: getDeviceSession()?.warehouseId ?? null })
const activeClaims = new Set<string>()
async function bodyFingerprint(body: unknown) {
  if (!crypto.subtle) throw Error('此客户端无法安全保存原内容，本次不发送')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(body)))
  return [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('')
}
const requestIdentity = (record: PendingRequestRecord) => ({ action: record.action, requestAction: record.requestAction, taskId: record.metadata?.taskId ?? null, checkId: record.metadata?.checkId ?? null, itemId: record.metadata?.itemId ?? null, body: record.metadata?.requestBody })
const resource = (record: PendingRequestRecord) => {
  const receive = /^inbound\.receive\.([1-9]\d*)$/.exec(record.action)
  const count = /^stockcheck\.scan\.([1-9]\d*)$/.exec(record.action)
  return receive ? { type: 'inbound_task', id: Number(receive[1]), kind: 'receive' } : count ? { type: 'stockcheck', id: Number(count[1]), kind: 'stockcheck' } : null
}
function assertReceiptIdentity(record: PendingRequestRecord, receipt: OperationRequestStatus) {
  const expected = resource(record)
  if (!expected) return
  if (receipt.resourceType != null && receipt.resourceType !== expected.type || receipt.resourceId != null && receipt.resourceId !== expected.id) throw Error('返回结果与原单据不一致，请保留原记录并核对')
  if (receipt.status === 'success' && expected.kind === 'stockcheck' && (record.endpoint || record.metadata?.itemId)) {
    const data = receipt.data as { itemId?: unknown } | null
    if (data?.itemId !== record.metadata?.itemId) throw Error('返回结果与原盘点商品不一致，请保留原记录并核对')
  }
}
const sameDevice = (record: PendingRequestRecord) => !record.endpoint || record.deviceCode === deviceIdentity().deviceCode && record.deviceWarehouseId === deviceIdentity().deviceWarehouseId

type ConfirmContext = { recovered: boolean; requestKey: string }
export type CriticalPdaActionPhase = 'idle' | 'submitting' | 'pending' | 'confirming' | 'failed'
export type CriticalPdaConfirmResult = OperationRequestStatus | {
  status: 'state_confirmed'; data: unknown; message: string
} | {
  status: 'state_unconfirmed'; data: null; message: string; reason: 'receipt_missing' | 'state_not_advanced'
}
type ServerStateResult<T> = { effective: true; data?: T; message?: string } | { effective: false; message?: string }
type ResolveServerState<T> = (ctx: { record: PendingRequestRecord; operationStatus?: OperationRequestStatus | null; error?: unknown }) => Promise<ServerStateResult<T> | null | undefined>
type RecoveryExecutor<T> = (record: PendingRequestRecord, requestKey: string, config: AxiosRequestConfig) => Promise<T>

export function useCriticalPdaAction<T>({ action, requestAction, label, onConfirmed, active = true, retryExecutor }: {
  action: string; requestAction?: string; label: string
  onConfirmed?: (data: T, ctx: ConfirmContext) => void | Promise<void>
  /** 兼容调用点类型；业务当前进度不再用来确认原请求。 */
  resolveServerState?: ResolveServerState<T>
  retryExecutor?: RecoveryExecutor<T>
  active?: boolean
}) {
  const visibility = useRef({ active, epoch: 0 })
  if (visibility.current.active !== active) visibility.current = { active, epoch: visibility.current.epoch + 1 }
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const networkStatus = useNetworkStatus()
  const { records, claimPending, removePending, discardUnclaimed, storageError, isPendingCurrent } = usePendingRequests()
  const matches = useMemo(() => records.filter(item => item.action === action), [records, action])
  const observed = useRef<{ record: PendingRequestRecord; userId: number | null } | null>(null)
  const renderOwner = captureInboundEditOwner()
  if (matches[0]) observed.current = { record: matches[0], userId: renderOwner.userId }
  const lostRecord = !matches[0] && observed.current?.userId === renderOwner.userId && observed.current.record.endpoint === renderOwner.baseURL ? observed.current.record : null
  const pendingRecord = matches[0] ?? lostRecord
  const [confirming, setConfirming] = useState(false), [phase, setPhase] = useState<CriticalPdaActionPhase>('idle')
  const [phaseMessage, setPhaseMessage] = useState<string | null>(null), [lastErrorMessage, setLastErrorMessage] = useState<string | null>(null)
  const autoConfirmRef = useRef<string | null>(null), flight = useRef(false)
  const statusAction = requestAction || action
  const capture = useCallback((record?: PendingRequestRecord) => {
    const owner = captureInboundEditOwner(), visible = visibility.current.epoch
    if (record?.endpoint) {
      if (record.action !== action || record.requestAction !== statusAction) throw Error('原操作的单据定位不一致，请保留记录并核对')
      const expected = resource(record)
      if (expected?.kind === 'receive' && record.metadata?.taskId !== expected.id) throw Error('原收货单定位不一致，请保留记录并核对')
      if (expected?.kind === 'stockcheck' && (record.metadata?.checkId !== expected.id || !Number.isSafeInteger(record.metadata?.itemId) || Number(record.metadata?.itemId) <= 0)) throw Error('原盘点单或商品定位不一致，请保留记录并核对')
    }
    if (record?.endpoint && (record.endpoint !== owner.baseURL || !sameDevice(record))) throw Error('服务器或设备已变化，请回原服务器和设备确认上次结果')
    if (record && isPendingCurrent && !isPendingCurrent(record)) throw Error('原请求记录已变化，请保留全部原内容并核对')
    const current = () => mounted.current && visibility.current.active && visibility.current.epoch === visible && inboundEditOwnerCurrent(owner) && (!record || sameDevice(record) && (!isPendingCurrent || isPendingCurrent(record)))
    return { current, config: inboundEditConfig(owner), owner }
  }, [action, isPendingCurrent, statusAction])
  const receiptAction = useCallback((record: PendingRequestRecord) => /^transfer\.scan(?:Out|In)\.[1-9]\d*$/.test(statusAction)
    ? statusAction : record.unverifiedOwner ? requestAction || record.requestAction || statusAction : record.requestAction || statusAction, [requestAction, statusAction])
  const finish = useCallback(async (record: PendingRequestRecord, status: 'success' | 'failed', data?: unknown, message?: string) => {
    if (record.unverifiedOwner) discardUnclaimed(action, record.requestKey)
    assertReceiptIdentity(record, { status, data, message: '' })
    if (await removePending(action, record.requestKey, status, data, record) === false) return
    observed.current = null
    setPhase(status === 'success' ? 'idle' : 'failed'); setPhaseMessage(null)
    setLastErrorMessage(status === 'failed' ? message || `${record.label}未执行，可检查原输入后重新提交。` : null)
    if (status === 'success') await onConfirmed?.(data as T, { recovered: true, requestKey: record.requestKey })
  }, [action, discardUnclaimed, onConfirmed, removePending])
  useEffect(() => {
    if (!lostRecord || !active || renderOwner.userId == null || !sameDevice(lostRecord)) return
    try {
      const terminal = readCriticalTerminal(renderOwner.userId, lostRecord)
      if (!terminal) { setPhase('pending'); setPhaseMessage('原记录已变化但结果尚未确认，请保留原内容并人工核对。'); return }
      if (terminal.compact) { setPhase('pending'); setPhaseMessage('原操作已确认，请查询原结果详情；暂勿重新提交。'); return }
      assertReceiptIdentity(lostRecord, { status: terminal.status, data: terminal.data, message: '' })
      observed.current = null
      setPhase(terminal.status === 'success' ? 'idle' : 'failed'); setPhaseMessage(null)
      if (terminal.status === 'success') void onConfirmed?.(terminal.data as T, { recovered: true, requestKey: lostRecord.requestKey })
      else setLastErrorMessage('已确认原操作未执行，可核对原输入后重新提交。')
    } catch (e) { setPhase('pending'); setPhaseMessage((e as Error).message) }
  }, [active, lostRecord, onConfirmed, renderOwner])
  const query = useCallback(async (record: PendingRequestRecord, captured: ReturnType<typeof capture>) => {
    if (record.endpoint && captured.owner.userId) await matchingCompactTerminal(criticalTerminalKey(captured.owner.userId, record.requestKey), record)
    if (record.requestFingerprint && await bodyFingerprint(requestIdentity(record)) !== record.requestFingerprint) throw Error('原请求正文或单据定位已变化，请保留记录并人工核对')
    if (!captured.current()) return null
    const status = await getOperationRequestStatusApi(record.requestKey, receiptAction(record), captured.config)
    if (!captured.current()) return null
    assertReceiptIdentity(record, status)
    if (status.status === 'success' || status.status === 'failed') await finish(record, status.status, status.data, status.message)
    else {
      setPhase('pending'); setLastErrorMessage(null)
      setPhaseMessage(status.status === 'pending' ? status.message || '原操作仍在处理中，请稍后查询。' : '暂时查不到原提交，请保留原内容和记录继续核对，暂勿重新扫码。')
    }
    return status
  }, [finish, receiptAction])
  const confirmPending = useCallback(async (): Promise<CriticalPdaConfirmResult | null> => {
    if (!visibility.current.active || !pendingRecord || networkStatus !== 'online' || flight.current || matches.length > 1) return null
    let captured: ReturnType<typeof capture>
    try { captured = capture(pendingRecord) } catch (e) { setPhaseMessage((e as Error).message); return null }
    flight.current = true; setConfirming(true); setPhase('confirming'); setLastErrorMessage(null)
    setPhaseMessage(`正在确认${pendingRecord.label}的结果，请勿重复提交。`)
    try { return await query(pendingRecord, captured) }
    catch (e) {
      if (captured.current()) { setPhase('pending'); setPhaseMessage(`暂时无法确认${pendingRecord.label}结果。${(e as Error).message || '请稍后再次确认。'}`) }
      return null
    } finally { flight.current = false; if (mounted.current) setConfirming(false) }
  }, [capture, matches.length, networkStatus, pendingRecord, query])
  useEffect(() => {
    if (!active || networkStatus !== 'online' || !pendingRecord || phase === 'submitting' || flight.current) return
    if (autoConfirmRef.current === pendingRecord.requestKey) return
    autoConfirmRef.current = pendingRecord.requestKey
    void confirmPending()
  }, [active, networkStatus, pendingRecord, phase, confirmPending])
  const blockedReason = useMemo(() => {
    if (storageError) return '原作业记录读取失败，请保留记录并核对，暂勿提交。'
    if (matches.length > 1) return '存在多笔待核对原操作，请保留全部记录并人工核对。'
    if (networkStatus !== 'online') return '网络已断开，关键操作已强制阻断。请恢复网络后再提交。'
    if (pendingRecord) return `${pendingRecord.label} 结果待确认。请先确认结果，避免重复提交。`
    return null
  }, [matches.length, networkStatus, pendingRecord, storageError])
  const run = useCallback(async (
    executor: (requestKey: string, config: AxiosRequestConfig, metadata?: Record<string, unknown>) => Promise<T>,
    metadata?: Record<string, unknown>,
  ): Promise<{ kind: 'success'; data: T } | { kind: 'pending'; requestKey: string }> => {
    if (!visibility.current.active) throw Error('请回到原作业页面再提交')
    if (networkStatus !== 'online') throw Error('网络已断开，关键操作不可提交')
    if (pendingRecord || flight.current) throw Error(`${label}结果待确认，请先确认后再重试`)
    const initial = capture(), claimId = `${initial.owner.userId}:${initial.owner.baseURL}:${action}`
    if (activeClaims.has(claimId)) throw Error(`${label}结果待确认，请先确认后再重试`)
    if (!navigator.locks?.request) throw Error('此客户端无法安全保存原操作，请使用支持本地恢复的客户端')
    activeClaims.add(claimId); flight.current = true
    try { return await navigator.locks.request(`flowcube-pda:${claimId}`, { ifAvailable: true }, async lock => {
      if (!lock) throw Error('另一窗口正在提交原操作，请先等待并查询原结果')
      if (!initial.current()) throw Error('登录状态或服务器已变化，请重新核对原操作')
      const requestKey = createRequestKey(action.replace(/[^a-z0-9]+/gi, '-'))
      const record: PendingRequestRecord = { requestKey, action, requestAction: statusAction, label, createdAt: new Date().toISOString(), endpoint: initial.owner.baseURL, ...deviceIdentity(), metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : undefined }
      if (record.metadata?.requestBody !== undefined) record.requestFingerprint = await bodyFingerprint(requestIdentity(record))
      if (!initial.current()) throw Error('账号或服务器已变化，本次没有发送')
      if (!initial.owner.userId) throw Error('请先登录原账号再提交')
      const terminalKey = criticalTerminalKey(initial.owner.userId, requestKey)
      const reservation = await reserveTerminalSlot(terminalKey, record)
      try {
        if (!initial.current()) throw Error('账号或服务器已变化，本次没有发送')
        if (!claimPending(record)) throw Error(`${label}结果待确认，请先确认后再重试`)
      } catch (e) { await cancelUnsentTerminalSlot(terminalKey, record); throw e }
      const captured = capture(record)
      setPhase('submitting'); setPhaseMessage(`${label}提交中，请等待结果。`); setLastErrorMessage(null)
      try {
        if (!captured.current()) return { kind: 'pending' as const, requestKey }
        assertTerminalReadyForPost(terminalKey, record, reservation)
        const data = await executor(requestKey, captured.config, record.metadata)
        if (!captured.current()) return { kind: 'pending' as const, requestKey }
        assertReceiptIdentity(record, { status: 'success', data, message: '' })
        if (await removePending(action, requestKey, 'success', data, record) === false) return { kind: 'pending' as const, requestKey }
        observed.current = null; setPhase('idle'); setPhaseMessage(null)
        await onConfirmed?.(data, { recovered: false, requestKey })
        return { kind: 'success' as const, data }
      } catch (e) {
        if (!captured.current()) return { kind: 'pending' as const, requestKey }
        if (isUncertain(e)) { setPhase('pending'); setPhaseMessage(`${label}结果待确认，请先确认原结果，暂勿重复提交。`); return { kind: 'pending' as const, requestKey } }
        if (await removePending(action, requestKey, 'failed', undefined, record) === false) return { kind: 'pending' as const, requestKey }
        observed.current = null; setPhase('failed'); setPhaseMessage(null); setLastErrorMessage((e as Error).message || `${label}未执行，请检查后重试。`)
        throw e
      }
    }) } finally { flight.current = false; activeClaims.delete(claimId) }
  }, [action, capture, claimPending, label, networkStatus, onConfirmed, pendingRecord, removePending, statusAction])
  const retryPending = useCallback(async () => {
    if (!pendingRecord || !retryExecutor || pendingRecord.unverifiedOwner || !pendingRecord.endpoint || !pendingRecord.requestFingerprint || flight.current || networkStatus !== 'online' || matches.length > 1) throw Error('原操作尚不能安全重试，请先核对原结果')
    const captured = capture(pendingRecord)
    flight.current = true; setConfirming(true)
    try {
      const receipt = await query(pendingRecord, captured)
      if (receipt?.status !== 'not_found') return receipt
      const age = Date.now() - Date.parse(pendingRecord.createdAt)
      if (!Number.isFinite(age) || age < -120000 || age >= 7 * 86400000 - 120000) throw Error('原操作已超出安全重试时限，请只查询并人工核对')
      if (!captured.owner.userId) throw Error('请回原账号核对原结果')
      const terminalKey = criticalTerminalKey(captured.owner.userId, pendingRecord.requestKey)
      const reservation = await reserveTerminalSlot(terminalKey, pendingRecord, true)
      if (!captured.current()) return null
      setPhase('submitting')
      try {
        assertTerminalReadyForPost(terminalKey, pendingRecord, reservation)
        const data = await retryExecutor(pendingRecord, pendingRecord.requestKey, captured.config)
        if (captured.current()) { await finish(pendingRecord, 'success', data); return { status: 'success' as const, data, message: '原操作已确认成功' } }
      } catch (e) {
        if (captured.current()) { setPhase('pending'); setPhaseMessage(`原操作仍待确认。${(e as Error).message || '请继续查询原结果。'}`) }
      }
      return null
    } finally { flight.current = false; if (mounted.current) setConfirming(false) }
  }, [capture, finish, matches.length, networkStatus, pendingRecord, query, retryExecutor])
  return { networkStatus, pendingRecord, confirming, phase, phaseMessage, lastErrorMessage, blockedReason, submitBlocked: Boolean(blockedReason), run, confirmPending, retryPending,
    canRetry: !!retryExecutor && !!pendingRecord?.endpoint && !!pendingRecord.requestFingerprint && !pendingRecord.unverifiedOwner && sameDevice(pendingRecord),
    clearPending: () => {
      // 新记录只能由原回执或首发明确拒绝结束；人工猜测未生效不能换键。
      if (pendingRecord?.unverifiedOwner) { discardUnclaimed(action, pendingRecord.requestKey); void removePending(action, pendingRecord.requestKey) }
      else setPhaseMessage('请先查询原结果；结果未确认时保留原记录，暂勿另发提交。')
    },
    clearError: () => { setLastErrorMessage(null); if (phase === 'failed') setPhase('idle') },
  }
}
