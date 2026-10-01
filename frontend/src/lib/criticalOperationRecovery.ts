import { createRequestKey } from '@/lib/requestKey'

// 此版本只服务 PC 塑料盒还原；不接受通用表单、认证或自由文本。
export type RepackBody = { perBoxQty: number; boxCount: number; items?: never } | { items: number[]; perBoxQty?: never; boxCount?: never }
export interface RepackRecoveryRecord {
  accountId: number
  boxId: number
  action: string
  requestKey: string
  createdAt: string
  endpoint: string
  body: RepackBody
}
export interface RecoveryNotice {
  sessionGeneration?: number
  busy?: boolean
  message?: string
  cleanupPending?: boolean
  confirmed?: 'success' | 'failed'
}
export interface RecoverySnapshot {
  records: RepackRecoveryRecord[]
  error: string | null
  notices: Record<string, RecoveryNotice>
}
const states = new Map<number, RecoverySnapshot>()
const listeners = new Set<() => void>()
const empty: RecoverySnapshot = { records: [], error: null, notices: {} }
export const recoveryStorageKey = (accountId: number) => `flowcube_pc_repack_v1:${accountId}`
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const exactKeys = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => k in v)
const positiveId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0
const quantity = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0 && Number.isSafeInteger(Math.round(v * 100)) && Math.abs(v * 100 - Math.round(v * 100)) < 1e-7
export function trustedRepackBody(v: unknown): v is RepackBody {
  if (!object(v)) return false
  if (exactKeys(v, ['items'])) return Array.isArray(v.items) && v.items.length > 0 && v.items.length <= 100 && v.items.every(quantity)
  return exactKeys(v, ['perBoxQty', 'boxCount']) && quantity(v.perBoxQty) && positiveId(v.boxCount) && v.boxCount <= 100
}
export function normalizeRecoveryEndpoint(base: string, origin = window.location.origin): string {
  const url = /^[a-z][a-z0-9+.-]*:/i.test(base) ? new URL(base) : new URL(base, origin)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('无法识别当前服务器地址')
  return url.href.replace(/\/+$/, '')
}
function trustedRecord(v: unknown, accountId: number): v is RepackRecoveryRecord {
  if (!object(v) || !exactKeys(v, ['accountId', 'boxId', 'action', 'requestKey', 'createdAt', 'endpoint', 'body'])) return false
  if (v.accountId !== accountId || !positiveId(v.boxId) || v.action !== `plastic_box.repack.${v.boxId}` || !trustedRepackBody(v.body)) return false
  if (typeof v.requestKey !== 'string' || !/^[\w-]{1,128}$/.test(v.requestKey) || typeof v.createdAt !== 'string' || !Number.isFinite(Date.parse(v.createdAt)) || typeof v.endpoint !== 'string') return false
  try { return normalizeRecoveryEndpoint(v.endpoint) === v.endpoint } catch { return false }
}
function publish(accountId: number, state: RecoverySnapshot) {
  states.set(accountId, state)
  listeners.forEach(listener => listener())
}
export function subscribeRecovery(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
export function recoverySnapshot(accountId: number | null) { return accountId == null ? empty : states.get(accountId) ?? empty }
export function loadRecovery(accountId: number): RecoverySnapshot {
  const prev = states.get(accountId) ?? empty
  try {
    const raw = localStorage.getItem(recoveryStorageKey(accountId))
    let records: RepackRecoveryRecord[] = []
    if (raw != null) {
      const parsed: unknown = JSON.parse(raw)
      if (!object(parsed) || !exactKeys(parsed, ['version', 'records']) || parsed.version !== 1 || !Array.isArray(parsed.records) || !parsed.records.every(r => trustedRecord(r, accountId))) throw new Error('恢复记录版本或内容无法识别；请保留记录并核对原操作')
      records = parsed.records
      if (new Set(records.map(r => r.boxId)).size !== records.length || new Set(records.map(r => r.requestKey)).size !== records.length) throw new Error('恢复记录身份重复，请核对原操作')
    }
    // 清理失败或正在发出的记录不能被一次空读抹掉。
    for (const r of prev.records) if ((prev.notices[r.requestKey]?.cleanupPending || prev.notices[r.requestKey]?.busy) && !records.some(item => item.boxId === r.boxId)) records.push(r)
    const notices = Object.fromEntries(Object.entries(prev.notices).filter(([key]) => {
      const original = prev.records.find(r => r.requestKey === key)
      return original && records.some(r => sameRecoveryRecord(r, original))
    }))
    const next = { ...prev, records, notices, error: null }
    states.set(accountId, next)
    return next
  } catch (error) {
    const next = { ...prev, error: error instanceof Error ? error.message : '恢复记录读取失败，请保留原操作并稍后重试' }
    states.set(accountId, next)
    return next
  }
}
export function reloadRecovery(accountId: number) { publish(accountId, loadRecovery(accountId)) }
export function claimRecovery(accountId: number, boxId: number, endpoint: string, body: RepackBody) {
  const state = loadRecovery(accountId)
  if (state.error) { publish(accountId, state); throw new Error(state.error) }
  if (state.records.some(r => r.boxId === boxId)) throw new Error('该盒原操作结果待确认，请先查询上次结果')
  if (!positiveId(boxId) || !trustedRepackBody(body)) throw new Error('还原数量参数不合法')
  const record: RepackRecoveryRecord = {
    accountId, boxId, endpoint, action: `plastic_box.repack.${boxId}`,
    requestKey: createRequestKey('pc-repack'), createdAt: new Date().toISOString(),
    body: 'items' in body ? { items: [...body.items!] } : { perBoxQty: body.perBoxQty, boxCount: body.boxCount },
  }
  const records = [...state.records, record]
  try { localStorage.setItem(recoveryStorageKey(accountId), JSON.stringify({ version: 1, records })) }
  catch { publish(accountId, { ...state, error: '恢复记录保存失败，本次没有发送；请恢复本地存储后重试' }); throw new Error('恢复记录保存失败，本次没有发送') }
  // 写入同步完成，任何 await 之前占位，所有 hook 实例读同一份状态。
  publish(accountId, { ...state, records, notices: { ...state.notices, [record.requestKey]: { busy: true, message: '正在提交原操作' } } })
  return record
}
export function sameRecoveryRecord(a: RepackRecoveryRecord, b: RepackRecoveryRecord) {
  return a.accountId === b.accountId && a.requestKey === b.requestKey && a.boxId === b.boxId && a.action === b.action && a.endpoint === b.endpoint && a.createdAt === b.createdAt && JSON.stringify(a.body) === JSON.stringify(b.body)
}
export function ownsRecovery(record: RepackRecoveryRecord) {
  return recoverySnapshot(record.accountId).records.some(r => sameRecoveryRecord(r, record))
}
/** 异步只读结果也须对照真实磁盘身份；不使用 loadRecovery 的内存保留兜底。 */
export function ownsStoredRecovery(record: RepackRecoveryRecord): boolean {
  try {
    const raw = localStorage.getItem(recoveryStorageKey(record.accountId))
    if (raw == null) return false
    const parsed: unknown = JSON.parse(raw)
    if (!object(parsed) || !exactKeys(parsed, ['version', 'records']) || parsed.version !== 1 || !Array.isArray(parsed.records) || !parsed.records.every(r => trustedRecord(r, record.accountId))) return false
    const records: RepackRecoveryRecord[] = parsed.records
    if (new Set(records.map(r => r.boxId)).size !== records.length || new Set(records.map(r => r.requestKey)).size !== records.length) return false
    return records.some(r => sameRecoveryRecord(r, record))
  } catch { return false }
}
export function noticeRecovery(record: RepackRecoveryRecord, notice: RecoveryNotice) {
  if (!ownsRecovery(record)) return
  const state = recoverySnapshot(record.accountId)
  publish(record.accountId, { ...state, notices: { ...state.notices, [record.requestKey]: { ...state.notices[record.requestKey], ...notice } } })
}
export function removeRecovery(record: RepackRecoveryRecord): boolean {
  if (!ownsRecovery(record)) return false
  const state = loadRecovery(record.accountId)
  if (state.error) { noticeRecovery(record, { cleanupPending: true, message: '业务结果已确认，但恢复记录尚未清理；请稍后再次查询/清理' }); return false }
  if (!ownsRecovery(record)) return false
  const records = state.records.filter(r => !sameRecoveryRecord(r, record))
  try {
    if (records.length) localStorage.setItem(recoveryStorageKey(record.accountId), JSON.stringify({ version: 1, records }))
    else localStorage.removeItem(recoveryStorageKey(record.accountId))
  } catch { noticeRecovery(record, { cleanupPending: true, message: '业务结果已确认，但恢复记录尚未清理；请稍后再次查询/清理' }); return false }
  const notices = { ...state.notices }; delete notices[record.requestKey]
  publish(record.accountId, { ...state, records, notices, error: null })
  return true
}
