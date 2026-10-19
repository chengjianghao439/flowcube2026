import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { getOperationRequestStatusApi } from '@/api/operation-requests'
import { reserveSaleApi, releaseSaleApi, shipSaleApi } from '@/api/sale'
import { useAuthStore } from '@/store/authStore'
import { hasPermission } from '@/lib/permissions'
import { PERMISSIONS } from '@/lib/permission-codes'
import { createRequestKey } from '@/lib/requestKey'
import { reserveTerminalSlot, completeTerminalSlot, cancelUnsentTerminalSlot, assertTerminalReadyForPost, matchingCompactTerminal, OPERATION_RETENTION_MS, OPERATION_CLOCK_MARGIN_MS, type TerminalReservation } from '@/lib/criticalTerminalStorage'
import { captureInboundEditOwner, inboundEditOwnerCurrent, inboundEditConfig, subscribeInboundEdit, inboundEditRevision, type InboundEditOwner } from './useInboundTaskEditRecovery'
import type { ReserveItemOverride, ShipItemRequest } from '@/types/sale'

export type OrdinarySaleKind = 'reserve' | 'release' | 'ship'
export type OrdinarySaleBody = { items?: ReserveItemOverride[] | ShipItemRequest[] }
export interface OrdinarySaleQuery {
  version: 1; userId: number; baseURL: string; saleId: number; kind: OrdinarySaleKind; action: string
  path: string; method: 'post'; requestKey: string; createdAt: number; bodyHash: string
}
const REQUEST = 'flowcube-ordinary-sale-v1:request:', TERMINAL = 'flowcube-ordinary-sale-v1:terminal:'
const listeners = new Set<() => void>(), activeDomains = new Set<string>()
let revision = 0
const notify = () => { revision++; listeners.forEach(fn => fn()) }
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
if (typeof window !== 'undefined') window.addEventListener('storage', event => { if (event.key === null || event.key?.startsWith(REQUEST) || event.key?.startsWith(TERMINAL)) notify() })
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0
const domain = (v: {userId: number | null; baseURL: string; saleId: number}) => JSON.stringify([v.userId, v.baseURL, v.saleId])
const suffix = (r: OrdinarySaleQuery) => encodeURIComponent(JSON.stringify([r.userId, r.baseURL, r.saleId, r.requestKey]))
const requestKey = (r: OrdinarySaleQuery) => REQUEST + suffix(r), terminalKey = (r: OrdinarySaleQuery) => TERMINAL + suffix(r)
const snapshot = (r: OrdinarySaleQuery) => JSON.stringify(r)
function validQuery(v: unknown): v is OrdinarySaleQuery {
  return object(v) && Object.keys(v).length === 11 && v.version === 1 && positive(v.userId) && positive(v.saleId)
    && typeof v.baseURL === 'string' && !!v.baseURL && ['reserve','release','ship'].includes(String(v.kind))
    && v.action === `sale.${v.kind}:${v.saleId}` && v.path === `/sale/${v.saleId}/${v.kind}` && v.method === 'post'
    && typeof v.requestKey === 'string' && !!v.requestKey && positive(v.createdAt) && typeof v.bodyHash === 'string' && /^[a-f0-9]{64}$/.test(v.bodyHash)
}
function read(owner: InboundEditOwner, saleId: number) {
  const found: OrdinarySaleQuery[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)!
    if (!key.startsWith(REQUEST)) continue
    const parsed: unknown = JSON.parse(localStorage.getItem(key)!)
    if (!validQuery(parsed) || requestKey(parsed) !== key) throw Error('原销售操作查询身份损坏，请保留记录并人工核对')
    if (domain(parsed) === domain({...owner, saleId})) found.push(parsed)
  }
  if (found.length > 1) throw Error('原订单存在多笔待确认操作，请保留记录并人工核对')
  return found[0] ?? null
}
function save(r: OrdinarySaleQuery) {
  const key = requestKey(r), raw = snapshot(r)
  if (localStorage.getItem(key) !== null) throw Error('原操作键已存在，禁止覆盖')
  localStorage.setItem(key, raw)
  if (localStorage.getItem(key) !== raw) throw Error('原操作查询身份未能保存，本次没有发送')
  notify()
}
async function hash(body: OrdinarySaleBody) {
  if (!crypto.subtle) throw Error('此客户端无法冻结原请求，本次没有发送')
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(body)))
  return [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2,'0')).join('')
}
const permission = (kind: OrdinarySaleKind) => kind === 'reserve' ? PERMISSIONS.SALE_ORDER_RESERVE : kind === 'release' ? PERMISSIONS.SALE_ORDER_RELEASE : PERMISSIONS.SALE_ORDER_SHIP
export function validOrdinarySaleResult(kind: OrdinarySaleKind, result: unknown, fromReceipt: boolean) {
  if (kind !== 'ship') return result === null
  if (!fromReceipt && result === null) return true // Ordinary initial POST intentionally returns null.
  return object(result) && Array.isArray(result.tasks) && result.tasks.length > 0
    && result.tasks.every(task => object(task) && positive(task.taskId) && typeof task.taskNo === 'string' && !!task.taskNo && typeof task.warehouseName === 'string')
    && new Set(result.tasks.map(task => task.taskId)).size === result.tasks.length
    && typeof result.partial === 'boolean' && typeof result.remaining === 'number' && Number.isSafeInteger(result.remaining) && result.remaining >= 0 && result.partial === (result.remaining > 0)
}
export interface OrdinarySaleConfirmation { status: 'success' | 'failed'; data: unknown; query: OrdinarySaleQuery; queryOnly: boolean }

