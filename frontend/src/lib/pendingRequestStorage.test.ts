// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { clearPendingSessionStorage, readPendingStorage } from './pendingRequestStorage'
afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })
test('未挂载 hook 的真实退出清理也须先隔离；隔离写失败保留原 key', () => {
  const key = 'pda_pending_request_confirmations'
  const original = JSON.stringify([{ action: 'legacy', requestKey: 'key', label: '敏感标签', metadata: { secret: 'secret' } }])
  localStorage.setItem(key, original)
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
  expect(clearPendingSessionStorage()).toBe(false)
  expect(localStorage.getItem(key)).toBe(original)
  vi.restoreAllMocks()
  expect(clearPendingSessionStorage()).toBe(true)
  expect(localStorage.getItem(key)).toBeNull()
  expect(localStorage.getItem('pda_unclaimed_request_confirmations')).toBe(JSON.stringify([{ action: 'legacy', requestKey: 'key' }]))
  expect(readPendingStorage().unclaimed).toEqual([{ action: 'legacy', requestKey: 'key' }])
})
