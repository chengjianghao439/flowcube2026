import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { getApiClientBaseURL, subscribeApiClientBaseURL } from '@/api/client'
import { getOperationRequestStatusApi } from '@/api/operation-requests'
import { updateInboundTaskApi } from '@/api/inbound-tasks'
import { useAuthStore } from '@/store/authStore'
import { hasPermission } from '@/lib/permissions'
import { PERMISSIONS } from '@/lib/permission-codes'
import { createRequestKey } from '@/lib/requestKey'
import { useInvalidate } from '@/hooks/useInvalidate'
import type { UpdateInboundTaskParams, UpdateInboundTaskResult } from '@/types/inbound-tasks'

const STORAGE = 'flowcube-inbound-edit-v1', REQUEST_PREFIX = `${STORAGE}:request:`, MIGRATED_PREFIX = `${STORAGE}:migrated:`, TERMINAL_PREFIX = `${STORAGE}:terminal:`, TTL = 7 * 86400000
const listeners = new Set<() => void>(), busyResources = new Set<string>()
let revision = 0, epoch = 0
const notify = () => { revision++; listeners.forEach(listener => listener()) }
const actor = () => { const a = useAuthStore.getState(); return JSON.stringify([a.user?.id, a.user?.roleId, a.user?.permissions, a.sessionGeneration, !!a.token]) }
let subscriptionsStarted = false
function ensureSubscriptions() {
  if (subscriptionsStarted) return
  subscriptionsStarted = true
  let lastActor = actor()
  subscribeApiClientBaseURL(() => { epoch++; notify() })
  useAuthStore.subscribe(() => { const next = actor(); if (next !== lastActor) { lastActor = next; epoch++; notify() } })
  if (typeof window !== 'undefined') window.addEventListener('storage', event => { if (event.key === STORAGE || event.key?.startsWith(REQUEST_PREFIX) || event.key?.startsWith(TERMINAL_PREFIX) || event.key === null) notify() })
}
export const subscribeInboundEdit = (listener: () => void) => { ensureSubscriptions(); listeners.add(listener); return () => { listeners.delete(listener) } }
export const inboundEditRevision = () => revision
function endpoint() {
  const raw = getApiClientBaseURL() ?? '/api'
  try { return new URL(raw, window.location.origin).href.replace(/\/$/, '') } catch { return raw.replace(/\/$/, '') }
}
export interface InboundEditOwner { userId: number | null; baseURL: string; sessionGeneration: number; epoch: number }
export function captureInboundEditOwner(): InboundEditOwner { ensureSubscriptions(); const a = useAuthStore.getState(); return { userId: a.user?.id ?? null, baseURL: endpoint(), sessionGeneration: a.sessionGeneration, epoch } }
export function inboundEditOwnerCurrent(owner: InboundEditOwner) { const a = useAuthStore.getState(); return !!a.token && a.user?.id === owner.userId && a.sessionGeneration === owner.sessionGeneration && endpoint() === owner.baseURL && epoch === owner.epoch }
export function mayViewInbound() { const a = useAuthStore.getState(); return !!a.token && hasPermission(a.user?.permissions, PERMISSIONS.INBOUND_ORDER_VIEW, a.user?.roleId) }
export function mayUpdateInbound() { const a = useAuthStore.getState(); return !!a.token && hasPermission(a.user?.permissions, PERMISSIONS.INBOUND_ORDER_UPDATE, a.user?.roleId) }
export const inboundEditConfig = (owner: InboundEditOwner) => ({ baseURL: owner.baseURL, _authSessionGeneration: owner.sessionGeneration, automaticReplay: false as const, _erpApiFallbackTried: true, skipGlobalError: true })
export interface InboundEditRecord {
  version: 1; userId: number; baseURL: string; taskId: number; action: string; method: 'put'; path: string
  body: UpdateInboundTaskParams; requestKey: string; createdAt: number; phase: 'pending' | 'confirmed' | 'failed'; result?: UpdateInboundTaskResult
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const positiveId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0
const quantity = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0 && Math.abs(v * 100 - Math.round(v * 100)) < 1e-7
export function validInboundEditBody(value: unknown): value is UpdateInboundTaskParams {
  if (!object(value) || Object.keys(value).some(k => !['remark', 'freightType', 'freightAmount', 'expectedEditFingerprint', 'items'].includes(k))) return false
  return typeof value.expectedEditFingerprint === 'string' && !!value.expectedEditFingerprint.trim()
    && (value.freightType == null || [1, 2, 3].includes(Number(value.freightType)) && typeof value.freightType === 'number')
    && (value.freightAmount == null || typeof value.freightAmount === 'number' && Number.isFinite(value.freightAmount) && value.freightAmount >= 0 && Number.isSafeInteger(Math.round(value.freightAmount * 100)) && Math.abs(value.freightAmount * 100 - Math.round(value.freightAmount * 100)) < 1e-7)
    && (value.remark === undefined || typeof value.remark === 'string') && Array.isArray(value.items) && value.items.length > 0
    && value.items.every(row => object(row) && Object.keys(row).length === 2 && positiveId(row.purchaseItemId) && quantity(row.qty))
    && new Set(value.items.map(row => row.purchaseItemId)).size === value.items.length
}
function validResult(value: unknown, taskId: number): value is UpdateInboundTaskResult { return object(value) && value.taskId === taskId && typeof value.taskNo === 'string' && !!value.taskNo.trim() && typeof value.expectedEditFingerprint === 'string' && !!value.expectedEditFingerprint.trim() }
const identity = (record: Pick<InboundEditRecord, 'userId' | 'baseURL' | 'taskId'>) => JSON.stringify([record.userId, record.baseURL, record.taskId])
const recordKey = (record: Pick<InboundEditRecord, 'userId' | 'baseURL' | 'taskId' | 'requestKey'>) => REQUEST_PREFIX + encodeURIComponent(JSON.stringify([record.userId, record.baseURL, record.taskId, record.requestKey]))
const terminalKey = (record: InboundEditRecord) => TERMINAL_PREFIX + recordKey(record).slice(REQUEST_PREFIX.length)
const migrationKey = (record: InboundEditRecord) => MIGRATED_PREFIX + recordKey(record).slice(REQUEST_PREFIX.length)
const immutable = (record: InboundEditRecord) => JSON.stringify([record.version, record.userId, record.baseURL, record.taskId, record.action, record.method, record.path, record.body, record.requestKey, record.createdAt])
function validRecord(r: unknown): r is InboundEditRecord {
  return object(r) && r.version === 1 && positiveId(r.userId) && positiveId(r.taskId) && typeof r.baseURL === 'string' && !!r.baseURL
    && r.action === `inbound.update.${r.taskId}` && r.method === 'put' && r.path === `/inbound-tasks/${r.taskId}` && validInboundEditBody(r.body)
    && typeof r.requestKey === 'string' && !!r.requestKey.trim() && typeof r.createdAt === 'number' && Number.isSafeInteger(r.createdAt)
    && ['pending', 'confirmed', 'failed'].includes(String(r.phase)) && (r.phase !== 'confirmed' || validResult(r.result, r.taskId))
}
function parseRecord(raw: string): InboundEditRecord {
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { throw Error('原编辑请求记录损坏，请保留记录并核对；禁止另发保存') }
  if (!validRecord(parsed)) throw Error('原编辑请求身份或内容不完整，请保留记录并核对；禁止另发保存')
  return parsed
}
function terminalRecord(record: InboundEditRecord): InboundEditRecord | null {
  const raw = localStorage.getItem(terminalKey(record))
  if (!raw) return null
  const terminal = parseRecord(raw)
  if (terminal.phase === 'pending' || immutable(terminal) !== immutable(record)) throw Error('原请求确认墓碑与正文不一致，请保留全部记录并人工核对')
  return terminal
}
function retainTerminal(record: InboundEditRecord) {
  const existing = terminalRecord(record)
  if (existing && JSON.stringify(existing) !== JSON.stringify(record)) throw Error('原请求确认结果冲突，请保留全部记录并人工核对')
  if (!existing) localStorage.setItem(terminalKey(record), JSON.stringify(record))
  if (localStorage.getItem(terminalKey(record)) !== JSON.stringify(record)) throw Error('原请求确认墓碑保存失败，请继续核对；禁止再次保存')
}
/** 旧数组只读备份，逐请求迁移标记保留原body/key；清理后不从备份复活。 */
function migrateLegacyRecords() {
  const raw = localStorage.getItem(STORAGE)
  if (!raw) return
  let legacy: unknown
  try { legacy = JSON.parse(raw) } catch { throw Error('原编辑请求记录损坏，请保留记录并核对；禁止另发保存') }
  if (!Array.isArray(legacy) || !legacy.every(validRecord)) throw Error('原编辑请求身份或内容不完整，请保留记录并核对；禁止另发保存')
  for (const record of legacy) {
    const key = recordKey(record), mark = migrationKey(record), existing = localStorage.getItem(key), copied = localStorage.getItem(mark)
    if (copied && immutable(parseRecord(copied)) !== immutable(record)) throw Error('旧编辑请求迁移身份冲突，请保留全部记录并人工核对')
    if (terminalRecord(record)) {
      if (!copied) localStorage.setItem(mark, JSON.stringify(record))
      continue
    }
    if (existing) {
      const current = parseRecord(existing)
      if (immutable(current) !== immutable(record)) throw Error('旧编辑请求与独立正文冲突，请保留全部记录并人工核对')
      if (!copied) localStorage.setItem(mark, JSON.stringify(record))
    } else if (!copied) {
      localStorage.setItem(key, JSON.stringify(record))
      if (localStorage.getItem(key) !== JSON.stringify(record)) throw Error('旧编辑请求复制未确认，请保留备份并核对')
      localStorage.setItem(mark, JSON.stringify(record))
    }
  }
}
function readRecords(): InboundEditRecord[] {
  migrateLegacyRecords()
  const records: InboundEditRecord[] = []
  for (const key of Object.keys(localStorage).filter(key => key.startsWith(REQUEST_PREFIX))) {
    const raw = localStorage.getItem(key)
    if (!raw) continue
    const record = parseRecord(raw)
    if (recordKey(record) !== key) throw Error('原编辑请求正文键与身份不一致，请保留全部记录并核对')
    const terminal = terminalRecord(record)
    if (terminal && record.phase !== 'pending' && JSON.stringify(terminal) !== JSON.stringify(record)) throw Error('原请求确认结果冲突，请保留全部记录并人工核对')
    records.push(terminal ?? record)
  }
  if (new Set(records.map(r => r.requestKey)).size !== records.length) throw Error('原编辑请求键重复，请保留全部记录并人工核对')
  return records
}
function resourceRecords(record: Pick<InboundEditRecord, 'userId' | 'baseURL' | 'taskId'>) {
  const matches = readRecords().filter(r => identity(r) === identity(record))
  if (matches.length > 1) throw Error('同一收货单存在多笔原请求，请保留全部正文和请求键并联系有权人员核对；禁止自动选择或保存')
  return matches
}
function stored(record: InboundEditRecord) { return resourceRecords(record).some(r => JSON.stringify(r) === JSON.stringify(record)) }
function add(record: InboundEditRecord) {
  const key = recordKey(record)
  if (localStorage.getItem(key) !== null || localStorage.getItem(terminalKey(record)) !== null) throw Error('原请求键已存在，禁止覆盖正文')
  localStorage.setItem(key, JSON.stringify(record)); notify()
  resourceRecords(record)
}
function replace(record: InboundEditRecord, next: InboundEditRecord) {
  if (!stored(record) || recordKey(next) !== recordKey(record) || immutable(next) !== immutable(record)) throw Error('原持久请求已变化，请重新核对')
  localStorage.setItem(recordKey(record), JSON.stringify(next)); notify()
}
function remove(record: InboundEditRecord) {
  if (!stored(record)) throw Error('原持久请求已变化，请重新核对')
  localStorage.removeItem(recordKey(record)); notify()
}

/** 路由仅放行当前登录账号、当前端点、当前任务的完整原请求恢复壳。 */
export function hasInboundEditRecoveryForPath(path: string) {
  const match = path.match(/^\/inbound-tasks\/([1-9]\d*)\/edit$/)
  if (!match || !Number.isSafeInteger(Number(match[1]))) return false
  try {
    const owner = captureInboundEditOwner()
    return inboundEditOwnerCurrent(owner) && mayViewInbound() && readRecords().some(record => record.taskId === Number(match[1]) && record.userId === owner.userId && record.baseURL === owner.baseURL)
  } catch { return false }
}

/** 完整原PUT在发送前持久化；重挂只恢复记录，未知结果从不自动重建或重发。 */
export function useInboundTaskEditRecovery(taskId: number, active = true, source?: InboundEditOwner, maySubmit?: () => boolean) {
  useSyncExternalStore(subscribeInboundEdit, inboundEditRevision)
  const [owner] = useState(() => source ?? captureInboundEditOwner()), invalidate = useInvalidate()
  const latest = useRef({ taskId, active, serial: 0 }), mounted = useRef(true), running = useRef(false)
  if (latest.current.taskId !== taskId || latest.current.active !== active) latest.current = { taskId, active, serial: latest.current.serial + 1 }
  const serial = latest.current.serial, guard = useRef(maySubmit); guard.current = maySubmit
  const [error, setError] = useState(''), [storageBlocked, setStorageBlocked] = useState(false), [busy, setBusy] = useState(false)
  const answerRef = useRef<{ data: UpdateInboundTaskResult; owner: InboundEditOwner; serial: number } | null>(null)
  const [answer, setAnswer] = useState<{ data: UpdateInboundTaskResult; owner: InboundEditOwner; serial: number } | null>(null)
  const [retryProof, setRetryProof] = useState<{ snapshot: string; epoch: number; serial: number; checkedAt: number } | null>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const live = () => mounted.current && latest.current.taskId === taskId && latest.current.active && latest.current.serial === serial
  const current = (operationOwner: InboundEditOwner) => live() && inboundEditOwnerCurrent(operationOwner)
  function currentRecord(operationOwner = captureInboundEditOwner()) { return resourceRecords({ taskId, userId: operationOwner.userId ?? 0, baseURL: operationOwner.baseURL })[0] ?? null }
  let pendingRecord: InboundEditRecord | null = null, readError = ''
  try { pendingRecord = currentRecord() } catch (e) { readError = e instanceof Error ? e.message : '原请求不可读取' }
  const fresh = (record: InboundEditRecord) => record.phase === 'pending' && record.createdAt > 0 && record.createdAt <= Date.now() && Date.now() - record.createdAt < TTL
  const proofCurrent = (record: InboundEditRecord) => !!retryProof && retryProof.snapshot === JSON.stringify(record) && retryProof.epoch === epoch && retryProof.serial === serial && Date.now() >= retryProof.checkedAt && Date.now() - retryProof.checkedAt < 30_000 && fresh(record) && live() && mayViewInbound() && mayUpdateInbound()
  function owns(record: InboundEditRecord, operationOwner: InboundEditOwner) { try { return current(operationOwner) && stored(record) } catch { return false } }
  async function guarded(operationOwner: InboundEditOwner, run: () => Promise<UpdateInboundTaskResult | null>) {
    const key = identity({ userId: operationOwner.userId ?? 0, baseURL: operationOwner.baseURL, taskId })
    if (running.current || busyResources.has(key)) return null
    running.current = true; busyResources.add(key); setBusy(true); setError('')
    try { return await run() } catch (e) { if (current(operationOwner)) setError(e instanceof Error ? e.message : '原保存结果待确认'); return null }
    finally { running.current = false; busyResources.delete(key); if (mounted.current) setBusy(false) }
  }
  function finish(record: InboundEditRecord, data: UpdateInboundTaskResult | null, operationOwner: InboundEditOwner) {
    if (!owns(record, operationOwner)) return null
    const next: InboundEditRecord = data ? { ...record, phase: 'confirmed', result: data } : { ...record, phase: 'failed' }
    if (record.phase === 'pending') {
      try { replace(record, next) } catch { setStorageBlocked(true); throw Error('原保存结果已确认，但结果标记保存失败；请继续查询核对，禁止再次保存') }
      record = next
    }
    try { retainTerminal(record); remove(record) } catch { throw Error('原保存结果已确认，但记录清理失败；请继续查询清理，禁止再次保存') }
    setRetryProof(null); setStorageBlocked(false)
    if (data) { answerRef.current = { data, owner: operationOwner, serial }; setAnswer(answerRef.current); invalidate('inbound_create'); return data }
    return null
  }
  async function send(record: InboundEditRecord, retry: boolean, operationOwner: InboundEditOwner) {
    if (!owns(record, operationOwner) || !mayUpdateInbound() || record.phase !== 'pending') throw Error('原账号、服务器或编辑权限已变化，请保留原请求并查询')
    let receivedSuccess = false
    try {
      const result = await updateInboundTaskApi(record.taskId, record.body, record.requestKey, inboundEditConfig(operationOwner))
      if (!validResult(result, record.taskId)) throw Error('保存结果无法核对原收货单，请查询原结果')
      if (!owns(record, operationOwner)) return null
      receivedSuccess = true
      return finish(record, result, operationOwner)
    } catch (failure) {
      if (receivedSuccess) { if (current(operationOwner)) setError(failure instanceof Error ? failure.message : '原结果已确认，请继续查询清理记录'); return null }
      if (!owns(record, operationOwner)) return null
      const e = failure as { status?: number; response?: { status?: number }; code?: string; message?: string; data?: { inboundEditNotExecuted?: boolean } }
      const status = e.status ?? e.response?.status
      if (!retry && status != null && status >= 400 && status < 500 && status !== 408 && e.code !== 'REQUEST_IN_PROGRESS' && e.data?.inboundEditNotExecuted === true) finish(record, null, operationOwner)
      if (!current(operationOwner)) return null
      setError(e.message || '保存结果待确认，请查询原请求；原内容已冻结')
      return null
    }
  }
  async function submit(body: UpdateInboundTaskParams) {
    return guarded(owner, async () => {
      if (!current(owner) || !mayUpdateInbound() || (guard.current && !guard.current())) throw Error('当前单据、读取状态或编辑权限已变化，草稿保留')
      if (storageBlocked || readError || currentRecord(owner)) throw Error('原保存结果待确认，请先查询；禁止另发保存')
      if (!positiveId(taskId) || !validInboundEditBody(body)) throw Error('请至少保留一条合法收货明细，数量须大于0且最多两位小数')
      const record: InboundEditRecord = { version: 1, taskId, userId: owner.userId!, baseURL: owner.baseURL, action: `inbound.update.${taskId}`, path: `/inbound-tasks/${taskId}`, method: 'put', body: JSON.parse(JSON.stringify(body)) as UpdateInboundTaskParams, requestKey: createRequestKey('inbound-edit'), createdAt: Date.now(), phase: 'pending' }
      try { add(record) } catch { setStorageBlocked(true); throw Error('原请求保存失败，本次未发送；请恢复本地存储后重新打开') }
      setRetryProof(null); answerRef.current = null; setAnswer(null)
      return send(record, false, owner)
    })
  }
  async function queryOriginal(retry = false) {
    const operationOwner = captureInboundEditOwner()
    return guarded(operationOwner, async () => {
      if (!mayViewInbound()) throw Error('当前没有收货订单查看权限，原草稿和请求已保留，请联系有权人员核对')
      const record = currentRecord(operationOwner)
      if (!record || !owns(record, operationOwner)) throw Error('请在原账号与原服务器核对原保存请求')
      if (record.phase !== 'pending') return finish(record, record.phase === 'confirmed' ? record.result! : null, operationOwner)
      if (retry && !proofCurrent(record)) throw Error('请先主动查询原结果；只有新鲜未找到结果才可原键重试')
      setRetryProof(null)
      const receipt = await getOperationRequestStatusApi(record.requestKey, record.action, inboundEditConfig(operationOwner))
      if (!owns(record, operationOwner)) return null
      const resourceMatches = receipt.resourceType === 'inbound_task' && receipt.resourceId === record.taskId
      if (receipt.status === 'success') {
        if (!resourceMatches || !validResult(receipt.data, record.taskId)) throw Error('原结果与原收货单不一致，请保留记录并核对')
        return finish(record, receipt.data, operationOwner)
      }
      if (receipt.status === 'failed') {
        if ((receipt.resourceType != null || receipt.resourceId != null) && !resourceMatches) throw Error('失败结果无法核对原收货单，请保留记录')
        finish(record, null, operationOwner); setError(receipt.message || '原保存已确认失败，草稿保留，可修改后重新保存'); return null
      }
      if (receipt.status === 'not_found' && retry && fresh(record) && mayUpdateInbound()) return send(record, true, operationOwner)
      if (receipt.status === 'not_found' && fresh(record) && mayUpdateInbound()) setRetryProof({ snapshot: JSON.stringify(record), epoch, serial, checkedAt: Date.now() })
      setError(receipt.status === 'pending' ? '原请求仍在处理中，请继续查询' : '暂未找到原结果；这不证明保存失败，请保留原内容和请求键')
      return null
    })
  }
  const result = answer && answer.serial === serial && current(answer.owner) ? answer.data : null
  return { owner, submit, queryOriginal: () => queryOriginal(), retry: () => queryOriginal(true), pendingRecord, busy, error: readError || error,
    blocked: busy || !!pendingRecord || !!readError || storageBlocked, canRetry: !!pendingRecord && proofCurrent(pendingRecord), result,
    canApply: (data: UpdateInboundTaskResult) => answerRef.current?.data === data && answerRef.current.serial === serial && current(answerRef.current.owner) }
}
