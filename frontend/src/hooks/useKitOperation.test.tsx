// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, expect, test, vi } from 'vitest'
import { useKitOperation } from './useKitOperation'
import { useAuthStore } from '@/store/authStore'
import { KIT_QUERY_KEY } from '@/lib/kitOperationRecovery'
const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  query: vi.fn(),
  defaults: { baseURL: '/a' }
}))
vi.mock('@/api/client', () => ({ default: { defaults: mocks.defaults } }))
vi.mock('@/api/operation-requests', () => ({
  getOperationRequestStatusApi: mocks.query
}))
type Body = { id: number; remark: string }
type Result = { id: number }
type Control = ReturnType<typeof useKitOperation<Body, Result>>
const user = { id: 5, roleId: 1, permissions: ['*'] } as never
let hook: Control
const identity = {
  action: 'sale.update.80',
  kind: 'update',
  resourceType: 'sale_order' as const,
  resourceId: 80
}
const body = { id: 80, remark: 'sensitive draft must stay in memory' }
function Probe({
  scope = 'original',
  use = useKitOperation,
  auth = useAuthStore,
  isCurrent
}: {
  scope?: string
  use?: typeof useKitOperation
  auth?: typeof useAuthStore
  isCurrent?: () => boolean
}) {
  hook = use<Body, Result>(
    {
      baseURL: '/a',
      userId: 5,
      sessionGeneration: auth.getState().sessionGeneration
    },
    scope,
    { execute: mocks.execute, validate: (data) => !!data && data.id === 80, isCurrent }
  )
  return null
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  sessionStorage.clear()
  vi.restoreAllMocks()
  vi.resetAllMocks()
  mocks.defaults.baseURL = '/a'
  useAuthStore.getState().login('fixture', null, user)
})
async function mounted(run: () => Promise<void>, scope = 'original', isCurrent?: () => boolean) {
  const root = createRoot(document.createElement('div'))
  try {
    await act(async () => root.render(<Probe scope={scope} isCurrent={isCurrent} />))
    await run()
  } finally {
    act(() => root.unmount())
  }
}
const submitUnknown = async () => {
  mocks.execute.mockRejectedValue({ status: 408 })
  await act(async () => {
    await hook.submit(body, identity)
  })
}
test('write persists allowlisted query identity before POST, never names/body/token', async () => {
  mocks.execute.mockImplementation(async (_body, query) => {
    expect(sessionStorage.getItem(KIT_QUERY_KEY)).toContain(query.requestKey)
    throw { status: 408 }
  })
  await mounted(async () => {
    await act(async () => {
      await hook.submit(body, identity)
    })
    const stored = sessionStorage.getItem(KIT_QUERY_KEY)!
    expect(stored).not.toContain(body.remark)
    expect(stored).not.toContain('fixture')
    expect(stored).not.toContain('"payload"')
  })
})
test('storage unavailable or malformed old records prevent POST', async () => {
  await mounted(async () => {
    const original = Storage.prototype.setItem
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation((key, value) => {
        if (key === KIT_QUERY_KEY) throw new Error('blocked storage')
        return original.call(sessionStorage, key, value)
      })
    await act(async () => {
      await hook.submit(body, identity)
    })
    expect(mocks.execute).not.toHaveBeenCalled()
    spy.mockRestore()
  })
  sessionStorage.setItem(
    KIT_QUERY_KEY,
    JSON.stringify({ version: 0, records: [] })
  )
  await mounted(async () => {
    await act(async () => {
      await hook.submit(body, identity)
    })
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(hook.error).toContain('历史')
  })
})
test('query errors/pending never POST; not_found alone only queries', async () => {
  await mounted(async () => {
    await submitUnknown()
    mocks.query.mockRejectedValueOnce(new Error('query lost'))
    await act(async () => {
      await hook.retry()
    })
    mocks.query.mockResolvedValue({ status: 'not_found', data: null })
    await act(async () => {
      await hook.queryOriginal()
    })
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(hook.pending).toBeTruthy()
  })
})
test('terminal failed without optional resource fields is original endpoint/key/action response; explicit foreign failed is blocked elsewhere', async () => {
  await mounted(async () => {
    await submitUnknown()
    mocks.query.mockResolvedValue({
      status: 'failed',
      data: null,
      message: 'terminal'
    })
    await act(async () => {
      await hook.queryOriginal()
    })
    expect(hook.pending).toBeNull()
    expect(hook.error).toBe('terminal')
    expect(mocks.query.mock.calls[0][2]).toMatchObject({
      baseURL: '/a',
      _erpApiFallbackTried: true
    })
  })
})
test('late query cannot clear a different stored original identity', async () => {
  let finish!: (result: unknown) => void
  await mounted(async () => {
    await submitUnknown()
    mocks.query.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    let p!: Promise<unknown>
    act(() => {
      p = hook.queryOriginal()
    })
    const doc = JSON.parse(sessionStorage.getItem(KIT_QUERY_KEY)!)
    doc.records[0].draftId = 'other-draft'
    sessionStorage.setItem(KIT_QUERY_KEY, JSON.stringify(doc))
    await act(async () => {
      finish({
        status: 'success',
        resourceType: 'sale_order',
        resourceId: 80,
        data: { id: 80 }
      })
      await p
    })
    expect(hook.pending).toBeTruthy()
    expect(sessionStorage.getItem(KIT_QUERY_KEY)).toContain('other-draft')
  })
})
test('same user relogin and foreign endpoint cannot query or retry unknown', async () => {
  await mounted(async () => {
    await submitUnknown()
    mocks.defaults.baseURL = '/b'
    await act(async () => {
      await hook.retry()
    })
    expect(mocks.query).not.toHaveBeenCalled()
    mocks.defaults.baseURL = '/a'
    useAuthStore.getState().logout()
    useAuthStore.getState().login('new-login', null, user)
    await act(async () => {
      await hook.retry()
    })
    expect(mocks.query).not.toHaveBeenCalled()
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  })
})
test('real auth persistence rehydrate0 + module reload recovers query-only, never recreates body or applies result to fresh draft', async () => {
  await mounted(async () => {
    await submitUnknown()
  })
  const saved = sessionStorage.getItem(KIT_QUERY_KEY)!,
    savedSession = sessionStorage.getItem('flowcube-kit-query-session-v1')!
  vi.resetModules()
  const freshAuth = (await import('@/store/authStore')).useAuthStore
  await freshAuth.persist.rehydrate()
  expect(freshAuth.getState().sessionGeneration).toBe(0)
  expect(freshAuth.getState().user?.id).toBe(5)
  // New-document observers do not see the old document's login event.
  sessionStorage.setItem(KIT_QUERY_KEY, saved)
  sessionStorage.setItem('flowcube-kit-query-session-v1', savedSession)
  const freshHook = (await import('./useKitOperation')).useKitOperation
  const root = createRoot(document.createElement('div'))
  try {
    await act(async () =>
      root.render(<Probe use={freshHook} auth={freshAuth} />)
    )
    expect(hook.pending).toBeTruthy()
    expect(hook.canRetry).toBe(false)
    mocks.query.mockResolvedValueOnce({ status: 'not_found', data: null })
    await act(async () => {
      await hook.retry()
    })
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    mocks.query.mockResolvedValue({
      status: 'success',
      resourceType: 'sale_order',
      resourceId: 80,
      data: { id: 80 }
    })
    let answer: Awaited<ReturnType<Control['queryOriginal']>> = null
    await act(async () => {
      answer = await hook.queryOriginal()
    })
    expect(answer).toMatchObject({ queryOnly: true, data: { id: 80 } })
    expect(hook.canApply(answer!)).toBe(false)
    expect(hook.canView(answer!)).toBe(true)
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  } finally {
    act(() => root.unmount())
  }
})
test('success cleanup failure retains blocking identity and explains business confirmation', async () => {
  mocks.execute.mockResolvedValue({ id: 80 })
  await mounted(async () => {
    const original = Storage.prototype.setItem
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(function (this: Storage, key, value) {
        if (key === KIT_QUERY_KEY && JSON.parse(value).records.length === 0)
          throw new Error('cleanup unavailable')
        return original.call(this, key, value)
      })
    await act(async () => {
      await hook.submit(body, identity)
    })
    expect(hook.pending).toBeTruthy()
    expect(hook.error).toContain('业务结果已确认')
    await act(async () => {
      await hook.submit(body, identity)
    })
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })
})
test('two drafts with same resource have independent keys and late A result cannot change pending B', async () => {
  const controls: Record<string, Control> = {},
    completions: Record<string, (value: Result) => void> = {}
  mocks.execute.mockImplementation(
    (payload: Body) =>
      new Promise((resolve) => {
        completions[payload.remark] = resolve
      })
  )
  function Tab({ name }: { name: string }) {
    controls[name] = useKitOperation<Body, Result>(
      {
        baseURL: '/a',
        userId: 5,
        sessionGeneration: useAuthStore.getState().sessionGeneration
      },
      name,
      { execute: mocks.execute, validate: (data) => data.id === 80 }
    )
    return null
  }
  const root = createRoot(document.createElement('div'))
  try {
    await act(async () =>
      root.render(
        <>
          <Tab name="A" />
          <Tab name="B" />
        </>
      )
    )
    let a!: Promise<unknown>, b!: Promise<unknown>
    act(() => {
      a = controls.A.submit({ id: 80, remark: 'A' }, identity)
      b = controls.B.submit({ id: 80, remark: 'B' }, identity)
    })
    expect(mocks.execute.mock.calls[0][1].requestKey).not.toBe(
      mocks.execute.mock.calls[1][1].requestKey
    )
    await act(async () => {
      completions.A({ id: 80 })
      await a
    })
    expect(controls.B.pending?.scope).toBe('B')
    expect(controls.B.pendingPayload?.remark).toBe('B')
    await act(async () => {
      completions.B({ id: 80 })
      await b
    })
  } finally {
    act(() => root.unmount())
  }
})

