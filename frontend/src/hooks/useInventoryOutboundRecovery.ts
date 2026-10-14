import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { outboundApi } from '@/api/inventory'
import { getOperationRequestStatusApi } from '@/api/operation-requests'
import { useAuthStore } from '@/store/authStore'
import { createRequestKey } from '@/lib/requestKey'
import { compactTerminalAt, completeTerminalSlot, matchingCompactTerminal, reserveTerminalSlot, cancelUnsentTerminalSlot, assertTerminalReadyForPost, type TerminalReservation } from '@/lib/criticalTerminalStorage'
import { hasPermission } from '@/lib/permissions'
import { PERMISSIONS } from '@/lib/permission-codes'
import { captureInboundEditOwner, inboundEditOwnerCurrent, inboundEditConfig, subscribeInboundEdit, inboundEditRevision, type InboundEditOwner } from './useInboundTaskEditRecovery'
import type { StockChangeParams } from '@/types/inventory'

const PREFIX = 'flowcube-inventory-outbound-v1:request:', TERMINAL = 'flowcube-inventory-outbound-v1:terminal:'
const TTL = 7 * 86400000, CLOCK_MARGIN = 120000
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const positiveId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0
const stable = (v: unknown): string => v === null || typeof v !== 'object' ? JSON.stringify(v ?? null)
  : Array.isArray(v) ? `[${v.map(stable).join(',')}]`
  : `{${Object.keys(v).filter(k => (v as Record<string, unknown>)[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`
