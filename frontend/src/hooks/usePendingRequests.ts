import { useCallback, useSyncExternalStore } from 'react'
import { useAuthStore } from '@/store/authStore'

import { clearPendingSessionStorage, discardUnclaimedRequest, memoryUnclaimedRequests, readPendingStorage, saveOwnedPending, readOwnedCriticalPending, saveOwnedCriticalPending, removeOwnedCriticalPending, retainCriticalTerminal, readCriticalTerminal } from '@/lib/pendingRequestStorage'

export interface PendingRequestRecord {
  requestKey: string
  action: string
  requestAction?: string
  label: string
  createdAt: string
  metadata?: Record<string, unknown>
  unverifiedOwner?: boolean
  endpoint?: string
  deviceCode?: string | null
  deviceWarehouseId?: number | null
  requestFingerprint?: string
}

// 一个页面进程只维护一份回执；组件卸载不清内存，存储不可用时仍保留阻断。
const EMPTY: PendingRequestRecord[] = []
let records = EMPTY
let loaded = false
let staleStorage = false
let storageError: string | null = null
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
const emit = () => listeners.forEach(listener => listener())
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key == null || event.key.startsWith('pda_owned_request_v3:') || event.key.startsWith('pda_owned_terminal_v3:')) { loaded = false; emit() }
})

function isRecord(value: unknown): value is PendingRequestRecord {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<PendingRequestRecord>
  return typeof item.action === 'string' && typeof item.requestKey === 'string'
    && typeof item.label === 'string' && typeof item.createdAt === 'string'
}
function validOwnedBinding(item: PendingRequestRecord) {
  if (!item.endpoint || typeof item.requestAction !== 'string') return false
  const receive = /^inbound\.receive\.([1-9]\d*)$/.exec(item.action)
  if (receive) return item.metadata?.taskId === Number(receive[1]) && [item.action, 'inbound.receive'].includes(item.requestAction)
  const count = /^stockcheck\.scan\.([1-9]\d*)$/.exec(item.action)
  if (count) return item.metadata?.checkId === Number(count[1]) && Number.isSafeInteger(item.metadata?.itemId) && Number(item.metadata?.itemId) > 0 && [item.action, 'stockcheck.scan'].includes(item.requestAction)
  return true
}

function unclaimedRecords(): PendingRequestRecord[] {
  return memoryUnclaimedRequests().map(item => ({ ...item, label: '历史操作', createdAt: '', unverifiedOwner: true }))
}
function savePendingRequests() {
  const { user, token } = useAuthStore.getState()
  if (!user || !token) return
  try {
    saveOwnedPending(user.id, records.filter(item => !item.unverifiedOwner && !item.endpoint))
    staleStorage = false
  } catch { /* 持久化失败不撤销内存回执，仍须确认业务结果。 */ }
}
function getSnapshot(): PendingRequestRecord[] {
  if (loaded) return records
  const { user, token } = useAuthStore.getState()
  loaded = true
  records = EMPTY
  storageError = null
  if (!user || !token) return records
  try {
    const { stored } = readPendingStorage()
    const doc = stored as { version?: number; userId?: number; records?: unknown } | null
    if (!staleStorage && doc?.version === 2 && doc.userId === user.id && Array.isArray(doc.records)) {
      records = doc.records.filter(isRecord).filter(item => !item.unverifiedOwner)
    }
    const persistent = readOwnedCriticalPending(user.id)
    if (!persistent.every(isRecord) || !persistent.every(validOwnedBinding)) throw Error('原作业记录内容或单据定位不一致，请保留记录并核对')
    records = [...records, ...persistent]
  } catch (e) { storageError = e instanceof Error ? e.message : '原作业记录读取失败，请稍后核对' }
  records = [...unclaimedRecords(), ...records]
  return records
}

useAuthStore.subscribe((next, previous) => {
  if (next.sessionGeneration === previous.sessionGeneration && next.user?.id === previous.user?.id) return
  records = EMPTY
  loaded = false
  // 清理上一会话。首次登录仍允许恢复当前用户的持久化记录。
  if (previous.user || !next.user) {
    staleStorage = !clearPendingSessionStorage()
  }
  emit()
})