test('optional live guard blocks a new submission before storing or executing it', async () => {
  mocks.execute.mockResolvedValue({ id: 80 })
  await mounted(async () => {
    await act(async () => { await hook.submit(body, identity) })
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(hook.pending).toBeNull()
    expect(hook.pendingPayload).toBeUndefined()
    expect(sessionStorage.getItem(KIT_QUERY_KEY)).toBeNull()
    expect(hook.error).toContain('草稿')
  }, 'original', () => false)
})

test('live guard loss after POST keeps exact original key and body through late ACK, then recovery retries only after querying', async () => {
  let current = true, complete!: (value: Result) => void
  mocks.execute.mockImplementationOnce(() => new Promise<Result>(resolve => { complete = resolve }))
  await mounted(async () => {
    let pending!: Promise<unknown>
    const submitted = { ...body }
    act(() => { pending = hook.submit(submitted, identity) })
    const stored = sessionStorage.getItem(KIT_QUERY_KEY)!
    const query = mocks.execute.mock.calls[0][1]
    submitted.remark = 'employee changed caller object after original POST'
    current = false
    // Returning to the same endpoint cannot restore a page guard invalidated by the transition.
    mocks.defaults.baseURL = '/b'; mocks.defaults.baseURL = '/a'
    await act(async () => { complete({ id: 80 }); await pending })
    expect(hook.pending?.requestKey).toBe(query.requestKey)
    expect(hook.pendingPayload).toEqual(body)
    expect(hook.blocked).toBe(true)
    expect(sessionStorage.getItem(KIT_QUERY_KEY)).toBe(stored)
    await act(async () => {
      await hook.queryOriginal(); await hook.retry(); await hook.submit(submitted, identity)
    })
    expect(mocks.query).not.toHaveBeenCalled()
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem(KIT_QUERY_KEY)).toBe(stored)
    current = true
    mocks.query.mockResolvedValueOnce({ status: 'not_found', data: null })
    mocks.execute.mockResolvedValueOnce({ id: 80 })
    let answer: Awaited<ReturnType<Control['retry']>> = null
    await act(async () => { answer = await hook.retry() })
    expect(mocks.query).toHaveBeenCalledTimes(1)
    expect(mocks.query.mock.calls[0].slice(0, 2)).toEqual([query.requestKey, identity.action])
    expect(mocks.execute).toHaveBeenCalledTimes(2)
    expect(mocks.execute.mock.calls[1][0]).toEqual(body)
    expect(mocks.execute.mock.calls[1][1]).toEqual(query)
    expect(mocks.query.mock.invocationCallOrder[0]).toBeLessThan(mocks.execute.mock.invocationCallOrder[1])
    expect(answer).toMatchObject({ data: { id: 80 }, payload: body, queryOnly: false })
    expect(hook.canApply(answer!)).toBe(true)
    expect(hook.pending).toBeNull()
  }, 'original', () => current)
})

