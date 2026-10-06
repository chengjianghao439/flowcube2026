import type { HandlingSpec, HandlingAck, HandlingKind } from '@/types/disposal-handling'
import { captureDisposalOwner, disposalOwnerCurrent, disposalConfig, disposalEpoch, subscribeDisposalRecovery } from './disposalRecovery'
import { useAuthStore } from '@/store/authStore'
import { quantityInputError } from './qtyStep'
import { hasPermission } from './permissions'
import type { PermissionCode } from './permission-codes'
export { captureDisposalOwner as captureHandlingOwner, disposalOwnerCurrent as handlingOwnerCurrent, disposalConfig as handlingConfig, disposalEpoch as handlingEpoch }
export const HANDLING_STORAGE = 'flowcube-disposal-handling-v1'
export interface HandlingRecord extends HandlingSpec {
  version: 1; userId: number; baseURL: string; method: 'post'; createdAt: number
  phase: 'pending' | 'confirmed'; result?: HandlingAck
}
const listeners = new Set<() => void>()
let revision = 0
function notify() { revision++; listeners.forEach(listener => listener()) }
subscribeDisposalRecovery(notify)
export const subscribeHandling = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export const handlingRevision = () => revision
if (typeof window !== 'undefined') window.addEventListener('storage', event => { if (event.key === HANDLING_STORAGE || event.key === null) notify() })
export function mayHandle(...permissions: PermissionCode[]) {
  const state = useAuthStore.getState()
  return !!state.token && permissions.every(permission => hasPermission(state.user?.permissions, permission, state.user?.roleId))
}
export const handlingId = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0
export const handlingUuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)
export function handlingQty(n: unknown, positive = true): n is number {
  return typeof n === 'number' && Number.isFinite(n) && (positive ? n > 0 : n >= 0) && n <= 9999999999.99 && quantityInputError(String(n)) === null
}
export function canonicalHandling(value: unknown): string {
  const plain = JSON.parse(JSON.stringify(value))
  function sorted(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(sorted)
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, sorted(child)]))
    return v
  }
  return JSON.stringify(sorted(plain))
}
function object(v: unknown): v is Record<string, unknown> { return !!v && typeof v === 'object' && !Array.isArray(v) }
function secretFree(v: unknown): boolean {
  if (Array.isArray(v)) return v.every(secretFree)
  return !object(v) || Object.entries(v).every(([key, child]) => !/^(authorization|token|accessToken|refreshToken|password|sessionGeneration)$/i.test(key) && secretFree(child))
}
const target = {
  sale: { path: '/sale', action: 'disposal.handling.sale.create', type: 'sale_order', number: 'orderNo' },
  purchase_return: { path: '/returns/purchase', action: 'disposal.handling.purchase_return.create', type: 'purchase_return', number: 'returnNo' },
  scrap: { path: '/disposals', action: 'disposal.handling.scrap.create', type: 'inventory_disposal', number: 'disposalNo' },
} as const
function validSpec(r: HandlingSpec) {
  if (!handlingUuid(r.operationUuid) || typeof r.requestKey !== 'string' || !r.requestKey.trim() || r.requestKey.length > 100 || !r.draftIdentity?.trim() || !object(r.body) || !secretFree(r.body)) return false
  const b = r.body
  if (r.kind === 'conversion') return r.intentUuid === undefined && r.sourceId === undefined && r.linkId === undefined && handlingId(r.legacyId)
    && r.path === `/disposals/${r.legacyId}/sign-conversion` && r.action === `disposal.handling.legacy.convert.${r.legacyId}`
    && b.operationUuid === r.operationUuid && typeof b.snapshotFingerprint === 'string' && /^[a-f0-9]{64}$/.test(b.snapshotFingerprint) && validReason(b.reason)
  if (!handlingUuid(r.intentUuid) || r.legacyId !== undefined) return false
  if (r.kind === 'source') return r.sourceId === undefined && r.linkId === undefined && r.path === '/disposals/handling-sources' && r.action === 'disposal.handling.source.create'
    && b.operationUuid === r.operationUuid && b.intentUuid === r.intentUuid && handlingId(b.productId) && handlingId(b.warehouseId) && typeof b.unit === 'string' && !!b.unit.trim() && [1,2,3].includes(Number(b.handlingType)) && handlingQty(b.quantity)
  if (!handlingId(r.sourceId)) return false
  if (r.kind === 'release') return handlingId(r.linkId) && r.path === `/disposals/handling-sources/${r.sourceId}/links/${r.linkId}/release` && r.action === `disposal.handling.link.release.${r.linkId}`
    && b.operationUuid === r.operationUuid && handlingId(b.expectedRevision) && validReason(b.reason)
  if (r.linkId !== undefined || !(r.kind in target)) return false
  const meta = target[r.kind as keyof typeof target], ref = b.disposalSource
  return r.path === meta.path && r.action === meta.action && object(ref) && ref.sourceId === r.sourceId && ref.operationUuid === r.operationUuid && handlingId(ref.expectedRevision)
    && Array.isArray(b.items) && b.items.length === 1 && object(b.items[0]) && handlingId(b.items[0].productId) && handlingQty(b.items[0].quantity)
    && handlingId(b.warehouseId) && (r.kind !== 'purchase_return' || (handlingId(b.purchaseOrderId) && handlingId(b.items[0].sourceItemId)))
}
function validReason(v: unknown) { return typeof v === 'string' && !!v.trim() && Array.from(v).length <= 500 }
export function handlingAckMatches(r: HandlingSpec, value: unknown): value is HandlingAck {
  if (!object(value)) return false
  const b = r.body
  if (r.kind === 'source') return handlingId(value.id) && value.intentUuid === r.intentUuid && value.productId === b.productId && value.warehouseId === b.warehouseId && value.unit === b.unit && value.quantity === b.quantity && value.handlingType === b.handlingType && value.revision === 1
  if (r.kind === 'release') return value.sourceId === r.sourceId && value.linkId === r.linkId && handlingQty(value.executedQuantity, false) && handlingQty(value.releasedQuantity, false) && value.revision === Number(b.expectedRevision) + 1
  if (r.kind === 'conversion') {
    if (!handlingId(value.id) || value.originalDisposalId !== r.legacyId || value.operationUuid !== r.operationUuid || value.snapshotFingerprint !== b.snapshotFingerprint || typeof value.disposalNo !== 'string' || !value.disposalNo.trim() || !Array.isArray(value.sources) || !value.sources.length) return false
    let previous = 0
    const ids = new Set<number>(), intents = new Set<string>()
    return value.sources.every(s => {
      if (!object(s) || !handlingId(s.sourceId) || !handlingUuid(s.intentUuid) || !handlingId(s.legacyItemId) || s.legacyItemId <= previous || !handlingId(s.productId) || !handlingId(s.warehouseId) || ![1,2,3].includes(Number(s.handlingType)) || typeof s.unit !== 'string' || !s.unit.trim() || !handlingQty(s.quantity) || s.revision !== 1 || ids.has(s.sourceId) || intents.has(s.intentUuid)) return false
      previous = s.legacyItemId; ids.add(s.sourceId); intents.add(s.intentUuid); return true
    })
  }
  const meta = target[r.kind as keyof typeof target]
  return !!meta && handlingId(value.id) && typeof value[meta.number] === 'string' && !!String(value[meta.number]).trim()
}
export function handlingResource(kind: HandlingKind) { return kind === 'source' ? 'disposal_handling_source' : kind === 'release' ? 'disposal_handling_link' : kind === 'conversion' ? 'inventory_disposal_conversion' : target[kind].type }
export function handlingRecordIdentity(r: Pick<HandlingRecord, 'userId' | 'baseURL' | 'draftIdentity'>) { return JSON.stringify([r.userId, r.baseURL, r.draftIdentity]) }
function validRecord(value: unknown): value is HandlingRecord {
  if (!object(value)) return false
  const r = value as unknown as HandlingRecord
  return r.version === 1 && handlingId(r.userId) && typeof r.baseURL === 'string' && !!r.baseURL.trim() && r.method === 'post' && Number.isSafeInteger(r.createdAt) && r.createdAt > 0 && r.createdAt <= Date.now()
    && ['pending','confirmed'].includes(r.phase) && validSpec(r) && (r.phase !== 'confirmed' || handlingAckMatches(r, r.result)) && secretFree(r)
}
export function readHandlingRecords(): HandlingRecord[] {
  const raw = localStorage.getItem(HANDLING_STORAGE)
  if (raw === null) return []
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { throw Error('处理请求记录损坏，请保留并人工核对') }
  if (!Array.isArray(parsed) || parsed.length > 30 || parsed.some(r => !validRecord(r)) || new Set(parsed.map(handlingRecordIdentity)).size !== parsed.length || new Set(parsed.map(r => r.operationUuid)).size !== parsed.length) throw Error('处理请求身份不完整，请保留并人工核对')
  return parsed
}
function persist(records: HandlingRecord[]) {
  const text = canonicalHandling(records)
  if (text.length > 2_000_000) throw Error('原处理请求已满，请先核对已有结果')
  // Empty list is also written/read back, so failed cleanup cannot silently unlock a pending request.
  const previous = localStorage.getItem(HANDLING_STORAGE)
  try {
    localStorage.setItem(HANDLING_STORAGE, text)
    if (localStorage.getItem(HANDLING_STORAGE) !== text) throw Error('处理请求保存核对失败，禁止发送或重复保存')
  } catch (error) {
    try { if (previous === null) localStorage.removeItem(HANDLING_STORAGE); else localStorage.setItem(HANDLING_STORAGE, previous) } catch { /* Keep the in-memory blocker and require manual storage/result verification. */ }
    throw error
  }
  notify()
}
export function saveHandlingRecord(record: HandlingRecord) {
  if (!validRecord(record)) throw Error('原处理请求不完整，禁止发送')
  const records = readHandlingRecords()
  if (records.length >= 30 || records.some(r => handlingRecordIdentity(r) === handlingRecordIdentity(record) || r.operationUuid === record.operationUuid)) throw Error('已有待核对请求或记录已满，请先查询原结果')
  persist([...records, record])
}
export function confirmHandlingRecord(record: HandlingRecord, result: HandlingAck) {
  if (!handlingAckMatches(record, result)) throw Error('原结果身份不符，请人工核对')
  const records = readHandlingRecords(), found = records.find(r => r.operationUuid === record.operationUuid)
  if (!found || canonicalHandling(found) !== canonicalHandling(record)) throw Error('原记录已变化，请人工核对')
  persist(records.map(r => r.operationUuid === record.operationUuid ? { ...r, phase: 'confirmed', result } : r))
}
export function removeHandlingRecord(record: HandlingRecord) {
  const records = readHandlingRecords(), found = records.find(r => r.operationUuid === record.operationUuid)
  if (!found || found.phase !== 'confirmed' || canonicalHandling({ ...found, phase: record.phase, result: record.result }) !== canonicalHandling(record)) throw Error('原确认记录已变化，不清理别的请求')
  persist(records.filter(r => r.operationUuid !== record.operationUuid))
}
export function ownHandlingRecords() {
  const owner = captureDisposalOwner()
  try { return { records: readHandlingRecords().filter(r => r.userId === owner.userId && r.baseURL === owner.baseURL), error: '' } }
  catch (e) { return { records: [] as HandlingRecord[], error: e instanceof Error ? e.message : '处理请求存储不可读取，请人工核对' } }
}
export function readHandlingSourceId(path: string): number | 'invalid' | null {
  const p = new URLSearchParams(path.split('?')[1] ?? '')
  if (!p.has('handlingSourceId')) return null
  const values = p.getAll('handlingSourceId'), pathname = path.split(/[?#]/)[0]
  if (!['/sale/new','/returns/purchase/new','/disposals/new'].includes(pathname) || ['sourceId','sourceNo','sourceType'].some(k => p.has(k)) || values.length !== 1 || !/^[1-9]\d*$/.test(values[0]) || !handlingId(Number(values[0]))) return 'invalid'
  return Number(values[0])
}
