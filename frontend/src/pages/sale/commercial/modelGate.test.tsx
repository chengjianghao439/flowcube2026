// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, test, vi } from 'vitest'
import SaleFormPage from '../form'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { useAuthStore } from '@/store/authStore'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { PERMISSIONS } from '@/lib/permission-codes'
import type { SaleOrder } from '@/types/sale'
const mocks = vi.hoisted(() => ({ get: vi.fn(), legacy: vi.fn(), defaults: { baseURL: '/a' } }))
vi.mock('@/api/client', async (original) => ({
  ...(await original<typeof import('@/api/client')>()),
  default: { defaults: mocks.defaults }
}))
vi.mock('@/api/sale', async (original) => ({
  ...(await original<typeof import('@/api/sale')>()),
  getSaleDetailApi: mocks.legacy
}))
vi.mock('@/api/sale-commercial', () => ({ getCommercialSaleApi: mocks.get }))
vi.mock('./CommercialSalePage', () => ({
  default: ({ initial }: { initial: SaleOrder }) => <p>商业编辑数据：{initial.customerName}</p>,
  NewCommercialSale: () => <p>新建商业编辑</p>
}))
const foreign = {
  id: 80,
  orderNo: 'FOREIGN-SO80',
  commercialModel: 'kit-v1',
  commercialRevision: 4,
  status: 1,
  customerName: '外国缓存',
  commercialGroups: [],
  items: []
} as unknown as SaleOrder
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear()
  vi.resetAllMocks()
  mocks.defaults.baseURL = '/a'
  mocks.legacy.mockResolvedValue(foreign)
  useWorkspaceStore.setState({
    tabs: [{ key: '/sale/80', path: '/sale/80', title: '销售单 #80', closable: true }],
    activeKey: '/sale/80'
  })
  useAuthStore.setState({
    token: 'test-only',
    sessionGeneration: 10,
    user: {
      id: 5,
      username: 'fixture',
      realName: '测试',
      roleId: 5,
      roleName: '测试',
      permissions: [PERMISSIONS.SALE_ORDER_VIEW]
    }
  })
})
async function mount(
  run: (
    host: HTMLElement,
    finish: (o: SaleOrder) => void,
    renderPath: (path: string) => Promise<void>,
    cache: QueryClient
  ) => Promise<void>,
  ownedCache?: SaleOrder
) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host),
    cache = new QueryClient({ defaultOptions: { queries: { staleTime: 0, retry: false, gcTime: Infinity } } })
  cache.setQueryData(['sale', 80], foreign)
  if (ownedCache) cache.setQueryData(['sale', 'commercial-detail', 80, '/a', 5, 10], ownedCache)
  let finish!: (o: SaleOrder) => void
  mocks.get.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve
    })
  )
  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={cache}>
          <MemoryRouter initialEntries={['/sale/80']}>
            <TabPathContext.Provider value="/sale/80">
              <SaleFormPage />
            </TabPathContext.Provider>
          </MemoryRouter>
        </QueryClientProvider>
      )
      await new Promise((r) => setTimeout(r, 5))
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5))
    })
    await run(
      host,
      finish,
      async (path) => {
        await act(async () => {
          root.render(
            <QueryClientProvider client={cache}>
              <MemoryRouter initialEntries={['/sale/80']}>
                <TabPathContext.Provider value={path}>
                  <SaleFormPage />
                </TabPathContext.Provider>
              </MemoryRouter>
            </QueryClientProvider>
          )
          await new Promise((r) => setTimeout(r, 5))
        })
        await act(async () => {
          await new Promise((r) => setTimeout(r, 5))
        })
      },
      cache
    )
  } finally {
    act(() => root.unmount())
    host.remove()
    cache.clear()
  }
}
test('cached foreign kit is only model classification; no commercial hydration until original fixed source reread', async () => {
  await mount(async (host, finish) => {
    expect(host.textContent).not.toContain('外国缓存')
    expect(host.textContent).toContain('读取原销售单')
    expect(useWorkspaceStore.getState().tabs[0].title).toBe('销售单 #80')
    expect(mocks.get).toHaveBeenCalledWith(80, { baseURL: '/a', userId: 5, sessionGeneration: 10 })
    await act(async () => {
      finish({ ...foreign, customerName: '原来源客户' })
      await new Promise((r) => setTimeout(r, 5))
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5))
    })
    expect(host.textContent).toContain('商业编辑数据：原来源客户')
  })
})
test('late fixed source read after source switch cannot hydrate any commercial draft from foreign cache', async () => {
  await mount(async (host, finish) => {
    mocks.defaults.baseURL = '/b'
    await act(async () => {
      finish({ ...foreign, customerName: '原来源客户' })
      await new Promise((r) => setTimeout(r, 5))
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5))
    })
    expect(host.textContent).not.toContain('商业编辑数据')
    expect(host.textContent).not.toContain('外国缓存')
    expect(host.textContent).toContain('原单读取失败')
  })
})
test('late legacy ordinary result cannot exit an already identified kit gate or alter tab metadata', async () => {
  let finishLegacy!: (o: SaleOrder) => void
  mocks.legacy.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishLegacy = resolve
      })
  )
  await mount(async (host, finish, renderPath) => {
    expect(mocks.get).toHaveBeenCalledWith(80, { baseURL: '/a', userId: 5, sessionGeneration: 10 })
    await act(async () => {
      finishLegacy({ ...foreign, commercialModel: undefined, orderNo: 'FOREIGN-ORDINARY' })
      await new Promise((r) => setTimeout(r, 5))
    })
    expect(host.textContent).toContain('读取原销售单')
    expect(host.textContent).not.toContain('FOREIGN-ORDINARY')
    expect(useWorkspaceStore.getState().tabs[0].title).toBe('销售单 #80')
    await renderPath('/sale/80?focus=progress&taskId=90')
    expect(host.textContent).toContain('读取原销售单')
    expect(host.textContent).not.toContain('FOREIGN-ORDINARY')
    await act(async () => {
      finish({ ...foreign, customerName: '原来源客户' })
      await new Promise((r) => setTimeout(r, 5))
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5))
    })
    expect(host.textContent).toContain('商业编辑数据：原来源客户')
  })
})
test('changing the actual sale resource resets classification while ordinary defaults remain available', async () => {
  await mount(async (host, _finish, renderPath) => {
    expect(mocks.get).toHaveBeenCalledWith(80, { baseURL: '/a', userId: 5, sessionGeneration: 10 })
    mocks.legacy.mockResolvedValue({
      ...foreign,
      id: 81,
      orderNo: 'SO81',
      commercialModel: undefined,
      customerName: '另一普通单'
    })
    await renderPath('/sale/81')
    expect(host.textContent).toContain('SO81')
    expect(host.textContent).toContain('另一普通单')
    expect(host.textContent).not.toContain('读取原销售单')
    expect(mocks.get).not.toHaveBeenCalledWith(81, expect.anything())
  })
})
test('same-owner cached reopen waits for this GET and later background reads never replace the initialized baseline', async () => {
  await mount(
    async (host, finish, _renderPath, cache) => {
      expect(mocks.get).toHaveBeenCalledWith(80, { baseURL: '/a', userId: 5, sessionGeneration: 10 })
      expect(host.textContent).not.toContain('旧缓存客户')
      expect(host.textContent).toContain('读取原销售单')
      await act(async () => {
        finish({ ...foreign, commercialRevision: 5, customerName: '本次最新客户' })
        await new Promise((r) => setTimeout(r, 5))
      })
      await act(async () => {
        await new Promise((r) => setTimeout(r, 5))
      })
      expect(host.textContent).toContain('商业编辑数据：本次最新客户')
      const key = ['sale', 'commercial-detail', 80, '/a', 5, 10]
      mocks.get.mockResolvedValue({ ...foreign, commercialRevision: 6, customerName: '后台更新客户' })
      await act(async () => {
        await cache.invalidateQueries({ queryKey: key, exact: true })
        await new Promise((r) => setTimeout(r, 5))
      })
      expect(mocks.get).toHaveBeenCalledTimes(2)
      expect(cache.getQueryData<SaleOrder>(key)?.commercialRevision).toBe(6)
      expect(host.textContent).toContain('商业编辑数据：本次最新客户')
      expect(host.textContent).not.toContain('后台更新客户')
      mocks.get.mockRejectedValue(new Error('后台读取失败'))
      await act(async () => {
        await cache.invalidateQueries({ queryKey: key, exact: true })
        await new Promise((r) => setTimeout(r, 5))
      })
      expect(host.textContent).toContain('商业编辑数据：本次最新客户')
    },
    { ...foreign, customerName: '旧缓存客户' }
  )
})
test.each([false, true])(
  'another kit resource mounts an independent read and ignores old completion; old initialized=%s',
  async (initialized) => {
    await mount(async (host, finish80, renderPath) => {
      if (initialized) {
        await act(async () => {
          finish80({ ...foreign, customerName: '原套单80' })
          await new Promise((r) => setTimeout(r, 5))
        })
        await act(async () => {
          await new Promise((r) => setTimeout(r, 5))
        })
        expect(host.textContent).toContain('商业编辑数据：原套单80')
      }
      const other = { ...foreign, id: 81, orderNo: 'SO81', customerName: '另一套单81' }
      mocks.legacy.mockResolvedValue(other)
      let finish81!: (data: SaleOrder) => void
      mocks.get.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish81 = resolve
          })
      )
      await renderPath('/sale/81')
      expect(mocks.get).toHaveBeenCalledWith(81, { baseURL: '/a', userId: 5, sessionGeneration: 10 })
      expect(host.textContent).toContain('读取原销售单')
      expect(host.textContent).not.toContain('原套单80')
      if (!initialized) {
        await act(async () => {
          finish80({ ...foreign, customerName: '迟到套单80' })
          await new Promise((r) => setTimeout(r, 5))
        })
        expect(host.textContent).not.toContain('迟到套单80')
        expect(host.textContent).toContain('读取原销售单')
      }
      await act(async () => {
        finish81(other)
        await new Promise((r) => setTimeout(r, 5))
      })
      await act(async () => {
        await new Promise((r) => setTimeout(r, 5))
      })
      expect(host.textContent).toContain('商业编辑数据：另一套单81')
      expect(host.textContent).not.toContain('原套单80')
    })
  }
)
