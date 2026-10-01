// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, test, vi } from 'vitest'
import { useCommercialPreview, useCommercialWrite, readCommercialSaleOwned } from './useCommercialSale'
import { useKitBackup } from './useKits'
import { useAuthStore } from '@/store/authStore'
import { PERMISSIONS } from '@/lib/permission-codes'
import type { CommercialBody, CommercialOperation, CommercialPreview } from '@/types/sale-commercial'
const mocks = vi.hoisted(() => ({ execute: vi.fn(), preview: vi.fn(), get: vi.fn(), defaults: { baseURL: '/a' } }))
vi.mock('@/api/client', () => ({ default: { defaults: mocks.defaults } }))
vi.mock('@/api/sale-commercial', () => ({
  executeCommercialSaleApi: mocks.execute,
  previewCommercialSaleApi: mocks.preview,
  getCommercialSaleApi: mocks.get
}))
const owner = { baseURL: '/a', userId: 5, sessionGeneration: 10 }
const body: CommercialBody = {
  commercialModel: 'kit-v1',
  customerId: 1,
  warehouseId: 1,
  commercialGroups: [
    { kind: 'kit', lineKey: 'a', kitVersionId: 19, quantity: 1, priceSource: 'manual', unitPrice: 100 }
  ]
}
const operation: CommercialOperation = { action: 'create', body }
let write: ReturnType<typeof useCommercialWrite>,
  preview: ReturnType<typeof useCommercialPreview>,
  backup: ReturnType<typeof useKitBackup>
