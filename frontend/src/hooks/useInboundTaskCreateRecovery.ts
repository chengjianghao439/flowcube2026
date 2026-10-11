import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createInboundTaskApi } from '@/api/inbound-tasks'
import { getOperationRequestStatusApi } from '@/api/operation-requests'
import { useInvalidate } from '@/hooks/useInvalidate'
import { captureInboundEditOwner, inboundEditConfig, inboundEditOwnerCurrent, mayViewInbound, subscribeInboundEdit, validInboundEditBody, type InboundEditOwner } from './useInboundTaskEditRecovery'
import { useAuthStore } from '@/store/authStore'
import { hasPermission } from '@/lib/permissions'
import { PERMISSIONS } from '@/lib/permission-codes'
import { createRequestKey } from '@/lib/requestKey'
import type { CreateInboundTaskParams, CreateInboundTaskResult } from '@/types/inbound-tasks'
import type { PickedPurchaseItem } from '@/pages/inbound-tasks/PurchaseItemPickerDialog'

const PREFIX = 'flowcube-inbound-create-v1:request:', TERMINAL_PREFIX = 'flowcube-inbound-create-v1:terminal:', TTL = 7 * 86400000
const listeners = new Set<() => void>(), flights = new Set<string>()
let revision = 0, subscribed = false
const notify = () => { revision++; listeners.forEach(fn => fn()) }
function subscribe(fn: () => void) {
  if (!subscribed) {
    subscribed = true; subscribeInboundEdit(notify)
    window.addEventListener('storage', event => { if (event.key === null || event.key?.startsWith(PREFIX) || event.key?.startsWith(TERMINAL_PREFIX)) notify() })
  }
  listeners.add(fn); return () => { listeners.delete(fn) }
}
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
export function mayCreateInbound() { const a = useAuthStore.getState(); return !!a.token && hasPermission(a.user?.permissions, PERMISSIONS.INBOUND_ORDER_CREATE, a.user?.roleId) }
export function validInboundCreateBody(value: unknown): value is CreateInboundTaskParams {
  if (!object(value) || !positive(value.supplierId) || typeof value.supplierName !== 'string' || !value.supplierName.trim()) return false
  const { supplierId: _supplierId, supplierName: _supplierName, ...rest } = value
  return validInboundEditBody({ ...rest, expectedEditFingerprint: 'create' }) && (value.remark === undefined || typeof value.remark === 'string' && value.remark.length <= 200)
    && (value.freightAmount == null || Number(value.freightAmount) <= 999999999999.99)
}
function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null)
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  const row = value as Record<string, unknown>
  return `{${Object.keys(row).filter(k => row[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + stable(row[k])).join(',')}}`
}
export async function inboundCreateFingerprint(body: CreateInboundTaskParams): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable(body)))
  return [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, '0')).join('')
}
export interface InboundCreateResult extends CreateInboundTaskResult { warehouseId: number; requestFingerprint: string }
export interface InboundCreateRecord {
  version: 1; userId: number; baseURL: string; action: 'inbound.create'; method: 'post'; path: '/inbound-tasks'
  body: CreateInboundTaskParams; requestKey: string; fingerprint: string; warehouseId: number; displayRows: PickedPurchaseItem[]
  createdAt: number; phase: 'pending' | 'confirmed' | 'failed'; result?: InboundCreateResult
}
const keyFor = (r: Pick<InboundCreateRecord, 'userId' | 'baseURL' | 'requestKey'>) => PREFIX + encodeURIComponent(JSON.stringify([r.userId, r.baseURL, r.requestKey]))
const sameOwner = (r: InboundCreateRecord, o: InboundEditOwner) => r.userId === o.userId && r.baseURL === o.baseURL
function validResult(value: unknown, record: InboundCreateRecord): value is InboundCreateResult {
  return object(value) && positive(value.taskId) && typeof value.taskNo === 'string' && !!value.taskNo.trim() && value.warehouseId === record.warehouseId && value.requestFingerprint === record.fingerprint
}
function validRecord(r: unknown): r is InboundCreateRecord {
  if (!object(r) || !validInboundCreateBody(r.body)) return false
  const body = r.body
  return object(r) && r.version === 1 && positive(r.userId) && typeof r.baseURL === 'string' && !!r.baseURL && r.action === 'inbound.create' && r.method === 'post' && r.path === '/inbound-tasks'
    && validInboundCreateBody(r.body) && typeof r.requestKey === 'string' && /^[\w-]{1,100}$/.test(r.requestKey) && typeof r.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(r.fingerprint)
    && positive(r.warehouseId) && typeof r.createdAt === 'number' && Number.isSafeInteger(r.createdAt) && ['pending', 'confirmed', 'failed'].includes(String(r.phase))
    && Array.isArray(r.displayRows) && (r.displayRows.length === 0 || r.displayRows.length === body.items.length && r.displayRows.every((v, i) => object(v) && object(v.item) && v.item.purchaseItemId === body.items[i].purchaseItemId && v.qty === body.items[i].qty && v.item.warehouseId === r.warehouseId))
    && (r.phase !== 'confirmed' || validResult(r.result, r as unknown as InboundCreateRecord))
}
const immutable = (r: InboundCreateRecord) => stable({ ...r, phase: 'pending', result: undefined })
const terminalKey = (r: InboundCreateRecord) => TERMINAL_PREFIX + keyFor(r).slice(PREFIX.length)
function terminalRecord(r: InboundCreateRecord): InboundCreateRecord | null {
  const raw = localStorage.getItem(terminalKey(r))
  if (!raw) return null
  const terminal: unknown = JSON.parse(raw)
  if (!validRecord(terminal) || terminal.phase === 'pending' || immutable(terminal) !== immutable(r)) throw Error('原创建终态与请求身份不一致，请保留记录并核对')
  return terminal
}
function retainTerminal(r: InboundCreateRecord) {
  const existing = terminalRecord(r)
  if (r.phase === 'pending' || existing && JSON.stringify(existing) !== JSON.stringify(r)) throw Error('原创建终态冲突，请保留记录并核对')
  if (!existing) localStorage.setItem(terminalKey(r), JSON.stringify(r))
  if (localStorage.getItem(terminalKey(r)) !== JSON.stringify(r)) throw Error('原创建终态保存未确认，禁止另发创建')
}
function removePending(r: InboundCreateRecord) {
  const raw = localStorage.getItem(keyFor(r))
  if (raw) {
    const storedRecord: unknown = JSON.parse(raw)
    if (!validRecord(storedRecord) || immutable(storedRecord) !== immutable(r)) throw Error('待清理的原创建请求已变化，禁止覆盖其他请求')
    localStorage.removeItem(keyFor(r))
  }
  if (localStorage.getItem(keyFor(r)) !== null) throw Error('原结果已确认但记录清理失败，请查询清理；禁止再次创建')
  notify()
}
function ownRecords(owner: InboundEditOwner) {
  const records: InboundCreateRecord[] = []
  // 每个请求独立存储，不能用一个共享数组覆盖另一窗口的原正文。
  for (const key of Object.keys(localStorage).filter(k => k.startsWith(PREFIX))) {
    const identity = JSON.parse(decodeURIComponent(key.slice(PREFIX.length))) as unknown
    if (!Array.isArray(identity) || identity.length !== 3) throw Error('创建请求身份损坏，请保留记录并核对')
    if (identity[0] !== owner.userId || identity[1] !== owner.baseURL) continue
    const record: unknown = JSON.parse(localStorage.getItem(key) || 'null')
    if (!validRecord(record) || keyFor(record) !== key) throw Error('原创建请求内容不完整，请保留记录；禁止另发创建')
    records.push(terminalRecord(record) ?? record)
  }
  if (records.length > 1) throw Error('存在多笔未核对的创建请求，请保留全部原键与正文并人工核对；禁止自动选择')
  return records
}
function stored(r: InboundCreateRecord) { return localStorage.getItem(keyFor(r)) === JSON.stringify(r) }
function persist(r: InboundCreateRecord, old?: InboundCreateRecord) {
  if (r.phase === 'pending' && terminalRecord(r)) throw Error('原创建已经完成，禁止复活原正文')
  if (old ? !stored(old) : localStorage.getItem(keyFor(r)) !== null) throw Error('原持久创建请求已变化，禁止覆盖')
  localStorage.setItem(keyFor(r), JSON.stringify(r))
  if (!stored(r)) throw Error('原创建请求保存未确认，本次不能继续发送')
  notify()
}
/** 沿用编辑的账号/原端点/活动代次与回执API；本域只保存一笔完整原POST，不自动重发。 */
export function useInboundTaskCreateRecovery(active = true) {
  useSyncExternalStore(subscribe, () => revision)
  const [owner] = useState(captureInboundEditOwner), invalidate = useInvalidate()
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [storageBlocked, setStorageBlocked] = useState(false)
  const [proof, setProof] = useState<{ record: string; owner: InboundEditOwner; serial: number; at: number } | null>(null)
  const latest = useRef({ active, serial: 0 }), mounted = useRef(true), running = useRef(false)
  if (latest.current.active !== active) latest.current = { active, serial: latest.current.serial + 1 }
  const serial = latest.current.serial
  const current = (o: InboundEditOwner) => mounted.current && latest.current.active && latest.current.serial === serial && inboundEditOwnerCurrent(o)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const observed = useRef<InboundCreateRecord | null>(null), consumed = useRef(new Set<string>()), submittedKey = useRef<string | null>(null)
  const operationOwner = captureInboundEditOwner()
  let pendingRecord: InboundCreateRecord | null = null, readError = ''
  try { pendingRecord = ownRecords(operationOwner)[0] ?? null } catch (e) { readError = e instanceof Error ? e.message : '原创建记录无法读取' }
  let settledRecord: InboundCreateRecord | null = null
  try {
    if (pendingRecord && !consumed.current.has(keyFor(pendingRecord))) observed.current = pendingRecord
    const r = observed.current
    if (r && sameOwner(r, operationOwner) && !consumed.current.has(keyFor(r))) {
      const terminal = terminalRecord(r) ?? (r.phase !== 'pending' ? r : null)
      if (terminal && current(operationOwner)) settledRecord = terminal
      else if (!pendingRecord && !terminal) readError = '原创建记录消失且没有可核对终态，请保留原正文；禁止另发创建'
    }
  } catch (e) { readError = e instanceof Error ? e.message : '原创建终态无法核对' }
  const owns = (r: InboundCreateRecord, o: InboundEditOwner) => current(o) && sameOwner(r, o) && stored(r) && !terminalRecord(r)
  function consumeTerminal(requestKey: string) {
    const o = captureInboundEditOwner(), r = observed.current
    if (!r || r.requestKey !== requestKey || !current(o) || !sameOwner(r, o)) return false
    try {
      const terminal = terminalRecord(r) ?? (r.phase !== 'pending' ? r : null)
      if (!terminal) return false
      retainTerminal(terminal); removePending(terminal)
      consumed.current.add(keyFor(r)); observed.current = null
      setError(terminal.phase === 'failed' ? '原创建已确认未执行，原输入保留，可修改后创建' : '')
      setProof(null); setStorageBlocked(false); notify()
      return true
    } catch (e) { setError(e instanceof Error ? e.message : '原创建终态清理失败'); return false }
  }
  const fresh = (r: InboundCreateRecord) => r.createdAt > 0 && Date.now() >= r.createdAt && Date.now() - r.createdAt < TTL
  const canRetry = (r: InboundCreateRecord) => !!proof && r.phase === 'pending' && proof.record === JSON.stringify(r) && current(proof.owner) && proof.serial === serial && Date.now() >= proof.at && Date.now() - proof.at < 30_000 && fresh(r) && mayViewInbound() && mayCreateInbound()
  async function guarded(o: InboundEditOwner, work: () => Promise<InboundCreateResult | null>) {
    const flight = JSON.stringify([o.userId, o.baseURL])
    if (running.current || flights.has(flight)) return null
    running.current = true; flights.add(flight); setBusy(true); setError('')
    try { return await work() } catch (e) { if (current(o)) setError(e instanceof Error ? e.message : '创建结果待确认'); return null }
    finally { running.current = false; flights.delete(flight); if (mounted.current) setBusy(false) }
  }
  function finish(r: InboundCreateRecord, data: InboundCreateResult | null, o: InboundEditOwner) {
    if (!current(o) || !sameOwner(r, o)) return null
    const existing = terminalRecord(r)
    if (!existing && !owns(r, o) && !(r.phase !== 'pending' && stored(r))) return null
    const next: InboundCreateRecord = existing ?? (data ? { ...r, phase: 'confirmed', result: data } : { ...r, phase: 'failed' })
    if (!existing && r.phase === 'pending') persist(next, r)
    // 请求级终态独立保留；所有曾恢复该请求的页面须消费后才解冻，不能以记录缺失当新单。
    retainTerminal(next); removePending(next)
    setProof(null); setStorageBlocked(false)
    if (data) invalidate('inbound_create')
    return data
  }
  async function send(r: InboundCreateRecord, retry: boolean, o: InboundEditOwner) {
    if (!owns(r, o) || !mayCreateInbound() || r.phase !== 'pending') throw Error('原账号、服务器或创建权限已变化，请保留原请求')
    if (await inboundCreateFingerprint(r.body) !== r.fingerprint || !owns(r, o)) throw Error('原创建正文已变化，请保留原键并核对')
    let received = false
    try {
      const data = await createInboundTaskApi(r.body, inboundEditConfig(o), r.requestKey)
      if (!validResult(data, r)) throw Error('创建结果与原提交内容或仓库不一致，请查询原结果')
      if (!owns(r, o)) return null
      received = true
      return finish(r, data, o)
    } catch (failure) {
      if (!owns(r, o)) return null
      const e = failure as { status?: number; response?: { status?: number }; message?: string; data?: { inboundCreateNotExecuted?: boolean } }
      const status = e.status ?? e.response?.status
      if (!received && !retry && status != null && status >= 400 && status < 500 && status !== 408 && e.data?.inboundCreateNotExecuted === true) finish(r, null, o)
      if (current(o)) setError(e.message || '创建结果待确认，请先查询原请求；原内容已冻结')
      return null
    }
  }
  async function submit(body: CreateInboundTaskParams, warehouseId: number, displayRows: PickedPurchaseItem[] = []) {
    const original = JSON.parse(JSON.stringify(body)) as CreateInboundTaskParams
    const display = JSON.parse(JSON.stringify(displayRows)) as PickedPurchaseItem[]
    return guarded(owner, async () => {
      if (!current(owner) || !mayCreateInbound() || readError || storageBlocked || settledRecord || ownRecords(owner).length) throw Error('原创建结果待确认或当前权限已变化，禁止另发创建')
      if (!validInboundCreateBody(original) || !positive(warehouseId)) throw Error('请核对供应商、仓库、备注与合法收货数量')
      const fingerprint = await inboundCreateFingerprint(original)
      if (!current(owner) || !mayCreateInbound() || ownRecords(owner).length) throw Error('原账号或请求状态已变化，请保留输入')
      const record: InboundCreateRecord = { version: 1, userId: owner.userId!, baseURL: owner.baseURL, action: 'inbound.create', method: 'post', path: '/inbound-tasks', body: original, requestKey: createRequestKey('inbound-create'), fingerprint, warehouseId, displayRows: display, createdAt: Date.now(), phase: 'pending' }
      if (!validRecord(record)) throw Error('原收货来源身份不完整，未发送创建')
      submittedKey.current = record.requestKey; observed.current = record
      try { persist(record) } catch { setStorageBlocked(true); throw Error('原创建请求保存失败，本次未发送；请恢复本地存储后重新打开') }
      setProof(null)
      return send(record, false, owner)
    })
  }
  async function queryOriginal(retry = false) {
    const o = captureInboundEditOwner()
    return guarded(o, async () => {
      if (!current(o) || !mayViewInbound()) throw Error('当前没有收货查看权限，原创建请求已保留，请联系有权人员核对')
      const observedRecord = observed.current
      const r = ownRecords(o)[0] ?? (observedRecord && sameOwner(observedRecord, o) ? terminalRecord(observedRecord) : null)
      if (r?.phase !== undefined && r.phase !== 'pending') return finish(r, r.phase === 'confirmed' ? r.result! : null, o)
      if (!r || !owns(r, o)) throw Error('请在原账号与原服务器核对原创建请求')
      if (await inboundCreateFingerprint(r.body) !== r.fingerprint || !owns(r, o)) throw Error('原创建正文与指纹不一致，请保留全部记录并人工核对')
      if (r.phase !== 'pending') return finish(r, r.phase === 'confirmed' ? r.result! : null, o)
      if (retry && !canRetry(r)) throw Error('请先主动查询原结果；只有新鲜未找到结果才可原键重试')
      setProof(null)
      const receipt = await getOperationRequestStatusApi(r.requestKey, r.action, { ...inboundEditConfig(o), params: { warehouseId: r.warehouseId, requestFingerprint: r.fingerprint } })
      if (!owns(r, o)) return null
      if (receipt.status === 'success') {
        if (receipt.resourceType !== 'inbound_task' || !validResult(receipt.data, r) || receipt.resourceId !== receipt.data.taskId) throw Error('原结果与本次创建请求不一致，请保留原请求')
        return finish(r, receipt.data, o)
      }
      // 没有单据绑定的通用failed不能证明创建未执行；只信首发事务回滚证明或成功回执。
      if (receipt.status === 'not_found' && fresh(r) && mayCreateInbound()) {
        if (retry) return send(r, true, o)
        setProof({ record: JSON.stringify(r), owner: o, serial, at: Date.now() })
      }
      setError(receipt.status === 'pending' ? '原创建仍在处理中，请继续查询' : receipt.status === 'not_found' && !fresh(r) ? '原创建请求已过期，请保留原键与正文并人工核对；禁止另发创建' : '暂未找到已确认结果，请保留原键与正文并继续核对')
      return null
    })
  }
  return { owner, contextIdentity: JSON.stringify([operationOwner.userId, operationOwner.baseURL]), submit, queryOriginal: () => queryOriginal(), retry: () => queryOriginal(true), pendingRecord, busy, error: readError || error,
    settledRecord, consumeTerminal, submittedRequestKey: submittedKey.current,
    blocked: busy || !!pendingRecord || !!settledRecord || !!readError || storageBlocked || !current(owner), canRetry: !!pendingRecord && canRetry(pendingRecord) }
}
