import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { AxiosRequestConfig } from 'axios'
import { useQueryClient } from '@tanstack/react-query'
import type { HandlingSpec, HandlingAck } from '@/types/disposal-handling'
import { getOwnHandlingOperationApi, postHandlingApi } from '@/api/disposal-handling'
import { canonicalHandling, captureHandlingOwner, handlingOwnerCurrent, handlingConfig, handlingEpoch, handlingAckMatches, handlingResource, handlingRecordIdentity, handlingRevision, ownHandlingRecords, readHandlingRecords, saveHandlingRecord, confirmHandlingRecord, removeHandlingRecord, subscribeHandling, type HandlingRecord } from '@/lib/disposalHandlingRecovery'
const running = new Set<string>()
export function useOwnHandlingRecords() {
  useSyncExternalStore(subscribeHandling, handlingRevision)
  return ownHandlingRecords()
}
/** H6 only: durable complete POST snapshot, explicit own-result GET, never automatic POST retry. */
export function useDisposalHandlingOperation(draftIdentity: string, active = true, mayWrite: () => boolean = () => false) {
  useSyncExternalStore(subscribeHandling, handlingRevision)
  const [owner] = useState(captureHandlingOwner), qc = useQueryClient()
  const latest = useRef({ draftIdentity, active, mayWrite, serial: 0 }), mounted = useRef(true)
  if (latest.current.draftIdentity !== draftIdentity || latest.current.active !== active) latest.current.serial++
  Object.assign(latest.current, { draftIdentity, active, mayWrite })
  const serial = latest.current.serial
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ error: string; epoch: number; identity: string } | null>(null)
  const answer = useRef<{ ack: HandlingAck; epoch: number; identity: string } | null>(null)
  const confirmed = useRef(new Set<string>())
  const [, draw] = useState(0)
  const current = (o = owner) => mounted.current && latest.current.active && latest.current.serial === serial && latest.current.draftIdentity === draftIdentity && handlingOwnerCurrent(o)
  const maySubmit = () => current() && latest.current.mayWrite()
  const original = (o = captureHandlingOwner()) => readHandlingRecords().find(r => r.draftIdentity === draftIdentity && r.userId === o.userId && r.baseURL === o.baseURL)
  const state = ownHandlingRecords()
  const key = handlingRecordIdentity({ draftIdentity, userId: owner.userId ?? 0, baseURL: owner.baseURL })
  function error(o: ReturnType<typeof captureHandlingOwner>, message: string) {
    if (current(o)) setFeedback({ error: message, epoch: o.epoch, identity: draftIdentity })
  }
  async function finish(record: HandlingRecord, ack: HandlingAck, o: ReturnType<typeof captureHandlingOwner>) {
    if (!current(o)) return null
    confirmed.current.add(handlingRecordIdentity(record))
    // Must persist confirmed before cleanup. Either failure remains a blocker, including in a remounted view.
    if (record.phase !== 'confirmed') confirmHandlingRecord(record, ack)
    // Storage/notify callbacks can change the account or endpoint while confirmed is persisted.
    if (!current(o)) return null
    removeHandlingRecord(record)
    if (!current(o)) return null
    answer.current = { ack, epoch: o.epoch, identity: draftIdentity }
    error(o, '原处理结果已确认，禁止重复提交')
    for (const queryKey of [['disposal-handling'], ['disposals'], ['disposal'], ['sale'], ['returns']]) void qc.invalidateQueries({ queryKey })
    return ack
  }
  async function guarded(o: ReturnType<typeof captureHandlingOwner>, run: () => Promise<HandlingAck | null>) {
    const runKey = handlingRecordIdentity({ draftIdentity, userId: o.userId ?? 0, baseURL: o.baseURL })
    if (running.has(runKey)) return null
    running.add(runKey); setBusy(true)
    try { return await run() }
    catch (e) { error(o, e instanceof Error ? e.message : '原处理结果待核对'); return null }
    finally { running.delete(runKey); if (mounted.current) { setBusy(false); draw(v => v + 1) } }
  }
  async function submit<Body extends Record<string, unknown>>(spec: Omit<HandlingSpec, 'body'> & { body: Body }, send?: (body: Body, requestKey: string, config: AxiosRequestConfig) => Promise<HandlingAck>) {
    return guarded(owner, async () => {
      if (!maySubmit() || spec.draftIdentity !== draftIdentity || original(owner) || confirmed.current.has(key) || answer.current?.identity === draftIdentity) return null
      const record: HandlingRecord & { body: Body } = JSON.parse(canonicalHandling({ ...spec, version: 1, userId: owner.userId, baseURL: owner.baseURL, method: 'post', createdAt: Date.now(), phase: 'pending' }))
      saveHandlingRecord(record)
      // Persistence can run custom storage hooks; guard again immediately before the real POST.
      if (!maySubmit()) return null
      const ack = send ? await send(record.body, record.requestKey, handlingConfig(owner)) : await postHandlingApi(record.path, record.body, record.requestKey, handlingConfig(owner))
      if (!handlingAckMatches(record, ack)) throw Error('成功结果身份不一致，原请求已保留，请人工核对')
      if (!maySubmit()) return null
      return finish(record, ack, owner)
    })
  }
  async function queryOriginal() {
    const o = captureHandlingOwner()
    return guarded(o, async () => {
      if (!current(o)) return null
      const record = original(o)
      if (!record) return null
      if (record.phase === 'confirmed') return finish(record, record.result!, o)
      const receipt = await getOwnHandlingOperationApi(record.operationUuid, { action: record.action, requestKey: record.requestKey, ...(record.intentUuid ? { intentUuid: record.intentUuid } : {}) }, handlingConfig(o))
      if (!current(o)) return null
      if (receipt.status !== 'success') { error(o, receipt.status === 'pending' ? '原请求仍在处理，请稍后主动查询' : '暂未找到原结果，请保留完整请求并人工核对；不会自动重发'); return null }
      if (!handlingAckMatches(record, receipt.data) || receipt.resourceType !== handlingResource(record.kind) || receipt.resourceId !== (record.kind === 'release' && 'linkId' in receipt.data ? receipt.data.linkId : 'id' in receipt.data ? receipt.data.id : null)) throw Error('原结果资源或身份不一致，请保留并人工核对')
      return finish(record, receipt.data, o)
    })
  }
  const result = answer.current?.epoch === handlingEpoch() && answer.current.identity === draftIdentity && current(captureHandlingOwner()) ? answer.current.ack : null
  return {
    submit, queryOriginal, busy, result,
    error: state.error || (feedback?.epoch === handlingEpoch() && feedback.identity === draftIdentity ? feedback.error : ''),
    pending: state.records.some(r => r.draftIdentity === draftIdentity),
    get blocked() { try { return !!state.error || running.has(key) || !!original(owner) || confirmed.current.has(key) || answer.current?.identity === draftIdentity || !handlingOwnerCurrent(owner) } catch { return true } },
    canApply: (ack: HandlingAck) => current() && latest.current.mayWrite() && answer.current?.ack === ack && answer.current.epoch === handlingEpoch(),
  }
}
