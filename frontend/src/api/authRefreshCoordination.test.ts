import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createAuthRefreshCoordinator, type RefreshResult } from './authRefreshCoordination'

const rotation = { kind: 'success', token: 'new-access-fixture', refreshToken: 'new-refresh-fixture' } as const
const auth = { scope: 'https://erp.fixture.invalid/api', refreshToken: 'prior-refresh-fixture', isCurrent: () => true }
const peers: Array<ReturnType<typeof createAuthRefreshCoordinator>> = []
let channelName: string
let storage: Map<string, string>
let queues: Map<string, Promise<unknown>>
let online: boolean

beforeEach(() => {
  channelName = `refresh-test-${webcrypto.randomUUID()}`
  storage = new Map()
  queues = new Map()
  online = true
})
afterEach(() => {
  for (const peer of peers.splice(0)) peer.dispose()
})

function openWindow() {
  const peer = createAuthRefreshCoordinator({
    // A FIFO mutex per key models separate same-origin document callers of Web Locks.
    withLock: (key, run) => {
      const result = (queues.get(key) ?? Promise.resolve()).then(run)
      queues.set(key, result.catch(() => {}))
      return result
    },
    storage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value) } },
    channel: new BroadcastChannel(channelName),
    crypto: webcrypto as unknown as Crypto,
    isOnline: () => online,
  })
  peers.push(peer)
  return peer
}

test('两个同会话窗口共用一次轮换，并向第二个窗口交接同一新凭据', async () => {
  const first = openWindow(), second = openWindow()
  let complete!: (result: RefreshResult) => void
  const rotate = vi.fn(() => new Promise<RefreshResult>(resolve => { complete = resolve }))
  const a = first.refresh({ ...auth, rotate })
  await vi.waitFor(() => expect(rotate).toHaveBeenCalledOnce())
  const b = second.refresh({ ...auth, rotate })
  complete(rotation)
  await expect(Promise.all([a, b])).resolves.toEqual([rotation, rotation])
  expect(rotate).toHaveBeenCalledOnce()
  expect([...storage]).toEqual([[expect.stringMatching(/^flowcube-auth-rotation-v1:[\da-f]{64}$/), '1']])
})

test('丢失响应后同窗口、另一窗口及重开窗口不再发送同一旧令牌', async () => {
  const first = openWindow(), second = openWindow()
  const rotate = vi.fn(async (): Promise<RefreshResult> => ({ kind: 'unknown' }))
  await expect(first.refresh({ ...auth, rotate })).resolves.toEqual({ kind: 'unknown' })
  const reopened = openWindow()
  await expect(Promise.all([second, reopened].map(peer => peer.refresh({ ...auth, rotate }))))
    .resolves.toEqual([{ kind: 'unknown' }, { kind: 'unknown' }])
  expect(rotate).toHaveBeenCalledOnce()
})

test('携带同令牌但指向另一服务器的窗口不会使用旧服务器轮换结果', async () => {
  const first = openWindow(), second = openWindow()
  await expect(first.refresh({ ...auth, rotate: async () => rotation })).resolves.toEqual(rotation)
  const otherRotation = { ...rotation, token: 'other-access', refreshToken: 'other-refresh' }
  const rotate = vi.fn(async () => otherRotation)
  await expect(second.refresh({ ...auth, scope: 'https://other.fixture.invalid/api', rotate })).resolves.toEqual(otherRotation)
  expect(rotate).toHaveBeenCalledOnce()
})

test('已明确吊销的轮换结果可通知同会话窗口，双方不会重发旧令牌', async () => {
  const first = openWindow(), second = openWindow()
  const rotate = vi.fn(async (): Promise<RefreshResult> => ({ kind: 'revoked' }))
  await expect(first.refresh({ ...auth, rotate })).resolves.toEqual({ kind: 'revoked' })
  await expect(second.refresh({ ...auth, rotate })).resolves.toEqual({ kind: 'revoked' })
  expect(rotate).toHaveBeenCalledOnce()
})

test('离线与排队期间更换会话都在发送前停止，不消耗轮换机会', async () => {
  const first = openWindow()
  const rotate = vi.fn(async () => rotation)
  online = false
  await expect(first.refresh({ ...auth, rotate })).resolves.toEqual({ kind: 'unavailable' })
  online = true
  await expect(first.refresh({ ...auth, isCurrent: () => false, rotate })).resolves.toEqual({ kind: 'superseded' })
  expect(storage.size).toBe(0)
  expect(rotate).not.toHaveBeenCalled()
  await expect(first.refresh({ ...auth, rotate })).resolves.toEqual(rotation)
  expect(rotate).toHaveBeenCalledOnce()
})
