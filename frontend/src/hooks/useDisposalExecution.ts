import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ApiClientError } from '@/api/client'
import { disposeDisposalApi } from '@/api/disposal'
import { getOperationRequestStatusApi } from '@/api/operation-requests'
import { createRequestKey } from '@/lib/requestKey'
import { useInvalidate } from '@/hooks/useInvalidate'
import { captureDisposalOwner, confirmedDisposal, rememberConfirmedDisposal, disposalConfig, disposalEpoch, disposalOwnerCurrent, disposalRevision, freshDisposalRecord, isDisposalResult, mayExecuteDisposal, ownDisposalRecords, positiveDisposalId, readDisposalRecords, recordIdentity, removeDisposalRecord, replaceDisposalRecord, saveDisposalRecord, subscribeDisposalRecovery, type DisposalExecutionRecord, type DisposalOwner } from '@/lib/disposalRecovery'
import type { DisposalExecutionResult } from '@/types/disposal'
const busyResources = new Set<string>()
export function useOwnDisposalRecords() { useSyncExternalStore(subscribeDisposalRecovery, disposalRevision); return ownDisposalRecords() }
/** 只限ERP报废执行；持久原空body和资源身份，未知时不创建替代键、不自动POST。 */
export function useDisposalExecution(id: number, active = true) {
  useSyncExternalStore(subscribeDisposalRecovery, disposalRevision)
  const [owner] = useState(captureDisposalOwner), invalidate = useInvalidate()
  const latest = useRef({ id, active, serial: 0 }), mounted = useRef(true), running = useRef(new Set<string>())
  const resource = recordIdentity({ userId: owner.userId ?? 0, baseURL: owner.baseURL, id })
  if (latest.current.id !== id || latest.current.active !== active) latest.current = { id, active, serial: latest.current.serial + 1 }
  const serial = latest.current.serial
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const { records, error: storageError } = ownDisposalRecords()
  const record = records.find(r => r.id === id) ?? null
  const [, redraw] = useState(0), [errorState, setErrorState] = useState<{ message: string; id: number; epoch: number } | null>(null), [answer, setAnswer] = useState<{ data: DisposalExecutionResult; epoch: number; id: number } | null>(null)
  const busy = running.current.has(resource)
  const answerRef = useRef<typeof answer>(null), uncertain = useRef(new Set<string>())
  const error = errorState?.id === id && errorState.epoch === disposalEpoch() ? errorState.message : ''
  const [retryProof, setRetryProof] = useState<{ snapshot: string; epoch: number; serial: number; checkedAt: number } | null>(null)
  const live = () => mounted.current && latest.current.id === id && latest.current.active && latest.current.serial === serial
  const operationCurrent = (operationOwner: DisposalOwner) => live() && disposalOwnerCurrent(operationOwner)
  const setError = (operationOwner: DisposalOwner, message: string) => {
    if (operationCurrent(operationOwner)) setErrorState({ message, id, epoch: operationOwner.epoch })
  }
  const writeCurrent = () => live() && disposalOwnerCurrent(owner) && mayExecuteDisposal()
  function currentRecord(readOwner = owner) { return readDisposalRecords().find(r => r.id === id && r.userId === readOwner.userId && r.baseURL === readOwner.baseURL) ?? null }
  function proofCurrent(original: DisposalExecutionRecord) { return !!retryProof && retryProof.snapshot === JSON.stringify(original) && retryProof.epoch === disposalEpoch() && retryProof.serial === serial && Date.now() >= retryProof.checkedAt && Date.now() - retryProof.checkedAt < 30_000 && freshDisposalRecord(original) && writeCurrent() }
  async function guarded(operationOwner: DisposalOwner, run: () => Promise<DisposalExecutionResult | null>) {
    if (running.current.has(resource)) return null
    running.current.add(resource); redraw(value => value + 1)
    try { return await run() } catch (e) { setError(operationOwner, e instanceof Error ? e.message : '原报废结果仍待核对'); return null }
    finally { running.current.delete(resource); if (mounted.current) redraw(value => value + 1) }
  }
  function finish(original: DisposalExecutionRecord, data: DisposalExecutionResult, operationOwner: DisposalOwner) {
    // 先持久成功身份；清理失败保留confirmed占位，不能再POST。
    rememberConfirmedDisposal(original, data)
    replaceDisposalRecord({ ...original, phase: 'confirmed', result: data })
    try { removeDisposalRecord(original) } catch { setError(operationOwner, '原报废已确认，记录清理失败；只能查询或清理，禁止再次执行'); return null }
    if (operationCurrent(operationOwner)) { answerRef.current = { data, epoch: operationOwner.epoch, id }; setAnswer(answerRef.current); setError(operationOwner, '原报废已确认完成'); invalidate('disposal_execute') }
    return data
  }
  async function send(original: DisposalExecutionRecord, retry: boolean, operationOwner: DisposalOwner) {
    if (!operationCurrent(operationOwner) || !writeCurrent() || original.body === undefined || original.phase !== 'pending') throw new Error('当前上下文或执行权限已变化，保留原请求；仍可核对本人结果')
    const resource = recordIdentity(original)
    try {
      const data = await disposeDisposalApi(original.id, original.requestKey, disposalConfig(operationOwner))
      if (!isDisposalResult(data, original.id)) throw new Error('成功结果资源身份不一致，保留原请求并人工核对')
      if (!operationCurrent(operationOwner) || !writeCurrent()) { uncertain.current.add(resource); return null }
      return finish(original, data, operationOwner)
    } catch (e) {
      const proof = e instanceof ApiClientError && e.data && typeof e.data === 'object' && 'disposalNotExecuted' in e.data && e.data.disposalNotExecuted === true
      const preflight = e instanceof ApiClientError && ['VALIDATION_ERROR', 'PERMISSION_DENIED', 'WAREHOUSE_SCOPE_DENIED', 'REQUEST_KEY_REQUIRED'].includes(e.code ?? '')
      if (!retry && !uncertain.current.has(resource) && operationCurrent(operationOwner) && e instanceof ApiClientError && e.status != null && e.status >= 400 && e.status < 500 && (proof || preflight)) { removeDisposalRecord(original) }
      else uncertain.current.add(resource)
      throw e
    }
  }
  async function execute() {
    return guarded(owner, async () => {
      setRetryProof(null)
      if (!writeCurrent() || !positiveDisposalId(id)) throw new Error('当前详情或执行权限已变化，不能执行；原输入保留')
      if (answerRef.current?.id === id || confirmedDisposal({ userId: owner.userId!, baseURL: owner.baseURL, id }) || currentRecord()) return null
      const original: DisposalExecutionRecord = { version: 1, id, userId: owner.userId!, baseURL: owner.baseURL, action: `disposal.dispose.${id}`, path: `/disposals/${id}/dispose`, method: 'post', body: {}, requestKey: createRequestKey('disposal-scrap'), createdAt: Date.now(), phase: 'pending' }
      const key = recordIdentity(original)
      if (busyResources.has(key)) return null
      busyResources.add(key)
      try { saveDisposalRecord(original); return await send(original, false, owner) }
      finally { busyResources.delete(key) }
    })
  }
  async function queryOriginal(retry = false) {
    const currentOwner = captureDisposalOwner()
    return guarded(currentOwner, async () => {
      const original = currentRecord(currentOwner)
      if (!original || !live() || original.userId !== currentOwner.userId || original.baseURL !== currentOwner.baseURL || !disposalOwnerCurrent(currentOwner)) throw new Error('请在原账号与服务器核对本人原请求')
      if (retry && !proofCurrent(original)) throw new Error('请先主动查询原结果；只有当前页面新鲜的未找到结果才可原键重试')
      setRetryProof(null)
      if (original.phase === 'confirmed') return finish(original, original.result!, currentOwner)
      const receipt = await getOperationRequestStatusApi(original.requestKey, original.action, disposalConfig(currentOwner))
      if (!live() || !disposalOwnerCurrent(currentOwner)) return null
      if (receipt.status === 'success') {
        if (receipt.resourceType !== 'inventory_disposal' || receipt.resourceId !== original.id || !isDisposalResult(receipt.data, original.id)) throw new Error('原结果对应资源不一致，请人工核对；禁止另发执行')
        return finish(original, receipt.data, currentOwner)
      }
      if (receipt.status === 'failed') { setError(currentOwner, '原服务报告失败，请保留原请求并人工核对；不要用单据状态猜结果'); return null }
      if (receipt.status === 'not_found' && retry && freshDisposalRecord(original) && writeCurrent()) {
        if (JSON.stringify(currentRecord(currentOwner)) !== JSON.stringify(original)) throw new Error('原持久请求已变化，请重新核对')
        const key = recordIdentity(original)
        if (busyResources.has(key)) return null
        busyResources.add(key); uncertain.current.add(key)
        try { return await send(original, true, currentOwner) } finally { busyResources.delete(key) }
      }
      if (receipt.status === 'not_found' && freshDisposalRecord(original) && writeCurrent()) setRetryProof({ snapshot: JSON.stringify(original), epoch: currentOwner.epoch, serial, checkedAt: Date.now() })
      setError(currentOwner, receipt.status === 'not_found' ? '暂未找到原结果。七天内完整原请求可主动同键重试；过期、时间异常或旧记录缺载荷只能核对' : '原请求仍在处理中，请继续查询，禁止另发执行')
      return null
    })
  }
  const result = answer?.epoch === disposalEpoch() && answer.id === id && live() ? answer.data : null
  return { execute, queryOriginal: () => queryOriginal(), retry: () => queryOriginal(true), busy, error: storageError || error, result,
    get blocked() { try { return running.current.has(resource) || !!storageError || !!currentRecord() || answerRef.current?.id === id || !!confirmedDisposal({ userId: owner.userId!, baseURL: owner.baseURL, id }) } catch { return true } },
    pending: !!record, canRetry: !!record && proofCurrent(record),
    canApply: (data: DisposalExecutionResult) => live() && answerRef.current?.data === data && answerRef.current.epoch === disposalEpoch() && latest.current.id === data.id }
}