/** Query identity survives remount; only the submitting mount keeps the frozen body and can explicitly retry it. */
export function useOrdinarySaleOperation(saleId: number, active = true) {
  useSyncExternalStore(subscribe, () => revision)
  useSyncExternalStore(subscribeInboundEdit, inboundEditRevision)
  const [owner] = useState(captureInboundEditOwner), mounted = useRef(true), running = useRef(false)
  const latest = useRef({saleId, active}); latest.current = {saleId, active}
  const frozen = useRef<{query: OrdinarySaleQuery; body: OrdinarySaleBody} | null>(null), observed = useRef<OrdinarySaleQuery | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const current = () => mounted.current && latest.current.saleId === saleId && latest.current.active && inboundEditOwnerCurrent(owner)
  const readCurrent = () => read(owner, saleId)
  let pending: OrdinarySaleQuery | null = null, storageError = ''
  try { pending = current() ? readCurrent() : null; if (pending) observed.current = pending; else pending = current() ? observed.current : null } catch (e) { storageError = e instanceof Error ? e.message : '原操作查询身份不可读取' }
  function capture(r?: OrdinarySaleQuery) {
    if (!current() || !positive(saleId)) throw Error('原订单、账号、服务器或当前页面已变化，请回原处查询')
    if (r && (domain(r) !== domain({...owner, saleId}) || snapshot(readCurrent() ?? observed.current!) !== snapshot(r))) throw Error('原操作查询身份已变化，请保留记录并核对')
  }
  function mayWrite(kind: OrdinarySaleKind) { capture(); const a = useAuthStore.getState(); if (!hasPermission(a.user?.permissions, permission(kind), a.user?.roleId)) throw Error('当前账号无此操作权限，请查询原结果') }
  async function perform<T>(fn: () => Promise<T>): Promise<T> {
    capture(); const lock = domain({...owner, saleId})
    if (running.current || activeDomains.has(lock)) throw Error('正在核对原销售操作，请等待结果')
    if (!navigator.locks?.request) throw Error('此客户端无法安全保存原操作，本次没有发送')
    running.current = true; activeDomains.add(lock); setBusy(true); setError('')
    try { return await navigator.locks.request(`flowcube-ordinary-sale:${lock}`, async () => { capture(); return fn() }) }
    catch (e) { if (current()) setError(e instanceof Error ? e.message : '原操作结果待确认'); throw e }
    finally { running.current = false; activeDomains.delete(lock); if (mounted.current) setBusy(false); notify() }
  }
  async function finish(r: OrdinarySaleQuery, status: 'success' | 'failed', data: unknown): Promise<OrdinarySaleConfirmation> {
    capture(r)
    await completeTerminalSlot(terminalKey(r), r, status)
    capture(r)
    localStorage.removeItem(requestKey(r))
    if (localStorage.getItem(requestKey(r)) !== null) throw Error('原结果已确认，但查询记录清理失败；请继续查询，禁止另发操作')
    const queryOnly = !frozen.current || snapshot(frozen.current.query) !== snapshot(r)
    frozen.current = null; observed.current = null; notify()
    setError(status === 'success' ? '原操作已确认成功，请核对原订单；新的一批可重新填写' : '原操作已确认未执行，可重新填写')
    return {status, data, query:r, queryOnly}
  }
  async function send(r: OrdinarySaleQuery, reservation: TerminalReservation, first: boolean) {
    capture(r); mayWrite(r.kind)
    const original = frozen.current
    if (!original || snapshot(original.query) !== snapshot(r) || await hash(original.body) !== r.bodyHash) throw Error('本页面没有完整原正文，仅可查询原结果')
    capture(r); mayWrite(r.kind); assertTerminalReadyForPost(terminalKey(r), r, reservation)
    let received = false
    try {
      const body = original.body, config = inboundEditConfig(owner)
      const result = r.kind === 'reserve' ? await reserveSaleApi(r.saleId, body.items as ReserveItemOverride[] | undefined, r.requestKey, config)
        : r.kind === 'release' ? await releaseSaleApi(r.saleId, body.items as ReserveItemOverride[] | undefined, r.requestKey, config)
          : await shipSaleApi(r.saleId, body.items as ShipItemRequest[] | undefined, r.requestKey, config)
      capture(r)
      if (!validOrdinarySaleResult(r.kind, result, false)) throw Error('原操作结果内容无法核对，请查询原结果')
      received = true
      return await finish(r,'success',result)
    } catch (e) {
      if (!current()) throw e
      const failure = e as {status?:number; code?:string; data?:{uncertain?:boolean}}
      // Only a first, definitive rejection ends a request. A retry's 4xx cannot prove the original did not commit.
      if (!received && first && typeof failure.status === 'number' && failure.status >= 400 && failure.status < 500 && failure.status !== 408
        && failure.code !== 'REQUEST_IN_PROGRESS' && !failure.data?.uncertain
        && (failure.status !== 409 || ['CREDIT_LIMIT_EXCEEDED','SALE_RESERVATION_EXECUTION_PENDING'].includes(failure.code ?? ''))) await finish(r,'failed',null)
      throw e
    }
  }
  async function queryRecord(r: OrdinarySaleQuery) {
    capture(r); const terminal = await matchingCompactTerminal(terminalKey(r), r)
    const receipt = await getOperationRequestStatusApi(r.requestKey,r.action,inboundEditConfig(owner))
    capture(r)
    if (receipt.status === 'success') {
      if (receipt.resourceType !== 'sale_order' || receipt.resourceId !== r.saleId || !validOrdinarySaleResult(r.kind,receipt.data,true)) throw Error('原结果与原订单或动作不一致，请保留记录并人工核对')
      return await finish(r,'success',receipt.data)
    }
    if (receipt.status === 'failed') {
      if (receipt.resourceType != null && receipt.resourceType !== 'sale_order' || receipt.resourceId != null && receipt.resourceId !== r.saleId) throw Error('原失败结果与原订单不一致，请人工核对')
      return await finish(r,'failed',null)
    }
    setError(terminal && terminal.state !== 'reserved' ? '原操作已有确认记录，暂无法读取详情；只查询，不能重发' : receipt.status === 'pending' ? '原操作仍在处理，请稍后查询' : '暂未查到原结果，不代表未执行；本页可按原请求重试，刷新后只能查询')
    return {status:receipt.status, terminal}
  }
  const run = (kind: OrdinarySaleKind, body: OrdinarySaleBody) => perform(async () => {
    mayWrite(kind)
    if (storageError || readCurrent() || observed.current) throw Error('原销售操作结果待确认，请先查询；禁止另键占库、释放或发货')
    const original = JSON.parse(JSON.stringify(body)) as OrdinarySaleBody, bodyHash = await hash(original)
    capture(); mayWrite(kind)
    const r: OrdinarySaleQuery = {version:1,userId:owner.userId!,baseURL:owner.baseURL,saleId,kind,action:`sale.${kind}:${saleId}`,path:`/sale/${saleId}/${kind}`,method:'post',requestKey:createRequestKey(`sale-${kind}`),createdAt:Date.now(),bodyHash}
    const reservation = await reserveTerminalSlot(terminalKey(r),r)
    try { capture(); mayWrite(kind); save(r) }
    catch (e) { await cancelUnsentTerminalSlot(terminalKey(r),r); throw e }
    frozen.current={query:r,body:original}; observed.current=r
    return send(r,reservation,true)
  })
  const recover = (retry: boolean) => perform(async () => {
    const r = readCurrent() ?? observed.current
    if (!r) throw Error('没有待确认的原销售操作')
    const result = await queryRecord(r)
    if (result.status !== 'not_found' || !retry) return result
    if (result.terminal && result.terminal.state !== 'reserved') return result
    if (!frozen.current || snapshot(frozen.current.query) !== snapshot(r)) throw Error('刷新后仅可查询原结果，不能重新发送')
    if (r.createdAt > Date.now() + OPERATION_CLOCK_MARGIN_MS || Date.now() - r.createdAt >= OPERATION_RETENTION_MS - OPERATION_CLOCK_MARGIN_MS) throw Error('原操作超出安全重试时限，仅可查询并人工核对')
    mayWrite(r.kind); const reservation = await reserveTerminalSlot(terminalKey(r),r,true)
    return send(r,reservation,false)
  })
  return { pending, busy, error:storageError || error, storageBlocked:!!storageError, blocked:!!pending || busy || !!storageError || !current(),
    canRetry:!!pending && !!frozen.current && snapshot(frozen.current.query) === snapshot(pending) && current(),
    run, queryOriginal:()=>recover(false), retry:()=>recover(true) }
}
