import { getApiClientBaseURL } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import type { AssistantTask } from './types'

const LEGACY_PREFIX = 'flowcube-assistant-preview-freeze-v1:'
const PREFIX = 'flowcube-assistant-preview-freeze-v2:'
const terminalStates = new Set(['DONE', 'FAILED_FINAL', 'EXPIRED', 'CANCELLED'])
type Marker = { version: 1 | 2; revision: number | null; attemptId: string }
type FrozenMarker = { key: string; raw: string; marker: Marker }
export type PreviewFreezeObservation = readonly FrozenMarker[]
type Attempt = { created: boolean; attemptId: string; observation: PreviewFreezeObservation }
export class PreviewFreezeStorageError extends Error {}
const unavailable = () => new PreviewFreezeStorageError('预览冻结记录无法安全保存或读取，请检查浏览器存储。确认已暂停，请重新核对原任务。')
const validRevision = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null

/** 持久归属只有账号与服务器；进程内代次只拒绝旧回调，不参与刷新后的记录定位。 */
export function createPreviewFreezeStore() {
  const auth = useAuthStore.getState()
  const owner = { userId: auth.user?.id, server: getApiClientBaseURL(), generation: auth.sessionGeneration }
  const scope = encodeURIComponent(JSON.stringify([owner.userId, owner.server]))
  const taskKey = (task: AssistantTask) => `${scope}:${encodeURIComponent(task.id)}`
  let probe: string | undefined
  const current = () => {
    const next = useAuthStore.getState()
    if (!next.token || !owner.userId || next.user?.id !== owner.userId || next.sessionGeneration !== owner.generation || getApiClientBaseURL() !== owner.server) throw unavailable()
  }
  function storageCheck() {
    current()
    try {
      probe ??= `flowcube-assistant-preview-storage-check-v2:${scope}:${crypto.randomUUID()}`
      localStorage.setItem(probe, '1')
      if (localStorage.getItem(probe) !== '1') throw unavailable()
      localStorage.removeItem(probe)
      if (localStorage.getItem(probe) !== null) throw unavailable()
    } catch {
      // 探测只清本实例的临时键；清理失败仍报告存储不可用。
      try { if (probe) localStorage.removeItem(probe) } catch { /* 保持失败关闭 */ }
      throw unavailable()
    }
  }
  // v1 共享键不能安全 compare-and-delete。保留原字节，只另存准确旧身份的已核记录。
  const resolvedKey = (entry: FrozenMarker) => `flowcube-assistant-preview-resolved-v1:${entry.key}:${encodeURIComponent(entry.raw)}`
  function readKey(key: string): FrozenMarker | null {
    const raw = localStorage.getItem(key)
    if (raw === null) return null
    const marker = JSON.parse(raw) as Marker
    const legacy = key.startsWith(LEGACY_PREFIX)
    if (Object.keys(marker ?? {}).some(field => !['version', 'revision', 'attemptId'].includes(field)) || marker?.version !== (legacy ? 1 : 2) || !(marker.revision === null || validRevision(marker.revision) !== null) || typeof marker.attemptId !== 'string' || !marker.attemptId) throw unavailable()
    if (!legacy && !key.endsWith(`:${encodeURIComponent(marker.attemptId)}`)) throw unavailable()
    const entry = { key, raw, marker }
    return legacy && localStorage.getItem(resolvedKey(entry)) === raw ? null : entry
  }
  function read(task?: AssistantTask): FrozenMarker[] {
    current()
    try {
      const legacyKey = task ? `${LEGACY_PREFIX}${taskKey(task)}` : null
      const prefix = `${PREFIX}${task ? taskKey(task) : scope}:`
      const keys = Object.keys(localStorage).filter(key => key.startsWith(prefix) || (!task && key.startsWith(`${LEGACY_PREFIX}${scope}:`)))
      // 即使枚举为空也直接检查旧任务键，读取失败不能当作没有旧标记。
      if (legacyKey) keys.push(legacyKey)
      return keys.flatMap(key => { const entry = readKey(key); return entry ? [entry] : [] })
    } catch { throw unavailable() }
  }
  function remove(expected: FrozenMarker) {
    current()
    try {
      if (localStorage.getItem(expected.key) !== expected.raw) return
      if (expected.marker.version === 1) {
        const key = resolvedKey(expected)
        localStorage.setItem(key, expected.raw)
        if (localStorage.getItem(key) !== expected.raw) throw unavailable()
      } else {
        // 每次尝试只写自己的唯一键；此处删除不会触及同时开始的另一尝试。
        localStorage.removeItem(expected.key)
        if (localStorage.getItem(expected.key) !== null) throw unavailable()
      }
    } catch { throw unavailable() }
  }
  return {
    observe(): PreviewFreezeObservation {
      storageCheck()
      return read()
    },
    begin(task: AssistantTask): Attempt {
      storageCheck()
      const previous = read(task)
      try {
        const marker: Marker = { version: 2, revision: Math.max(validRevision(task.revision) ?? 0, ...previous.map(entry => entry.marker.revision ?? 0)), attemptId: crypto.randomUUID() }
        const key = `${PREFIX}${taskKey(task)}:${encodeURIComponent(marker.attemptId)}`
        const raw = JSON.stringify(marker)
        localStorage.setItem(key, raw)
        if (localStorage.getItem(key) !== raw) throw unavailable()
        return { created: previous.length === 0, attemptId: marker.attemptId, observation: [...previous, { key, raw, marker }] }
      } catch { throw unavailable() }
    },
    reconcile(task: AssistantTask, observation: PreviewFreezeObservation = [], allowAdvance = false): boolean {
      storageCheck()
      const observedRevision = validRevision(task.revision) ?? 0
      const markers = read(task)
      for (const entry of markers) {
        if (!observation.some(seen => seen.key === entry.key && seen.raw === entry.raw)) continue
        const frozenRevision = entry.marker.revision ?? 0
        if ((allowAdvance && observedRevision > frozenRevision) || (observedRevision >= frozenRevision && (task.confirmationBlocked || terminalStates.has(task.state)))) remove(entry)
      }
      return read(task).length > 0
    },
    // 只有本轮新增的临时标记可被“成功但未修订”的回复清除；旧未知结果必须等可信状态。
    finishUnchanged(task: AssistantTask, attempt: Attempt) {
      if (!attempt.created) return
      const marker = read(task).find(entry => entry.marker.attemptId === attempt.attemptId)
      if (marker && attempt.observation.some(seen => seen.key === marker.key && seen.raw === marker.raw)) remove(marker)
    },
  }
}
