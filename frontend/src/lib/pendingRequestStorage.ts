const STORAGE_KEY = 'pda_pending_request_confirmations'
const UNCLAIMED_KEY = 'pda_unclaimed_request_confirmations'
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