export function usePendingRequests() {
  const generation = useAuthStore(state => state.sessionGeneration)
  const userId = useAuthStore(state => state.user?.id)
  const currentRecords = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY)
  const update = useCallback((transform: (current: PendingRequestRecord[]) => PendingRequestRecord[]) => {
    const auth = useAuthStore.getState()
    // 退出前发起的异步请求不能污染下一次登录。
    if (!auth.token || !auth.user || auth.sessionGeneration !== generation || auth.user.id !== userId) return false
    const current = getSnapshot()
    const next = transform(current)
    if (next === current) return false
    records = next
    savePendingRequests()
    emit()
    return true
  }, [generation, userId])
  // 检查与插入在共享快照上同步完成，防止同 tick 的两个 hook 都执行关键写入。
  const claimPending = useCallback((record: PendingRequestRecord): boolean => {
    if (record.endpoint) {
      const auth = useAuthStore.getState()
      if (!auth.user || auth.sessionGeneration !== generation || auth.user.id !== userId) return false
      if (storageError) throw Error(storageError)
      if (getSnapshot().some(item => item.action === record.action)) return false
      const stored = readOwnedCriticalPending(auth.user.id)
      if (stored.some(r => isRecord(r) && r.action === record.action)) return false
      saveOwnedCriticalPending(auth.user.id, record)
    }
    return update(current => current.some(item => item.action === record.action) ? current : [...current, record])
  }, [generation, update, userId])
  const addPending = useCallback((record: PendingRequestRecord) => {
    update(current => current.some(item => item.action === record.action && item.unverifiedOwner)
      ? current : [...current.filter(item => item.action !== record.action), record])
  }, [update])
  const isPendingCurrent = useCallback((record: PendingRequestRecord) => {
    const auth = useAuthStore.getState()
    if (!auth.user || auth.user.id !== userId || auth.sessionGeneration !== generation) return false
    if (!record.endpoint) return getSnapshot().some(item => item.action === record.action && item.requestKey === record.requestKey)
    try {
      const stored = readOwnedCriticalPending(auth.user.id)
      const sameKey = stored.filter(item => isRecord(item) && item.requestKey === record.requestKey)
      if (sameKey.length) return sameKey.length === 1 && JSON.stringify(sameKey[0]) === JSON.stringify(record)
      // A missing old tab copy can only be used for GET; the hook checks the marker's immutable hash.
      return !!readCriticalTerminal(auth.user.id, record)
    } catch { return false }
  }, [generation, userId])
  const removePending = useCallback(async (action: string, requestKey?: string, outcome?: 'success' | 'failed', data?: unknown, original?: PendingRequestRecord) => {
    const sameSession = () => { const auth = useAuthStore.getState(); return auth.user?.id === userId && auth.sessionGeneration === generation && !!auth.token }
    if (!sameSession()) return false
    const removed = getSnapshot().filter(item => item.action === action && !item.unverifiedOwner && (!requestKey || item.requestKey === requestKey))
    if (!removed.length && original?.endpoint && original.action === action && original.requestKey === requestKey && isPendingCurrent(original)) removed.push(original)
    for (const r of removed) if (r.endpoint && userId) {
      if (!outcome) throw Error('原作业结果尚未确认，请保留原记录')
      await retainCriticalTerminal(userId, r, outcome, data)
      if (!sameSession() || !isPendingCurrent(r)) return false
      removeOwnedCriticalPending(userId, r.requestKey)
    }
    if (!sameSession()) return false
    update(current => current.filter(item => !removed.some(r => JSON.stringify(r) === JSON.stringify(item))))
    return true
  }, [generation, isPendingCurrent, update, userId])
  const clearAll = useCallback(() => update(current => current.filter(item => item.unverifiedOwner || item.endpoint)), [update])
  const discardUnclaimed = useCallback((action: string, requestKey: string) => {
    update(current => {
      discardUnclaimedRequest(action, requestKey)
      return current.filter(item => !item.unverifiedOwner || item.action !== action || item.requestKey !== requestKey)
    })
  }, [update])
  return { records: currentRecords, addPending, claimPending, removePending, discardUnclaimed, clearAll, pendingCount: currentRecords.length, storageError, isPendingCurrent }
}
