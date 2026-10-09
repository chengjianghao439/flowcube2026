// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, test, vi } from 'vitest'
import { useCommercialWrite } from './useCommercialSale'
import { useAuthStore } from '@/store/authStore'
const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  query: vi.fn(),
  defaults: { baseURL: '/a' }
}))
vi.mock('@/api/client', () => ({ default: { defaults: mocks.defaults } }))
vi.mock('@/api/sale-commercial', () => ({
  executeCommercialSaleApi: mocks.execute
}))
vi.mock('@/api/operation-requests', () => ({
  getOperationRequestStatusApi: mocks.query
}))
let hook: ReturnType<typeof useCommercialWrite>
function Probe({ scope = 'recovery' }: { scope?: string }) {
  hook = useCommercialWrite(
    {
      baseURL: '/a',
      userId: 5,
      sessionGeneration: useAuthStore.getState().sessionGeneration
    },
    scope
  )
  return null
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  sessionStorage.clear()
  vi.resetAllMocks()
  mocks.defaults.baseURL = '/a'
  useAuthStore
    .getState()
    .login('fixture', null, { id: 5, roleId: 1, permissions: ['*'] } as never)
})
async function mount(run: () => Promise<void>) {
  const root = createRoot(document.createElement('div')),
    cache = new QueryClient()
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={cache}>
          <Probe />
        </QueryClientProvider>
      )
    )
    await run()
  } finally {
    act(() => root.unmount())
    cache.clear()
  }
}
test('mounted unknown first queries original action and retries immutable original body/key only after not_found', async () => {
  mocks.execute.mockRejectedValueOnce({ status: 503 }).mockResolvedValue(null)
  mocks.query.mockResolvedValue({ status: 'not_found', data: null })
  await mount(async () => {
    const operation = {
      action: 'cancel' as const,
      id: 80,
      body: { commercialModel: 'kit-v1' as const, expectedRevision: 4 }
    }
    await act(async () => {
      await hook.submit(operation)
    })
    operation.body.expectedRevision = 99
    await act(async () => {
      await hook.retry()
    })
    expect(mocks.query).toHaveBeenCalledWith(
      mocks.execute.mock.calls[0][0].requestKey,
      'sale.cancel.80',
      expect.objectContaining({ baseURL: '/a', _erpApiFallbackTried: true })
    )
    expect(mocks.execute.mock.calls[1][0].operation.body.expectedRevision).toBe(
      4
    )
    expect(mocks.execute.mock.calls[1][0].requestKey).toBe(
      mocks.execute.mock.calls[0][0].requestKey
    )
  })
})
test('foreign resource receipt does not clear unknown or send retry', async () => {
  mocks.execute.mockRejectedValue({ status: 408 })
  mocks.query.mockResolvedValue({
    status: 'success',
    resourceType: 'sale_order',
    resourceId: 81,
    data: null
  })
  await mount(async () => {
    await act(async () => {
      await hook.submit({
        action: 'cancel',
        id: 80,
        body: { commercialModel: 'kit-v1', expectedRevision: 4 }
      })
    })
    await act(async () => {
      await hook.retry()
    })
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(hook.pending).toBeTruthy()
    expect(hook.error).toContain('原操作结果对应的单据不符，请保留记录并核对')
  })
})
test('foreign failed receipt keeps unknown and cannot release it into a new key', async () => {
  mocks.execute.mockRejectedValue({ status: 408 })
  mocks.query.mockResolvedValue({
    status: 'failed',
    resourceType: 'sale_order',
    resourceId: 81,
    data: null,
    message: 'foreign failed'
  })
  await mount(async () => {
    await act(async () => {
      await hook.submit({
        action: 'cancel',
        id: 80,
        body: { commercialModel: 'kit-v1', expectedRevision: 4 }
      })
    })
    await act(async () => {
      await hook.queryOriginal()
    })
    expect(hook.pending).toBeTruthy()
    await act(async () => {
      await hook.submit({
        action: 'cancel',
        id: 80,
        body: { commercialModel: 'kit-v1', expectedRevision: 4 }
      })
    })
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  })
})

test('scope change cannot retry previous mounted body or apply its late result to another draft', async () => {
  let finish!: (value: unknown) => void
  mocks.execute.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const root = createRoot(document.createElement('div')),
    cache = new QueryClient()
  function render(scope: string) {
    root.render(
      <QueryClientProvider client={cache}>
        <Probe scope={scope} />
      </QueryClientProvider>
    )
  }
  try {
    await act(async () => render('A'))
    let promise!: Promise<unknown>
    act(() => {
      promise = hook.submit({
        action: 'cancel',
        id: 80,
        body: { commercialModel: 'kit-v1', expectedRevision: 4 }
      })
    })
    await act(async () => render('B'))
    await act(async () => {
      finish(null)
      await promise
    })
    mocks.query.mockResolvedValue({ status: 'not_found', data: null })
    await act(async () => {
      await hook.retry()
    })
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(mocks.query).not.toHaveBeenCalled()
    expect(hook.pending).toBeTruthy()
  } finally {
    act(() => root.unmount())
    cache.clear()
  }
})
test.each([
  'create',
  'update',
  'adjust',
  'ship',
  'cancel',
  'reserve',
  'release',
  'delete'
] as const)(
  'commercial %s captures real original action/resource for query-first',
  async (action) => {
    mocks.execute.mockRejectedValue({ status: 408 })
    mocks.query.mockResolvedValue({ status: 'not_found', data: null })
    await mount(async () => {
      const operation =
        action === 'create' || action === 'update' || action === 'adjust'
          ? {
              action,
              ...(action === 'create' ? {} : { id: 80 }),
              body: {
                commercialModel: 'kit-v1' as const,
                expectedRevision: 4,
                customerId: 1,
                warehouseId: 1,
                commercialGroups: []
              }
            }
          : {
              action,
              id: 80,
              body: { commercialModel: 'kit-v1' as const, expectedRevision: 4 }
            }
      await act(async () => {
        await hook.submit(operation)
      })
      await act(async () => {
        await hook.queryOriginal()
      })
      expect(mocks.query.mock.calls[0][1]).toBe(
        `sale.${action}${action === 'create' ? '' : '.80'}`
      )
      expect(mocks.execute).toHaveBeenCalledTimes(1)
    })
  }
)

test('ordinary edit unknown result queries and retries the bound legacy action', async () => {
  mocks.execute.mockRejectedValueOnce({status:503}).mockResolvedValue(null)
  mocks.query.mockResolvedValue({status:'not_found',data:null})
  await mount(async () => {
    await act(async () => { await hook.submit({action:'update',id:80,body:{customerId:1,customerName:'C',warehouseId:1,warehouseName:'W',items:[{productId:1,productCode:'P',productName:'P',unit:'个',quantity:1,unitPrice:1}]}}) })
    expect(hook.pending?.action).toBe('sale.update:80')
    await act(async () => { await hook.retry() })
    expect(mocks.query.mock.calls[0][1]).toBe('sale.update:80')
    expect(mocks.execute).toHaveBeenCalledTimes(2)
    expect(mocks.execute.mock.calls[0][0].requestKey).toBe(mocks.execute.mock.calls[1][0].requestKey)
  })
})
