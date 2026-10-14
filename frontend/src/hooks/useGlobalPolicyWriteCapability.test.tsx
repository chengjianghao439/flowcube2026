// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { SectionVisibilityContext } from '@/components/layout/SectionVisibilityContext'
import { useAuthStore } from '@/store/authStore'
import { useGlobalPolicyWriteCapability } from './useGlobalPolicyWriteCapability'

const api = vi.hoisted(() => ({ get: vi.fn(), defaults: { baseURL: '/original/api' } }))
vi.mock('@/api/client', () => ({ default: { defaults: api.defaults }, payloadClient: { get: api.get } }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let current: ReturnType<typeof useGlobalPolicyWriteCapability>
const authBefore = useAuthStore.getState()
let root: ReturnType<typeof createRoot>, host: HTMLDivElement, client: QueryClient
function Probe({ enabled }: { enabled: boolean }) {
  current = useGlobalPolicyWriteCapability(enabled)
  return <output>{String(current.allowed)}</output>
}
async function render(visible = true, enabled = true) {
  await act(async () => root.render(<QueryClientProvider client={client}><SectionVisibilityContext.Provider value={visible}><Probe enabled={enabled} /></SectionVisibilityContext.Provider></QueryClientProvider>))
  await act(async () => { await new Promise(r => setTimeout(r, 5)) })
}
beforeEach(() => {
  api.get.mockReset(); api.defaults.baseURL = '/original/api'
  useAuthStore.setState({ user: { id: 7, roleId: 5 } as never, token: 'synthetic-memory', sessionGeneration: 1 })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); useAuthStore.setState(authBefore) })

test.each([{}, null, { hasUnrestrictedWarehouseScope: false }, { hasUnrestrictedWarehouseScope: 'true' }, { hasUnrestrictedWarehouseScope: 1 }])('missing/false/malformed capability stays read-only: %j', async dto => {
  api.get.mockResolvedValue(dto); await render()
  expect(current.allowed).toBe(false); expect(current.isAllowed()).toBe(false)
})
test('only explicit true from owned /auth/me grants capability, caller permission still required', async () => {
  api.get.mockResolvedValue({ hasUnrestrictedWarehouseScope: true }); await render()
  expect(current.allowed).toBe(true)
  expect(api.get).toHaveBeenCalledWith('/auth/me', expect.objectContaining({ baseURL: '/original/api', _authSessionGeneration: 1, _erpApiFallbackTried: true }))
  await render(true, false)
  expect(current.allowed).toBe(false); expect(current.isAllowed()).toBe(false)
})
test('pending/failed read is not permission and never changes authStore user', async () => {
  let reject!: (e: unknown) => void
  const user = useAuthStore.getState().user
  api.get.mockReturnValue(new Promise((_r, j) => { reject = j })); await render()
  expect(current.allowed).toBe(false)
  await act(async () => { reject(new Error('read failed')); await new Promise(r => setTimeout(r, 5)) })
  expect(current.allowed).toBe(false); expect(current.isError).toBe(true)
  expect(useAuthStore.getState().user).toBe(user)
})
test('hidden view makes no request and late visible response cannot enable hidden controls', async () => {
  let resolve!: (dto: object) => void
  api.get.mockReturnValue(new Promise(r => { resolve = r }))
  await render(false); expect(api.get).not.toHaveBeenCalled()
  await render(); expect(api.get).toHaveBeenCalledTimes(1)
  await render(false)
  await act(async () => { resolve({ hasUnrestrictedWarehouseScope: true }); await new Promise(r => setTimeout(r, 5)) })
  expect(current.allowed).toBe(false); expect(current.isAllowed()).toBe(false)
})
test('account/session change isolates late old response, and server change invalidates click-time guard', async () => {
  let resolve!: (dto: object) => void
  api.get.mockImplementationOnce(() => new Promise(r => { resolve = r })).mockResolvedValue({ hasUnrestrictedWarehouseScope: false })
  await render()
  await act(async () => useAuthStore.setState({ user: { id: 8, roleId: 1 } as never, sessionGeneration: 2 }))
  await render()
  await act(async () => { resolve({ hasUnrestrictedWarehouseScope: true }); await new Promise(r => setTimeout(r, 5)) })
  expect(current.allowed).toBe(false)
  api.get.mockResolvedValue({ hasUnrestrictedWarehouseScope: true })
  await act(async () => { await current.refetch() }); await render()
  expect(current.allowed).toBe(true)
  api.defaults.baseURL = '/another/api'
  expect(current.isAllowed()).toBe(false)
})
test('returning to a cached visible view waits for a fresh capability read before enabling', async () => {
  api.get.mockResolvedValueOnce({ hasUnrestrictedWarehouseScope: true }); await render()
  expect(current.isAllowed()).toBe(true)
  await render(false)
  let resolve!: (dto: object) => void
  api.get.mockImplementationOnce(() => new Promise(r => { resolve = r }))
  await render(); expect(current.allowed).toBe(false); expect(current.isAllowed()).toBe(false)
  await act(async () => { resolve({ hasUnrestrictedWarehouseScope: false }); await new Promise(r => setTimeout(r, 5)) })
  expect(current.allowed).toBe(false)
})