test.each([400, 409])('late definitive %s rejection cannot clear the original identity while live guard is false', async status => {
  let current = true, reject!: (value: unknown) => void
  mocks.execute.mockImplementationOnce(() => new Promise<Result>((_resolve, fail) => { reject = fail }))
  await mounted(async () => {
    let pending!: Promise<unknown>
    act(() => { pending = hook.submit(body, identity) })
    const stored = sessionStorage.getItem(KIT_QUERY_KEY)!
    const key = hook.pending?.requestKey
    current = false
    await act(async () => { reject({ status, message: 'late rejection' }); await pending })
    expect(hook.pending?.requestKey).toBe(key)
    expect(hook.pendingPayload).toEqual(body)
    expect(sessionStorage.getItem(KIT_QUERY_KEY)).toBe(stored)
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  }, 'original', () => current)
})

test('live guard loss while querying cannot clear a stored original identity or retry a missing result', async () => {
  let current = true, complete!: (value: unknown) => void
  await mounted(async () => {
    await submitUnknown()
    const stored = sessionStorage.getItem(KIT_QUERY_KEY)!
    mocks.query.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
    let pending!: Promise<unknown>
    act(() => { pending = hook.retry() })
    current = false
    await act(async () => {
      complete({ status: 'success', resourceType: 'sale_order', resourceId: 80, data: { id: 80 } })
      await pending
    })
    expect(hook.pending).toBeTruthy()
    expect(hook.pendingPayload).toEqual(body)
    expect(sessionStorage.getItem(KIT_QUERY_KEY)).toBe(stored)
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  }, 'original', () => current)
})

