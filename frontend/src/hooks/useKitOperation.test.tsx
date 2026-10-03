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
  auth = useAuthStore
}: {
  scope?: string
  use?: typeof useKitOperation
  auth?: typeof useAuthStore
}) {
  hook = use<Body, Result>(
    {
      baseURL: '/a',
      userId: 5,
      sessionGeneration: auth.getState().sessionGeneration
    },
    scope,
    { execute: mocks.execute, validate: (data) => !!data && data.id === 80 }
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
async function mounted(run: () => Promise<void>, scope = 'original') {
  const root = createRoot(document.createElement('div'))
  try {
    await act(async () => root.render(<Probe scope={scope} />))
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