export interface OutboundRecoveryRecord {
  version: 1; userId: number; baseURL: string; requestKey: string; action: string; createdAt: number
  body: StockChangeParams; phase: 'pending' | 'success' | 'failed'; result?: { beforeQty: number; afterQty: number }
  display?: { productName: string; warehouseName: string }
}
const keyFor = (r: Pick<OutboundRecoveryRecord, 'userId' | 'baseURL' | 'requestKey'>) => encodeURIComponent(JSON.stringify([r.userId, r.baseURL, r.requestKey]))
const immutable = (r: OutboundRecoveryRecord) => stable({ ...r, phase: 'pending', result: undefined })
export function normalizeOutboundBody(body: StockChangeParams): StockChangeParams {
  if (!positiveId(body.productId) || !positiveId(body.warehouseId) || !Number.isFinite(body.quantity) || body.quantity <= 0
    || Math.abs(body.quantity * 100 - Math.round(body.quantity * 100)) > 1e-7 || Object.keys(body).some(k => !['productId', 'warehouseId', 'quantity', 'supplierId', 'unitPrice', 'remark'].includes(k))
    || (body.supplierId != null && !positiveId(body.supplierId)) || (body.unitPrice != null && (!Number.isFinite(body.unitPrice) || body.unitPrice < 0))
    || (body.remark != null && (typeof body.remark !== 'string' || body.remark.length > 200))) throw Error('出库内容不完整或数量无效，请检查原输入')
  // 与 beginManualStockRequest 的实际指纹载荷完全一致；保留价格本身精度。
  return { productId: body.productId, warehouseId: body.warehouseId, quantity: body.quantity, supplierId: body.supplierId || null, unitPrice: body.unitPrice || null, remark: body.remark || undefined }
}
export async function outboundRequestAction(body: StockChangeParams) {
  const payload = { productId: Number(body.productId), warehouseId: Number(body.warehouseId), quantity: Number(body.quantity), supplierId: body.supplierId || null, unitPrice: body.unitPrice || null, remark: body.remark || null }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable(payload)))
  return `inventory.manual-out.v2.${[...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('').slice(0, 16)}`
}
function valid(r: unknown): r is OutboundRecoveryRecord {
  if (!object(r) || r.version !== 1 || !positiveId(r.userId) || typeof r.baseURL !== 'string' || typeof r.requestKey !== 'string' || !/^[\w-]{1,128}$/.test(r.requestKey)
    || typeof r.action !== 'string' || !/^inventory\.manual-out\.v2\.[a-f0-9]{16}$/.test(r.action) || typeof r.createdAt !== 'number' || !Number.isSafeInteger(r.createdAt)
    || !['pending', 'success', 'failed'].includes(String(r.phase)) || !object(r.body)) return false
  if (r.display != null && (!object(r.display) || typeof r.display.productName !== 'string' || typeof r.display.warehouseName !== 'string')) return false
  try { normalizeOutboundBody(r.body as unknown as StockChangeParams) } catch { return false }
  return r.phase !== 'success' || object(r.result) && [r.result.beforeQty, r.result.afterQty].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0)
}
function read(owner: InboundEditOwner): OutboundRecoveryRecord[] {
  const records: OutboundRecoveryRecord[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key?.startsWith(PREFIX)) continue
    const identity: unknown = JSON.parse(decodeURIComponent(key.slice(PREFIX.length)))
    if (!Array.isArray(identity) || identity.length !== 3) throw Error('原出库记录身份损坏，请保留记录并人工核对')
    if (identity[0] !== owner.userId || identity[1] !== owner.baseURL) continue
    const record: unknown = JSON.parse(localStorage.getItem(key) || 'null')
    if (!valid(record) || PREFIX + keyFor(record) !== key) throw Error('原出库正文损坏，请保留记录并核对；暂勿另发出库')
    const terminalRaw = localStorage.getItem(TERMINAL + keyFor(record))
    if (terminalRaw) {
      const terminal: unknown = JSON.parse(terminalRaw)
      if (compactTerminalAt(TERMINAL + keyFor(record))) { records.push(record); continue }
      if (!valid(terminal) || terminal.phase === 'pending' || immutable(terminal) !== immutable(record)) throw Error('原出库确认记录冲突，请保留全部内容并核对')
      records.push(terminal)
    } else records.push(record)
  }
  if (records.length > 1) throw Error('存在多笔未核对出库，请保留全部原内容并人工核对；暂勿另发出库')
  return records
}
function persist(record: OutboundRecoveryRecord) {
  const key = PREFIX + keyFor(record), raw = JSON.stringify(record)
  localStorage.setItem(key, raw)
  if (localStorage.getItem(key) !== raw) throw Error('原出库记录未能保存，本次不发送；请恢复本地存储')
}
const notify = () => window.dispatchEvent(new StorageEvent('storage'))
const activeDomains = new Set<string>()
async function locked<T>(owner: InboundEditOwner, fn: () => Promise<T>) {
  if (!navigator.locks?.request) throw Error('此客户端无法安全恢复原出库，请使用支持本地恢复的客户端')
  return navigator.locks.request(`flowcube-outbound:${owner.userId}:${owner.baseURL}`, { ifAvailable: true }, lock => {
    if (!lock) throw Error('另一窗口正在处理原出库，请先等待并查询上次结果')
    return fn()
  })
}
export function useInventoryOutboundRecovery(onConfirmed: () => void, display?: OutboundRecoveryRecord['display']) {
  useSyncExternalStore(subscribeInboundEdit, inboundEditRevision)
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null)
  const [lastOutcome, setLastOutcome] = useState<{ requestKey: string; phase: 'success' | 'failed' } | null>(null)
  const observed = useRef<OutboundRecoveryRecord | null>(null), consumed = useRef(new Set<string>())
  const confirmed = useRef(onConfirmed); confirmed.current = onConfirmed
  const owner = captureInboundEditOwner()
  let record: OutboundRecoveryRecord | null = null, error: string | null = null
  try { record = read(owner)[0] ?? null } catch (e) { error = e instanceof Error ? e.message : '原出库记录读取失败，请核对原操作' }
  if (record) observed.current = record
  let resolved: OutboundRecoveryRecord | null = null
  if (!record && !error && observed.current?.userId === owner.userId && observed.current.baseURL === owner.baseURL) {
    try {
      const raw = localStorage.getItem(TERMINAL + keyFor(observed.current))
      const terminal: unknown = raw ? JSON.parse(raw) : null
      if (compactTerminalAt(TERMINAL + keyFor(observed.current))?.state !== 'reserved' && compactTerminalAt(TERMINAL + keyFor(observed.current))) record = observed.current
      else if (valid(terminal) && terminal.phase !== 'pending' && immutable(terminal) === immutable(observed.current)) resolved = terminal
      else { record = observed.current; error = '原出库记录已变化但结果未确认，请保留原内容并核对；暂勿另发出库' }
    } catch { record = observed.current; error = '原出库确认记录读取失败，请保留原内容并核对' }
  }
  useEffect(() => {
    if (!resolved || consumed.current.has(resolved.requestKey) || !inboundEditOwnerCurrent(owner)) return
    consumed.current.add(resolved.requestKey)
    setLastOutcome({ requestKey: resolved.requestKey, phase: resolved.phase as 'success' | 'failed' })
    if (resolved.phase === 'success') confirmed.current()
    observed.current = null
  }, [resolved, owner])
  const currentRecord = (r: OutboundRecoveryRecord) => read(owner).find(v => immutable(v) === immutable(r))
  const capture = (r: OutboundRecoveryRecord) => {
    if (!inboundEditOwnerCurrent(owner) || r.userId !== owner.userId || r.baseURL !== owner.baseURL || !(currentRecord(r) || observed.current && immutable(observed.current) === immutable(r) && compactTerminalAt(TERMINAL + keyFor(r))?.state !== 'reserved' && compactTerminalAt(TERMINAL + keyFor(r)))) throw Error('账号、服务器或原出库内容已变化，请回原账号和服务器核对')
  }
  const finish = async (r: OutboundRecoveryRecord, phase: 'success' | 'failed', result?: unknown) => {
    capture(r)
    if (phase === 'success' && (!object(result) || ![result.beforeQty, result.afterQty].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0)
      || Math.abs(Number(result.beforeQty) - Number(result.afterQty) - r.body.quantity) > 1e-7)) throw Error('返回结果与原出库数量不一致，保留原请求继续核对')
    const terminal = { ...r, phase, ...(phase === 'success' ? { result: result as OutboundRecoveryRecord['result'] } : {}) }
    await completeTerminalSlot(TERMINAL + keyFor(r), r, phase) // 先留有界身份墓碑；旧副本只能查询原结果。
    capture(r)
    localStorage.removeItem(PREFIX + keyFor(r))
    consumed.current.add(r.requestKey); observed.current = null
    setLastOutcome({ requestKey: r.requestKey, phase })
    notify()
    if (phase === 'success') confirmed.current()
    setMessage(phase === 'success' ? '已确认原出库成功' : '已确认原出库未执行，可修改原输入')
    return { status: phase, data: terminal.result }
  }
  const executeAllowed = () => {
    const auth = useAuthStore.getState()
    if (!inboundEditOwnerCurrent(owner) || !hasPermission(auth.user?.permissions, PERMISSIONS.INVENTORY_ADJUST, auth.user?.roleId)) throw Error('当前账号无出库权限，请先核对原结果')
  }
  const send = async (r: OutboundRecoveryRecord, first: boolean, reservation: TerminalReservation) => {
    capture(r); executeAllowed()
    if (await outboundRequestAction(r.body) !== r.action) throw Error('原出库正文与查询身份不一致，请保留记录并核对')
    capture(r); executeAllowed()
    assertTerminalReadyForPost(TERMINAL + keyFor(r), r, reservation)
    try {
      const data = await outboundApi(r.body, r.requestKey, inboundEditConfig(owner))
      if (!inboundEditOwnerCurrent(owner)) throw Error('账号或服务器已变化，原出库保留待确认')
      return finish(r, 'success', data)
    } catch (e) {
      if (!inboundEditOwnerCurrent(owner)) throw e
      const status = object(e) ? e.status : null
      if (first && typeof status === 'number' && status >= 400 && status < 500) { await finish(r, 'failed'); throw e }
      setMessage('出库结果待确认，请查询上次结果；暂勿另发出库')
      throw e
    }
  }
  const queryRecord = async (r: OutboundRecoveryRecord) => {
    capture(r)
    if (r.phase !== 'pending') return finish(r, r.phase, r.result)
    const marker = await matchingCompactTerminal(TERMINAL + keyFor(r), r)
    if (await outboundRequestAction(r.body) !== r.action) throw Error('原出库正文与查询身份不一致，请保留记录并核对')
    const receipt = await getOperationRequestStatusApi(r.requestKey, r.action, inboundEditConfig(owner))
    if (!inboundEditOwnerCurrent(owner)) return null
    capture(r)
    if (receipt.resourceType != null && receipt.resourceType !== 'inventory' || receipt.resourceId != null && receipt.resourceId !== r.body.productId) throw Error('原出库结果与原商品不一致，请保留记录并核对')
    if (receipt.status === 'success' || receipt.status === 'failed') return finish(r, receipt.status, receipt.data)
    if (marker && marker.state !== 'reserved') { setMessage('原操作已确认，暂未能读取原结果详情，请保留原内容并人工核对；不能重发'); return receipt }
    setMessage(receipt.status === 'pending' ? '原出库仍在处理中，请稍后查询' : '暂未查到原出库；只可按原内容重试，不能改数量或换键')
    return receipt
  }
  const perform = async <T,>(fn: () => Promise<T>) => {
    const domain = `${owner.userId}:${owner.baseURL}`
    if (busy || activeDomains.has(domain)) throw Error('正在处理原出库，请等待结果')
    activeDomains.add(domain)
    setBusy(true)
    try { return await locked(owner, fn) }
    catch (e) { if (inboundEditOwnerCurrent(owner)) setMessage(e instanceof Error ? e.message : '原出库结果待确认，请继续核对'); throw e }
    finally { activeDomains.delete(domain); setBusy(false); notify() }
  }
  const run = (body: StockChangeParams) => perform(async () => {
    executeAllowed()
    if (observed.current?.userId === owner.userId && observed.current.baseURL === owner.baseURL) throw Error('上次出库结果尚未核对，请保留原内容并查询上次结果')
    if (read(owner).length) throw Error('上次出库结果待确认，请先查询原结果')
    const canonicalBody = normalizeOutboundBody(body), action = await outboundRequestAction(canonicalBody)
    executeAllowed()
    const r: OutboundRecoveryRecord = { version: 1, userId: owner.userId!, baseURL: owner.baseURL, requestKey: createRequestKey('inventory-outbound'), action, createdAt: Date.now(), body: canonicalBody, phase: 'pending', ...(display ? { display: { ...display } } : {}) }
    const reservation = await reserveTerminalSlot(TERMINAL + keyFor(r), r)
    try { executeAllowed(); persist(r) }
    catch (e) { await cancelUnsentTerminalSlot(TERMINAL + keyFor(r), r); throw e }
    notify()
    return (await send(r, true, reservation))?.data
  })
  const query = () => perform(async () => { const r = read(owner)[0] ?? observed.current; if (!r) throw Error('没有待核对原出库'); return queryRecord(r) })
  const retry = () => perform(async () => {
    executeAllowed()
    const r = read(owner)[0] ?? observed.current; if (!r || r.phase !== 'pending') throw Error('原出库已确认，请先清理确认记录')
    const outcome = await queryRecord(r)
    if (outcome?.status !== 'not_found') return outcome
    if (r.createdAt > Date.now() + CLOCK_MARGIN || Date.now() - r.createdAt >= TTL - CLOCK_MARGIN) throw Error('原出库记录已超出安全重试时限，请只查询并人工核对')
    const reservation = await reserveTerminalSlot(TERMINAL + keyFor(r), r, true)
    capture(r)
    return send(r, false, reservation)
  })
  return { record, error, busy, message, lastOutcome, run, query, retry, blocked: !!record || !!error || busy }
}