function Probe({ input, snapshot = 'draftA' }: { input: CommercialBody | null; snapshot?: string }) {
  write = useCommercialWrite(owner)
  preview = useCommercialPreview(input, owner)
  backup = useKitBackup(snapshot, owner)
  return (
    <p>
      {write.error}
      {preview.error}
    </p>
  )
}
function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (v: unknown) => void
  const promise = new Promise<T>((a, b) => {
    resolve = a
    reject = b
  })
  return { promise, resolve, reject }
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear()
  vi.resetAllMocks()
  mocks.defaults.baseURL = '/a'
  mocks.preview.mockResolvedValue({ amount: 100, commercialGroups: [], physicalItems: [] })
  useAuthStore.setState({
    token: 'fixture-only',
    sessionGeneration: 10,
    user: {
      id: 5,
      username: 'fixture',
      realName: '测试',
      roleId: 5,
      roleName: '测试',
      permissions: [PERMISSIONS.SALE_ORDER_CREATE, PERMISSIONS.SALE_ORDER_UPDATE, PERMISSIONS.SALE_ORDER_SHIP]
    }
  })
})
async function mount(
  run: (render: (body: CommercialBody | null, snapshot?: string) => Promise<void>, cache: QueryClient) => Promise<void>
) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host),
    cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const render = async (input: CommercialBody | null, snapshot?: string) => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={cache}>
          <Probe input={input} snapshot={snapshot} />
        </QueryClientProvider>
      )
      await new Promise((r) => setTimeout(r, 1))
    })
  }
  try {
    await render(body)
    await run(render, cache)
  } finally {
    act(() => root.unmount())
    host.remove()
    cache.clear()
  }
}
test('first408 freezes exact body/key/original ownership; subsequent4xx cannot release uncertainty', async () => {
  mocks.execute
    .mockRejectedValueOnce({ status: 408 })
    .mockRejectedValueOnce({ status: 400 })
    .mockResolvedValueOnce({ id: 80, orderNo: 'SO80' })
  await mount(async () => {
    const draft = structuredClone(operation)
    await act(async () => {
      await write.submit(draft)
    })
    expect(write.pending?.uncertain).toBe(true)
    const first = structuredClone(mocks.execute.mock.calls[0][0])
    draft.body.customerId = 9
    await act(async () => {
      await write.submit(draft)
      await write.retry()
    })
    expect(mocks.execute).toHaveBeenCalledTimes(2)
    expect(write.pending?.uncertain).toBe(true)
    expect(mocks.execute.mock.calls[1][0]).toMatchObject({
      operation: first.operation,
      requestKey: first.requestKey,
      baseURL: '/a',
      userId: 5,
      sessionGeneration: 10
    })
    await act(async () => {
      await write.retry()
    })
    expect(write.pending).toBeNull()
  })
})
test('late success from original endpoint gives original result feedback without new endpoint cache invalidation', async () => {
  const response = deferred<{ id: number }>()
  mocks.execute.mockReturnValue(response.promise)
  await mount(async (_render, cache) => {
    const invalidate = vi.spyOn(cache, 'invalidateQueries')
    let pending!: Promise<unknown>
    act(() => {
      pending = write.submit(operation)
    })
    mocks.defaults.baseURL = '/b'
    await act(async () => {
      response.resolve({ id: 80 })
      expect(await pending).toBeNull()
    })
    expect(invalidate).not.toHaveBeenCalled()
    expect(write.error).toContain('原服务器')
    expect(write.error).toContain('已确认')
  })
})
test('late session response cannot clear original pending or update cache', async () => {
  const response = deferred<{ id: number }>()
  mocks.execute.mockReturnValue(response.promise)
  await mount(async (_render, cache) => {
    const invalidate = vi.spyOn(cache, 'invalidateQueries')
    let pending!: Promise<unknown>
    act(() => {
      pending = write.submit(operation)
    })
    useAuthStore.setState({ sessionGeneration: 11 })
    await act(async () => {
      response.resolve({ id: 80 })
      expect(await pending).toBeNull()
    })
    expect(invalidate).not.toHaveBeenCalled()
  })
})
test('input change immediately invalidates old preview; lateA and failedB never restoreA', async () => {
  const a = deferred<CommercialPreview>(),
    b = deferred<CommercialPreview>()
  mocks.preview.mockReset().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
  await mount(async (render) => {
    await render({ ...body, customerId: 2 })
    expect(preview.data).toBeUndefined()
    expect(preview.loading).toBe(true)
    await act(async () => {
      a.resolve({ amount: 100 } as CommercialPreview)
      await a.promise
    })
    expect(preview.data).toBeUndefined()
    await act(async () => {
      b.reject(new Error('B失败'))
      await b.promise.catch(() => {})
    })
    expect(preview.data).toBeUndefined()
    expect(preview.error).toBe('B失败')
  })
})
test('GET and preview reject late data from another owner', async () => {
  const read = deferred<{ id: number }>()
  mocks.get.mockReturnValue(read.promise)
  const result = readCommercialSaleOwned(80, owner)
  mocks.defaults.baseURL = '/b'
  read.resolve({ id: 80 })
  await expect(result).rejects.toThrow('服务器已切换')
  mocks.defaults.baseURL = '/a'
  const response = deferred<CommercialPreview>()
  mocks.preview.mockReturnValue(response.promise)
  await mount(async () => {
    mocks.defaults.baseURL = '/b'
    await act(async () => {
      response.resolve({ amount: 100 } as CommercialPreview)
      await response.promise
    })
    expect(preview.data).toBeUndefined()
    expect(preview.error).toContain('来源')
  })
})
test('copyA late success cannot authorize overwriteB; manual acknowledgment is exact snapshot', async () => {
  const copy = deferred<void>()
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockReturnValue(copy.promise) }
  })
  await mount(async (render) => {
    let pending!: Promise<void>
    act(() => {
      pending = backup.copy('draft A complete')
    })
    await render(body, 'draftB')
    await act(async () => {
      copy.resolve()
      await pending
    })
    expect(backup.canReload()).toBe(false)
    expect(backup.copied).toBe(false)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }
    })
    await act(async () => {
      await backup.copy('draft B complete')
    })
    expect(backup.text).toBe('draft B complete')
    act(() => backup.acknowledge('draft A complete'))
    expect(backup.canReload()).toBe(false)
    act(() => backup.acknowledge('draft B complete'))
    expect(backup.canReload()).toBe(true)
  })
})
test('two mounted tabs own separate original operations; lateA success cannot finish pendingB', async () => {
  const a = deferred<{ id: number }>(),
    b = deferred<{ id: number }>(),
    controls: Record<string, ReturnType<typeof useCommercialWrite>> = {}
  mocks.execute.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
  function Tab({ name }: { name: string }) {
    controls[name] = useCommercialWrite(owner)
    return (
      <p>
        {name}
        {controls[name].error}
      </p>
    )
  }
  const host = document.createElement('div'),
    root = createRoot(host),
    cache = new QueryClient()
  try {
    act(() =>
      root.render(
        <QueryClientProvider client={cache}>
          <Tab name="A" />
          <Tab name="B" />
        </QueryClientProvider>
      )
    )
    let pa!: Promise<unknown>, pb!: Promise<unknown>
    act(() => {
      pa = controls.A.submit({ action: 'update', id: 80, body: { ...body, expectedRevision: 4 } })
      pb = controls.B.submit({ action: 'update', id: 81, body: { ...body, expectedRevision: 7 } })
    })
    expect(mocks.execute.mock.calls[0][0].requestKey).not.toBe(mocks.execute.mock.calls[1][0].requestKey)
    await act(async () => {
      b.reject({ status: 408 })
      await pb
    })
    expect(controls.B.pending?.operation.id).toBe(81)
    await act(async () => {
      a.resolve({ id: 80 })
      await pa
    })
    expect(controls.B.pending?.operation.id).toBe(81)
    expect(controls.B.pending?.operation.body.expectedRevision).toBe(7)
  } finally {
    act(() => root.unmount())
    host.remove()
    cache.clear()
  }
})
