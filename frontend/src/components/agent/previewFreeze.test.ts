// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/store/authStore'
import type { User } from '@/types'
import type { AssistantTask } from './types'
import { createPreviewFreezeStore } from './previewFreeze'

vi.mock('@/api/client', () => ({ getApiClientBaseURL: () => '/api' }))
const task = (revision: number, extra: Partial<AssistantTask> = {}): AssistantTask => ({ id: 'synthetic-task', graph: 'B-sale-draft', state: 'AWAITING_CONFIRM', revision, ...extra })
const markerKey = () => Object.keys(localStorage).find(key => key.startsWith('flowcube-assistant-preview-freeze-v2:'))!
beforeEach(() => {
  localStorage.clear()
  useAuthStore.setState({ token: 'synthetic-token', user: { id: 1 } as User, sessionGeneration: 1 })
})
afterEach(() => vi.restoreAllMocks())

test('跨实例的新尝试提升冻结基线，丢失响应后同版不能解冻，旧实例也不能降低基线', () => {
  const first = createPreviewFreezeStore(), second = createPreviewFreezeStore()
  first.begin(task(1))
  second.begin(task(2))
  expect(Math.max(...Object.keys(localStorage).filter(key => key.startsWith('flowcube-assistant-preview-freeze-v2:')).map(key => JSON.parse(localStorage.getItem(key)!).revision))).toBe(2)
  expect(second.reconcile(task(2))).toBe(true)
  first.begin(task(1))
  expect(Math.max(...Object.keys(localStorage).filter(key => key.startsWith('flowcube-assistant-preview-freeze-v2:')).map(key => JSON.parse(localStorage.getItem(key)!).revision))).toBe(2)
  expect(second.reconcile(task(2))).toBe(true)
  expect(second.reconcile(task(3))).toBe(true)
  const retry = second.begin(task(2))
  expect(second.reconcile(task(3), retry.observation, true)).toBe(false)
})

for (const evidence of [
  { confirmationBlocked: '请明确数量' },
  ...['DONE', 'FAILED_FINAL', 'EXPIRED', 'CANCELLED'].map(state => ({ state })),
]) {
  test(`迟到低版本${'state' in evidence ? evidence.state : '服务端暂停'}不得清理新尝试冻结`, () => {
    const first = createPreviewFreezeStore(), second = createPreviewFreezeStore()
    first.begin(task(1))
    second.begin(task(2))
    expect(first.reconcile(task(1, evidence), first.observe())).toBe(true)
    expect(second.reconcile(task(2))).toBe(true)
    expect(second.reconcile(task(2, evidence), second.observe())).toBe(false)
  })
}

test('旧尝试的未修改回复不能清除另一个实例的新尝试', () => {
  const first = createPreviewFreezeStore(), second = createPreviewFreezeStore()
  const oldAttempt = first.begin(task(1))
  second.begin(task(2))
  first.finishUnchanged(task(1), oldAttempt)
  expect(second.reconcile(task(2))).toBe(true)
})

test('最终审查：晚到新版不能解冻同旧版发起的另一未知尝试', () => {
  const first = createPreviewFreezeStore(), second = createPreviewFreezeStore()
  first.begin(task(1))
  second.begin(task(1))
  expect(first.reconcile(task(2))).toBe(true)
  expect(second.reconcile(task(1))).toBe(true)
})

test('最终审查：删除旧尝试期间新begin的冻结不能被旧remove丢掉', () => {
  const first = createPreviewFreezeStore(), second = createPreviewFreezeStore()
  const attempt = first.begin(task(1))
  const key = markerKey(), originalRemove = Storage.prototype.removeItem
  let inserted = false
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, target) {
    if (this === localStorage && target === key && !inserted) {
      inserted = true
      second.begin(task(2))
    }
    originalRemove.call(this, target)
  })
  // 可信取消可清旧尝试，但删除边界中新产生的尝试不属于此证据。
  expect(first.reconcile(task(2, { state: 'CANCELLED' }), attempt.observation)).toBe(true)
  expect(inserted).toBe(true)
  expect(second.reconcile(task(2))).toBe(true)
})


