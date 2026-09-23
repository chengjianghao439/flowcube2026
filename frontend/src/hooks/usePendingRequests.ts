import { useCallback, useSyncExternalStore } from 'react'
import { useAuthStore } from '@/store/authStore'

import { clearPendingSessionStorage, discardUnclaimedRequest, memoryUnclaimedRequests, readPendingStorage, saveOwnedPending } from '@/lib/pendingRequestStorage'

export interface PendingRequestRecord {
  requestKey: string
  action: string
  requestAction?: string
  label: string
  createdAt: string
  metadata?: Record<string, unknown>
  unverifiedOwner?: boolean
}

// 一个页面进程只维护一份回执；组件卸载不清内存，存储不可用时仍保留阻断。
const EMPTY: PendingRequestRecord[] = []
let records = EMPTY
let loaded = false
let staleStorage = false
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
const emit = () => listeners.forEach(listener => listener())

function isRecord(value: unknown): value is PendingRequestRecord {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<PendingRequestRecord>
  return typeof item.action === 'string' && typeof item.requestKey === 'string'
    && typeof item.label === 'string' && typeof item.createdAt === 'string'
}

function unclaimedRecords(): PendingRequestRecord[] {
  return memoryUnclaimedRequests().map(item => ({ ...item, label: '历史操作', createdAt: '', unverifiedOwner: true }))
}
function savePendingRequests() {
  const { user, token } = useAuthStore.getState()
  if (!user || !token) return
  try {
    saveOwnedPending(user.id, records.filter(item => !item.unverifiedOwner))
    staleStorage = false
  } catch { /* 持久化失败不撤销内存回执，仍须确认业务结果。 */ }
}
function getSnapshot(): PendingRequestRecord[] {
  if (loaded) return records
  const { user, token } = useAuthStore.getState()
  loaded = true
  records = EMPTY
  if (!user || !token) return records
  try {
    const { stored } = readPendingStorage()
    const doc = stored as { version?: number; userId?: number; records?: unknown } | null
    if (!staleStorage && doc?.version === 2 && doc.userId === user.id && Array.isArray(doc.records)) {
      records = doc.records.filter(isRecord).filter(item => !item.unverifiedOwner)
    }
  } catch { /* 存储不可用时仍保留内存中的隔离阻断。 */ }
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
    return update(current => current.some(item => item.action === record.action) ? current : [...current, record])
  }, [update])
  const addPending = useCallback((record: PendingRequestRecord) => {
    update(current => current.some(item => item.action === record.action && item.unverifiedOwner)
      ? current : [...current.filter(item => item.action !== record.action), record])
  }, [update])
  const removePending = useCallback((action: string) => {
    update(current => current.filter(item => item.action !== action || item.unverifiedOwner))
  }, [update])
  const clearAll = useCallback(() => update(current => current.filter(item => item.unverifiedOwner)), [update])
  const discardUnclaimed = useCallback((action: string, requestKey: string) => {
    update(current => {
      discardUnclaimedRequest(action, requestKey)
      return current.filter(item => !item.unverifiedOwner || item.action !== action || item.requestKey !== requestKey)
    })
  }, [update])
  return { records: currentRecords, addPending, claimPending, removePending, discardUnclaimed, clearAll, pendingCount: currentRecords.length }
}
