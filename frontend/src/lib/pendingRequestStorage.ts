import { compactTerminalAt, completeTerminalSlot } from './criticalTerminalStorage'
const STORAGE_KEY = 'pda_pending_request_confirmations'
const UNCLAIMED_KEY = 'pda_unclaimed_request_confirmations'
const OWNED_PREFIX = 'pda_owned_request_v3:'
const TERMINAL_PREFIX = 'pda_owned_terminal_v3:'
export interface UnclaimedRequest { action: string; requestKey: string; requestAction?: string }
let unclaimed: UnclaimedRequest[] = []
let dirty = false

function minimalRecords(value: unknown): UnclaimedRequest[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => item && typeof item.action === 'string' && typeof item.requestKey === 'string'
    ? [{ action: item.action, requestKey: item.requestKey, ...(typeof item.requestAction === 'string' ? { requestAction: item.requestAction } : {}) }] : [])
}
function persistUnclaimed(): boolean {
  try {
    localStorage.setItem(UNCLAIMED_KEY, JSON.stringify(unclaimed))
    dirty = false
    return true
  } catch { dirty = true; return false }
}

/** 未归属记录只保存必要定位字段，绝不继承 label、metadata 或冒认当前账号。 */
export function readPendingStorage(): { stored: unknown; unclaimed: UnclaimedRequest[]; migrated: boolean } {
  if (!dirty) {
    try { unclaimed = minimalRecords(JSON.parse(localStorage.getItem(UNCLAIMED_KEY) || '[]')) } catch { /* 保留内存隔离记录。 */ }
  }
  const raw = localStorage.getItem(STORAGE_KEY)
  const stored: unknown = raw ? JSON.parse(raw) : null
  if (Array.isArray(stored)) {
    const merged = new Map(unclaimed.map(item => [`${item.action}\n${item.requestKey}`, item]))
    for (const item of minimalRecords(stored)) merged.set(`${item.action}\n${item.requestKey}`, item)
    unclaimed = [...merged.values()]
    dirty = true
  }
  const migrated = !dirty || persistUnclaimed()
  return { stored, unclaimed, migrated }
}
export function memoryUnclaimedRequests() { return unclaimed }
/** 新关键操作按账号和原键单独保存；登出只隐藏，不删除未确认业务身份。 */
export function readOwnedCriticalPending(userId: number): unknown[] {
  const result: unknown[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key?.startsWith(`${OWNED_PREFIX}${userId}:`)) continue
    const record: unknown = JSON.parse(localStorage.getItem(key) || 'null')
    if (!record || typeof record !== 'object' || !('requestKey' in record) || key !== `${OWNED_PREFIX}${userId}:${String(record.requestKey)}`) throw Error('原作业记录损坏，请保留记录并核对')
    result.push(record)
  }
  return result
}
export function saveOwnedCriticalPending(userId: number, record: { requestKey: string }) {
  const key = `${OWNED_PREFIX}${userId}:${record.requestKey}`, raw = JSON.stringify(record)
  localStorage.setItem(key, raw)
  if (localStorage.getItem(key) !== raw) throw Error('原作业记录保存失败，本次没有发送')
}
export function removeOwnedCriticalPending(userId: number, requestKey: string) {
  const key = `${OWNED_PREFIX}${userId}:${requestKey}`
  localStorage.removeItem(key)
  if (localStorage.getItem(key) != null) throw Error('原作业已确认，记录尚未清理，请继续核对')
}
export const criticalTerminalKey = (userId: number, requestKey: string) => `${TERMINAL_PREFIX}${userId}:${requestKey}`
export async function retainCriticalTerminal(userId: number, record: { requestKey: string }, status: 'success' | 'failed', _data?: unknown) {
  await completeTerminalSlot(criticalTerminalKey(userId, record.requestKey), record, status)
}
export function readCriticalTerminal(userId: number, record: { requestKey: string }): { status: 'success' | 'failed'; data?: unknown; compact?: boolean } | null {
  const key = criticalTerminalKey(userId, record.requestKey), compact = compactTerminalAt(key)
  if (compact) return compact.state === 'reserved' ? null : { status: compact.state, compact: true }
  const raw = localStorage.getItem(key)
  if (!raw) return null
  const parsed = JSON.parse(raw)
  if (!parsed || !['success','failed'].includes(parsed.status) || JSON.stringify(parsed.record) !== JSON.stringify(record)) throw Error('原作业确认内容与原记录不一致，请保留记录并人工核对')
  return { status: parsed.status, data: parsed.data }
}
export function saveOwnedPending(userId: number, records: unknown[]): void {
  // 隔离写失败时保留原数组，不能由新用户的 v2 内容覆盖唯一恢复来源。
  const { migrated } = readPendingStorage()
  if (!migrated) return
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, userId, records }))
}
export function clearPendingSessionStorage(): boolean {
  try {
    if (!readPendingStorage().migrated) return false
    localStorage.removeItem(STORAGE_KEY)
    return true
  } catch { return false }
}
/** 仅当前账号的终态回执，或用户显式确认未生效后调用；不发任何业务重放。 */
export function discardUnclaimedRequest(action: string, requestKey: string): void {
  unclaimed = unclaimed.filter(item => item.action !== action || item.requestKey !== requestKey)
  dirty = true
  if (persistUnclaimed()) {
    // 旧数组仍可能因此前迁移失败而残留，必须同步去掉已明确处理的同一记录。
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      const stored: unknown = raw ? JSON.parse(raw) : null
      if (Array.isArray(stored)) {
        const remaining = minimalRecords(stored).filter(item => item.action !== action || item.requestKey !== requestKey)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(remaining))
      }
    } catch { /* 清理失败只会在刷新后再次要求确认，不会自动重放。 */ }
  }
}
