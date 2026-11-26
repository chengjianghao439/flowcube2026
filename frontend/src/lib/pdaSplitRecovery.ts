import type { SplitContainerBody, SplitContainerResult } from '@/api/inventory'
import { createRequestKey } from '@/lib/requestKey'
import { currentApiEndpoint } from '@/lib/apiEndpoint'
import { getApiClientBaseURL, subscribeApiClientBaseURL } from '@/api/client'
import { useAuthStore } from '@/store/authStore'

/** 仅 I→B 拆分；不替换 fill/repack 的记录与回执。存储保留到确认，不因退出清除。 */
export interface SplitRecoveryRecord {
  accountId: number
  endpoint: string
  sourceContainerId: number
  sourceBarcode: string | null
  productId: number | null
  warehouseId: number | null
  remaining: number | null
  action: string
  requestKey: string
  createdAt: string
  body: SplitContainerBody | null
}
interface SplitRecoveryNotice { busy?: boolean; message?: string; notFoundAt?: number; context?: string }
interface Snapshot { records: SplitRecoveryRecord[]; notices: Record<string, SplitRecoveryNotice>; error: string | null }
const empty: Snapshot = { records: [], notices: {}, error: null }
const states = new Map<string, Snapshot>()
const listeners = new Set<() => void>()
export const splitRecoveryStorageKey = (accountId: number) => `flowcube_pda_split_v1:${accountId}`
export const splitRequestStoragePrefix = (accountId: number, endpoint: string) => 'flowcube_pda_split_v2:' + accountId + ':' + encodeURIComponent(endpoint) + ':'
const requestStorageKey = (record: Pick<SplitRecoveryRecord, 'accountId' | 'endpoint' | 'requestKey'>) => splitRequestStoragePrefix(record.accountId, record.endpoint) + encodeURIComponent(record.requestKey)
export const subscribeSplitRecovery = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export const splitRecoverySnapshot = (accountId: number | null, endpoint = currentApiEndpoint()) => accountId == null ? empty : states.get(splitRequestStoragePrefix(accountId, endpoint)) ?? empty
const publish = (accountId: number, endpoint: string, next: Snapshot) => { states.set(splitRequestStoragePrefix(accountId, endpoint), next); listeners.forEach(fn => fn()) }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0
const quantity = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0 && Math.abs(v * 100 - Math.round(v * 100)) < 1e-8
export function splitEndpoint(raw = getApiClientBaseURL() ?? '/api') {
  const u = new URL(raw, window.location.origin)
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw new Error('原服务器地址无法确认')
  return u.href.replace(/\/$/, '')
}
// 每次合法改址递增，A→B→A也不能复用旧读取/写入响应。
let serverEpoch = 0
subscribeApiClientBaseURL(() => { serverEpoch++; listeners.forEach(fn => fn()) })
export const splitServerEpoch = () => serverEpoch
let ownerEpoch = 0
useAuthStore.subscribe((next, previous) => {
  const identity = (s: typeof next) => JSON.stringify([s.sessionGeneration, s.user?.id, s.user?.roleId, [...(s.user?.permissions ?? [])].sort()])
  if (identity(next) !== identity(previous)) ownerEpoch++
})
export const splitOwnerEpoch = () => ownerEpoch
function trustedSplitBody(value: unknown): value is SplitContainerBody {
  return object(value) && Object.keys(value).every(k => ['qty', 'remark', 'printLabel', 'targetContainerId'].includes(k))
    && quantity(value.qty) && (value.remark === undefined || typeof value.remark === 'string' && value.remark.length <= 500)
    && (value.printLabel === undefined || typeof value.printLabel === 'boolean')
    && (value.targetContainerId === undefined || positive(value.targetContainerId))
}
function parseRecord(value: unknown, accountId: number): SplitRecoveryRecord {
  if (!object(value) || value.accountId !== accountId || !positive(value.sourceContainerId)
      || value.action !== `inventory.container.split.${value.sourceContainerId}` || typeof value.requestKey !== 'string' || !value.requestKey.trim()
      || typeof value.endpoint !== 'string' || splitEndpoint(value.endpoint) !== value.endpoint) throw new Error('原拆分记录归属或身份无法确认，请保留记录人工核对')
  // 残缺载荷或异常时间只供本人查原回执，绝不补默认值构造POST。
  return {
    accountId, endpoint: value.endpoint, sourceContainerId: value.sourceContainerId, action: String(value.action), requestKey: value.requestKey,
    sourceBarcode: typeof value.sourceBarcode === 'string' ? value.sourceBarcode : null,
    productId: positive(value.productId) ? value.productId : null, warehouseId: positive(value.warehouseId) ? value.warehouseId : null,
    remaining: typeof value.remaining === 'number' && Number.isFinite(value.remaining) ? value.remaining : null,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : '', body: trustedSplitBody(value.body) ? { ...value.body } : null,
  }
}
function legacyRecords(accountId: number): unknown[] {
  const raw = localStorage.getItem(splitRecoveryStorageKey(accountId))
  if (raw === null) return []
  const d: unknown = JSON.parse(raw)
  if (!object(d) || d.version !== 1 || !Array.isArray(d.records)) throw new Error('原拆分恢复记录无法识别，请保留记录人工核对')
  return d.records
}
function diskRecords(accountId: number, endpoint: string) {
  const records = legacyRecords(accountId)
    .filter(r => !object(r) || typeof r.endpoint !== 'string' || splitEndpoint(r.endpoint) === endpoint)
    .map(r => parseRecord(r, accountId))
  const prefix = splitRequestStoragePrefix(accountId, endpoint)
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key?.startsWith(prefix)) continue
    const record = parseRecord(JSON.parse(localStorage.getItem(key) ?? 'null'), accountId)
    if (requestStorageKey(record) !== key) throw new Error('原拆分记录与存储位置不一致，请人工核对')
    records.push(record)
  }
  if (new Set(records.map(r => r.requestKey)).size !== records.length) throw new Error('原拆分记录身份重复，请人工核对')
  return records
}
const sameSplitRecord = (a: SplitRecoveryRecord, b: SplitRecoveryRecord) => JSON.stringify(a) === JSON.stringify(b)
export function reloadSplitRecovery(accountId: number, endpoint = currentApiEndpoint()) {
  const prev = splitRecoverySnapshot(accountId, endpoint)
  try {
    const records = diskRecords(accountId, endpoint)
    const notices = Object.fromEntries(Object.entries(prev.notices).filter(([key]) => records.some(r => r.requestKey === key && prev.records.some(p => sameSplitRecord(r, p)))))
    publish(accountId, endpoint, { records, notices, error: null })
  } catch (error) { publish(accountId, endpoint, { ...prev, error: error instanceof Error ? error.message : '拆分记录读取失败，请人工核对' }) }
}
export function ownsStoredSplit(record: SplitRecoveryRecord) {
  try { return diskRecords(record.accountId, record.endpoint).some(r => sameSplitRecord(r, record)) } catch { return false }
}
export function noticeSplitRecovery(record: SplitRecoveryRecord, notice: SplitRecoveryNotice) {
  if (!ownsStoredSplit(record)) return
  const state = splitRecoverySnapshot(record.accountId, record.endpoint)
  publish(record.accountId, record.endpoint, { ...state, notices: { ...state.notices, [record.requestKey]: { ...state.notices[record.requestKey], ...notice } } })
}
export function claimSplitRecovery(accountId: number, source: { sourceContainerId: number; sourceBarcode: string; productId: number; warehouseId: number; remaining: number }, body: SplitContainerBody) {
  reloadSplitRecovery(accountId)
  const state = splitRecoverySnapshot(accountId)
  if (state.error || state.records.length) throw new Error(state.error || '有原拆分结果待确认，暂勿改目标或新建请求')
  if (!positive(source.sourceContainerId) || !/^I\d+$/.test(source.sourceBarcode) || !positive(source.productId) || !positive(source.warehouseId) || !quantity(source.remaining) || !trustedSplitBody(body)) throw new Error('原拆分完整参数无法确认')
  const record: SplitRecoveryRecord = { accountId, endpoint: splitEndpoint(), ...source, action: `inventory.container.split.${source.sourceContainerId}`, requestKey: createRequestKey('pda-split'), createdAt: new Date().toISOString(), body: { ...body } }
  const slot = requestStorageKey(record)
  try {
    if (localStorage.getItem(slot) !== null) throw new Error('请求键已被占用')
    localStorage.setItem(slot, JSON.stringify(record))
    const saved = diskRecords(accountId, record.endpoint)
    if (saved.length === 1 && sameSplitRecord(saved[0], parseRecord(record, accountId))) {
      reloadSplitRecovery(accountId, record.endpoint)
      return saved[0]
    }
    // 另一标签页先占位时，只撤销本次尚未发送的记录。
    localStorage.removeItem(slot)
  } catch { throw new Error('原请求保存失败，本次没有发送，请恢复本地存储后重试') }
  reloadSplitRecovery(accountId, record.endpoint)
  throw new Error('有原拆分结果待确认，暂勿改目标或新建请求')
}
export function removeSplitRecovery(record: SplitRecoveryRecord) {
  if (!ownsStoredSplit(record)) return false
  try {
    const slot = requestStorageKey(record)
    if (localStorage.getItem(slot) !== null) localStorage.removeItem(slot)
    else {
      const legacy = legacyRecords(record.accountId).filter(r => !object(r) || r.endpoint !== record.endpoint || r.requestKey !== record.requestKey)
      const key = splitRecoveryStorageKey(record.accountId)
      if (legacy.length) localStorage.setItem(key, JSON.stringify({ version: 1, records: legacy }))
      else localStorage.removeItem(key)
    }
    reloadSplitRecovery(record.accountId, record.endpoint)
    return !diskRecords(record.accountId, record.endpoint).some(r => sameSplitRecord(r, record))
  } catch { noticeSplitRecovery(record, { busy: false, message: '原结果已确认，但记录清理失败，请保留并再次核对' }); return false }
}
export function splitRetryPayload(record: SplitRecoveryRecord, now = Date.now()): SplitContainerBody | null {
  const time = Date.parse(record.createdAt)
  if (!record.body || !record.sourceBarcode || !/^I\d+$/.test(record.sourceBarcode) || !positive(record.productId) || !positive(record.warehouseId) || !quantity(record.remaining)
      || !Number.isFinite(time) || time > now || now - time >= 7 * 86400000) return null
  return record.body
}
export function validatedSplitResult(value: unknown, record: SplitRecoveryRecord): SplitContainerResult | null {
  if (!record.body || !object(value) || value.sourceContainerId !== record.sourceContainerId || value.sourceBarcode !== record.sourceBarcode
      || value.productId !== record.productId || value.warehouseId !== record.warehouseId || !positive(value.newContainerId)
      || value.newContainerId === record.sourceContainerId || typeof value.newBarcode !== 'string' || !/^B\d+$/.test(value.newBarcode) || value.newContainerKind !== 'plastic_box'
      || typeof value.sourceRemainingAfter !== 'number' || !Number.isFinite(value.sourceRemainingAfter) || value.sourceRemainingAfter < 0
      || !Array.isArray(value.printJobIds) || !value.printJobIds.every(positive)
      || ![value.noPrinterCount, value.renderFailedCount].every(n => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0)) return null
  if (record.body.targetContainerId != null && (value.targetContainerId !== record.body.targetContainerId || value.newContainerId !== record.body.targetContainerId || value.targetBarcode !== value.newBarcode || !quantity(value.targetQtyAfter))) return null
  return { sourceContainerId: record.sourceContainerId, sourceBarcode: String(value.sourceBarcode), sourceRemainingAfter: value.sourceRemainingAfter,
    newContainerId: value.newContainerId, newBarcode: value.newBarcode, newContainerKind: 'plastic_box', productId: Number(value.productId), warehouseId: Number(value.warehouseId),
    printJobId: positive(value.printJobId) ? value.printJobId : null, printJobIds: [...value.printJobIds], noPrinterCount: Number(value.noPrinterCount), renderFailedCount: Number(value.renderFailedCount),
    ...(record.body?.targetContainerId ? { targetContainerId: record.body.targetContainerId, targetBarcode: value.newBarcode, targetQtyAfter: Number(value.targetQtyAfter) } : {}),
  }
}
