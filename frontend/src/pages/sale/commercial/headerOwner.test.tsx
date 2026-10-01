// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, test, vi } from 'vitest'
import { useCustomers } from '@/hooks/useCustomers'
import { useWarehousesActive } from '@/hooks/useWarehouses'
import { useCarriersActive } from '@/hooks/useCarriers'
import { useCustomerAddresses, useUpdateCustomerAddress } from '@/hooks/useCustomerAddresses'
import { useAuthStore } from '@/store/authStore'
import type { KitReadOwner } from '@/api/kits'
const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), defaults: { baseURL: '/a' } }))
vi.mock('@/api/client', () => ({
  default: { defaults: mocks.defaults },
  payloadClient: { get: mocks.get, put: mocks.put }
}))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const owner = { baseURL: '/a', userId: 5, sessionGeneration: 10 }
let queries: Array<{ data: unknown; isError: boolean }>, update: ReturnType<typeof useUpdateCustomerAddress>
function Probe({ readOwner, customerId = 1 }: { readOwner?: KitReadOwner; customerId?: number }) {
  queries = [
    useCustomers({}, false, readOwner),
    useWarehousesActive(readOwner),
    useCarriersActive(readOwner),
    useCustomerAddresses(customerId, true, readOwner)
  ]
  update = useUpdateCustomerAddress(customerId, readOwner)
  return null
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.defaults.baseURL = '/a'
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  useAuthStore.setState({ token: 'fixture', sessionGeneration: 10, user: { id: 5 } as never })
})
async function mount(
  readOwner: KitReadOwner | undefined,
  run: (cache: QueryClient, renderCustomer: (id: number) => Promise<void>) => Promise<void>
) {
  const host = document.createElement('div'),
    root = createRoot(host)
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={cache}>
          <Probe readOwner={readOwner} />
        </QueryClientProvider>
      )
      await new Promise((r) => setTimeout(r, 5))
    })
    await run(cache, async (id) => {
      await act(async () => {
        root.render(
          <QueryClientProvider client={cache}>
            <Probe readOwner={readOwner} customerId={id} />
          </QueryClientProvider>
        )
        await new Promise((r) => setTimeout(r, 5))
      })
    })
  } finally {
    act(() => root.unmount())
    cache.clear()
  }
}
test('ordinary header keeps original cache keys and API config', async () => {
  mocks.get.mockResolvedValue([])
  mocks.put.mockResolvedValue(null)
  await mount(undefined, async (cache) => {
    expect(
      cache
        .getQueryCache()
        .getAll()
        .map((q) => q.queryKey)
    ).toEqual([['customers', {}], ['warehouses', 'active'], ['carriers-active'], ['customer-addresses', 1]])
    expect(mocks.get.mock.calls).toHaveLength(4)
    expect(mocks.get.mock.calls).toEqual(
      expect.arrayContaining([
        ['/customers', { params: {} }],
        ['/warehouses/active'],
        ['/carriers/active'],
        ['/customer-addresses', { params: { customerId: 1 } }]
      ])
    )
    const invalidate = vi.spyOn(cache, 'invalidateQueries')
    await act(async () => {
      await update.mutateAsync({ id: 1, data: { receiverAddress: '普通单地址' } })
    })
    expect(mocks.put).toHaveBeenCalledWith(
      '/customer-addresses/1',
      { receiverAddress: '普通单地址' },
      { skipGlobalError: true }
    )
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['customer-addresses', 1] })
  })
})
test('late address write stays at original endpoint and cannot invalidate another source cache', async () => {
  mocks.get.mockResolvedValue([])
  let finish!: (v: unknown) => void
  mocks.put.mockImplementation(
    () =>
      new Promise((r) => {
        finish = r
      })
  )
  await mount(owner, async (cache) => {
    const invalidate = vi.spyOn(cache, 'invalidateQueries')
    let pending!: Promise<unknown>
    await act(async () => {
      pending = update.mutateAsync({ id: 1, data: { receiverAddress: '原端点地址' } })
      await Promise.resolve()
    })
    expect(mocks.put).toHaveBeenCalledWith(
      '/customer-addresses/1',
      { receiverAddress: '原端点地址' },
      expect.objectContaining({ baseURL: '/a', _erpApiFallbackTried: true })
    )
    mocks.defaults.baseURL = '/b'
    await act(async () => {
      finish(null)
      await expect(pending).rejects.toThrow()
      await new Promise((r) => setTimeout(r, 5))
    })
    expect(invalidate).not.toHaveBeenCalled()
  })
})
test('owned address success invalidates only original customer/source and changed customer rejects the result', async () => {
  mocks.get.mockResolvedValue([])
  mocks.put.mockResolvedValue(null)
  await mount(owner, async (cache, renderCustomer) => {
    const invalidate = vi.spyOn(cache, 'invalidateQueries')
    cache.setQueryDefaults(['customer-addresses', 1, '/b'], { gcTime: Infinity })
    cache.setQueryData(['customer-addresses', 1, '/b', 5, 10], ['另一来源'])
    await act(async () => {
      await update.mutateAsync({ id: 1, data: { receiverAddress: '原客户地址' } })
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['customer-addresses', 1, '/a', 5, 10], exact: true })
    expect(cache.getQueryState(['customer-addresses', 1, '/b', 5, 10])?.isInvalidated).toBe(false)
    invalidate.mockClear()
    let finish!: (v: unknown) => void
    mocks.put.mockImplementation(
      () =>
        new Promise((r) => {
          finish = r
        })
    )
    let pending!: Promise<unknown>
    await act(async () => {
      pending = update.mutateAsync({ id: 1, data: { receiverAddress: '原客户后续地址' } })
      await new Promise((r) => setTimeout(r, 1))
    })
    await renderCustomer(2)
    await act(async () => {
      finish(null)
      await expect(pending).rejects.toThrow('原客户')
    })
    expect(invalidate).not.toHaveBeenCalled()
  })
})
test('owned header ignores foreign cache and rejects late data and address maintenance', async () => {
  const resolvers: Array<(v: unknown) => void> = []
  mocks.get.mockImplementation(() => new Promise((r) => resolvers.push(r)))
  await mount(owner, async (cache) => {
    for (const call of mocks.get.mock.calls)
      expect(call[1]).toMatchObject({ baseURL: '/a', _authSessionGeneration: 10, _erpApiFallbackTried: true })
    expect(
      cache
        .getQueryCache()
        .getAll()
        .every((q) => q.queryKey.includes('/a'))
    ).toBe(true)
    mocks.defaults.baseURL = '/b'
    await act(async () => {
      resolvers.forEach((r) => r([{ id: 1, name: '外国资料' }]))
      await new Promise((r) => setTimeout(r, 5))
    })
    expect(queries.every((q) => q.isError && q.data === undefined)).toBe(true)
    await act(async () => {
      await expect(update.mutateAsync({ id: 1, data: { receiverAddress: '保留原地址' } })).rejects.toThrow()
    })
    expect(mocks.put).not.toHaveBeenCalled()
  })
})
