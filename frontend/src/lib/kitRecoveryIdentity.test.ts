// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
let useAuthStore: typeof import('@/store/authStore').useAuthStore
const listeners = vi.spyOn(window, 'addEventListener')
const user = { id: 5 } as never
beforeEach(async () => {
  vi.resetModules()
  sessionStorage.clear()
  useAuthStore = (await import('@/store/authStore')).useAuthStore
  useAuthStore.setState({ token: 'fixture', user, sessionGeneration: 0 })
})
afterEach(() => {
  // Module reload represents a new document: old document listeners are gone.
  for (const [type, listener, options] of listeners.mock.calls)
    if (type === 'storage') window.removeEventListener(type, listener, options)
  listeners.mockClear()
})
test('real login/logout observer remains active without any mounted kit page; token renewal preserves session', async () => {
  const module = await import('./kitRecoveryIdentity')
  const first = module.kitQuerySession()
  useAuthStore.getState().setTokens('renewed', null)
  expect(module.kitQuerySession()).toBe(first)
  useAuthStore.getState().logout()
  useAuthStore.getState().login('same-user-login', null, user)
  expect(module.kitQuerySession()).not.toBe(first)
})
test('module reload with rehydrated generation0 permits query but first load after new login1 rotates prior identity', async () => {
  let module = await import('./kitRecoveryIdentity')
  useAuthStore.getState().login('fixture', null, user)
  const original = module.kitQuerySession()
  const session = sessionStorage.getItem('flowcube-kit-query-session-v1')!
  // Simulate a new document's auth rehydrate: memory generation starts at zero.
  vi.resetModules()
  const freshAuth = (await import('@/store/authStore')).useAuthStore
  await freshAuth.persist.rehydrate()
  expect(freshAuth.getState().sessionGeneration).toBe(0)
  expect(freshAuth.getState().user?.id).toBe(5)
  sessionStorage.setItem('flowcube-kit-query-session-v1', session)
  module = await import('./kitRecoveryIdentity')
  expect(module.kitQuerySession()).toBe(original)
  vi.resetModules()
  const loginAuth = (await import('@/store/authStore')).useAuthStore
  loginAuth.getState().login('fixture', null, user)
  sessionStorage.setItem('flowcube-kit-query-session-v1', session)
  module = await import('./kitRecoveryIdentity')
  expect(module.kitQuerySession()).not.toBe(original)
})
test('foreign-tab development auth update invalidates old tab query ownership without reading token values', async () => {
  const module = await import('./kitRecoveryIdentity')
  const original = module.kitQuerySession()
  window.dispatchEvent(
    new StorageEvent('storage', {
      key: 'flowcube-auth-v3',
      storageArea: localStorage
    })
  )
  expect(module.kitQuerySession()).not.toBe(original)
})