test('restored query-only identity remains intact under a false live guard and never reconstructs a POST body', async () => {
  await mounted(async () => { await submitUnknown() })
  const stored = sessionStorage.getItem(KIT_QUERY_KEY)!
  let current = false
  await mounted(async () => {
    expect(hook.pendingPayload).toBeUndefined()
    expect(hook.canRetry).toBe(false)
    await act(async () => { await hook.queryOriginal(); await hook.retry() })
    expect(mocks.query).not.toHaveBeenCalled()
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem(KIT_QUERY_KEY)).toBe(stored)
    current = true
    mocks.query.mockResolvedValueOnce({ status: 'not_found', data: null })
    await act(async () => { await hook.retry() })
    expect(mocks.query).toHaveBeenCalledTimes(1)
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem(KIT_QUERY_KEY)).toBe(stored)
    mocks.query.mockResolvedValueOnce({ status: 'success', resourceType: 'sale_order', resourceId: 80, data: { id: 80 } })
    let answer: Awaited<ReturnType<Control['queryOriginal']>> = null
    await act(async () => { answer = await hook.queryOriginal() })
    expect(answer).toMatchObject({ queryOnly: true, data: { id: 80 } })
    expect(hook.canApply(answer!)).toBe(false)
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  }, 'original', () => current)
})