test('请求自有成功新版只清已观察尝试，不能清后来同版begin', () => {
  const first = createPreviewFreezeStore(), second = createPreviewFreezeStore()
  const attempt = first.begin(task(1))
  second.begin(task(1))
  expect(first.reconcile(task(2), attempt.observation, true)).toBe(true)
  expect(second.reconcile(task(1))).toBe(true)
  const retry = second.begin(task(2))
  expect(second.reconcile(task(3), retry.observation, true)).toBe(false)
})

for (const evidence of [{ state: 'CANCELLED' }, { confirmationBlocked: '请明确数量' }]) {
  test(`GET发起后的新尝试不属于迟到${evidence.state || '暂停'}证据`, () => {
    const first = createPreviewFreezeStore(), second = createPreviewFreezeStore()
    first.begin(task(1))
    const observation = first.observe()
    second.begin(task(1))
    expect(first.reconcile(task(2, evidence), observation)).toBe(true)
    expect(second.reconcile(task(1))).toBe(true)
  })
}

test('并发begin读写之间另一实例高基线不会被旧实例覆盖', () => {
  const first = createPreviewFreezeStore(), second = createPreviewFreezeStore()
  const originalSet = Storage.prototype.setItem
  let inserted = false
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (this === localStorage && key.startsWith('flowcube-assistant-preview-freeze-v2:') && !inserted) {
      inserted = true
      second.begin(task(3))
    }
    originalSet.call(this, key, value)
  })
  const attempt = first.begin(task(1))
  expect(first.reconcile(task(2), attempt.observation, true)).toBe(true)
  expect(second.reconcile(task(2, { state: 'CANCELLED' }), second.observe())).toBe(true)
})

test('v1只读兼容按准确身份另存核对结果，不删除共享键及后来版本', () => {
  const scope = encodeURIComponent(JSON.stringify([1, '/api']))
  const key = `flowcube-assistant-preview-freeze-v1:${scope}:synthetic-task`
  const old = JSON.stringify({ version: 1, revision: 1, attemptId: 'legacy-old' })
  localStorage.setItem(key, old)
  const store = createPreviewFreezeStore()
  expect(store.reconcile(task(2))).toBe(true)
  const attempt = store.begin(task(2))
  expect(store.reconcile(task(3), attempt.observation, true)).toBe(false)
  expect(localStorage.getItem(key)).toBe(old)
  localStorage.setItem(key, JSON.stringify({ version: 1, revision: 3, attemptId: 'legacy-new' }))
  expect(store.reconcile(task(3))).toBe(true)
  expect(store.reconcile(task(4), attempt.observation, true)).toBe(true)
})

test('v1清理证据保存时出现新v1尝试，新值仍保留冻结', () => {
  const scope = encodeURIComponent(JSON.stringify([1, '/api']))
  const key = `flowcube-assistant-preview-freeze-v1:${scope}:synthetic-task`
  localStorage.setItem(key, JSON.stringify({ version: 1, revision: 1, attemptId: 'legacy-old' }))
  const store = createPreviewFreezeStore(), observation = store.observe()
  const originalSet = Storage.prototype.setItem
  let inserted = false
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, target, value) {
    if (target.startsWith('flowcube-assistant-preview-resolved-v1:') && !inserted) {
      inserted = true
      originalSet.call(this, key, JSON.stringify({ version: 1, revision: 2, attemptId: 'legacy-new' }))
    }
    originalSet.call(this, target, value)
  })
  expect(store.reconcile(task(2, { state: 'CANCELLED' }), observation)).toBe(true)
  expect(JSON.parse(localStorage.getItem(key)!).attemptId).toBe('legacy-new')
})