test('a completed answer stops applying immediately when its live page guard changes', async () => {
  let current = true
  mocks.execute.mockResolvedValueOnce({ id: 80 })
  await mounted(async () => {
    let answer: Awaited<ReturnType<Control['submit']>> = null
    await act(async () => { answer = await hook.submit(body, identity) })
    expect(hook.canApply(answer!)).toBe(true)
    current = false
    expect(hook.canApply(answer!)).toBe(false)
  }, 'original', () => current)
})

test('an in-flight operation uses the latest guard callback after the mounted component rerenders', async () => {
  let complete!: (value: Result) => void
  mocks.execute.mockImplementationOnce(() => new Promise<Result>(resolve => { complete = resolve }))
  const root = createRoot(document.createElement('div'))
  try {
    await act(async () => root.render(<Probe isCurrent={() => true} />))
    let pending!: Promise<unknown>
    act(() => { pending = hook.submit(body, identity) })
    const stored = sessionStorage.getItem(KIT_QUERY_KEY)!
    await act(async () => root.render(<Probe isCurrent={() => false} />))
    await act(async () => { complete({ id: 80 }); await pending })
    expect(hook.pending).toBeTruthy()
    expect(hook.pendingPayload).toEqual(body)
    expect(sessionStorage.getItem(KIT_QUERY_KEY)).toBe(stored)
  } finally { act(() => root.unmount()) }
})

test('guard changes during query-identity persistence prevent execute from sending a new POST', async () => {
  let current = true
  mocks.execute.mockResolvedValue({ id: 80 })
  await mounted(async () => {
    const original = Storage.prototype.setItem
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      original.call(this, key, value)
      if (key === KIT_QUERY_KEY && JSON.parse(value).records.length) current = false
    })
    try {
      await act(async () => { await hook.submit(body, identity) })
      expect(mocks.execute).not.toHaveBeenCalled()
      expect(hook.pending).toBeTruthy()
      expect(hook.pendingPayload).toEqual(body)
      expect(sessionStorage.getItem(KIT_QUERY_KEY)).toContain(hook.pending!.requestKey)
      expect(hook.error).toContain('草稿')
    } finally { spy.mockRestore() }
  }, 'original', () => current)
})


test.each(['server', 'account', 'relogin', 'scope', 'unmount'])('query-only receipt view rejects changed %s ownership', async boundary => {
  await mounted(submitUnknown)
  let current = true
  let receipt: Awaited<ReturnType<Control['queryOriginal']>> = null
  await mounted(async () => {
    mocks.query.mockResolvedValue({ status: 'success', resourceType: 'sale_order', resourceId: 80, data: { id: 80 } })
    await act(async () => { receipt = await hook.queryOriginal() })
    expect(receipt?.queryOnly).toBe(true)
    expect(hook.canView(receipt!)).toBe(true)
    expect(hook.canApply(receipt!)).toBe(false)
    if (boundary === 'server') mocks.defaults.baseURL = '/b'
    if (boundary === 'account') act(() => useAuthStore.getState().login('different', null, { ...useAuthStore.getState().user!, id: 9 }))
    if (boundary === 'relogin') act(() => useAuthStore.getState().login('new-session', null, user))
    if (boundary === 'scope') current = false
    if (boundary !== 'unmount') expect(hook.canView(receipt!)).toBe(false)
  }, 'original', () => current)
  expect(hook.canView(receipt!)).toBe(false)
  expect(mocks.execute).toHaveBeenCalledTimes(1)
})
