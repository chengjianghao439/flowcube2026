// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, test, vi } from 'vitest'
import CommercialFulfillmentSummary from './CommercialFulfillmentSummary'
import { useAuthStore } from '@/store/authStore'
import { PERMISSIONS } from '@/lib/permission-codes'
import type { FulfillmentDocument } from '@/api/fulfillment'
import type { CommercialGroup } from '@/types/sale-commercial'
const mocks = vi.hoisted(() => ({ get: vi.fn(), command: vi.fn(), defaults: { baseURL: '/a' } }))
vi.mock('@/api/fulfillment', () => ({ getFulfillment: mocks.get, runFulfillmentCommand: mocks.command }))
vi.mock('@/hooks/useActiveWorkspaceTab', () => ({ useActiveWorkspaceTab: () => true }))
vi.mock('@/api/client', () => ({ default: { defaults: mocks.defaults } }))
const owner = { baseURL: '/a', userId: 5, sessionGeneration: 10 }
const data = {
  type: 'sale',
  id: 80,
  canManage: true,
  issues: [
    {
      id: 1,
      document_type: 'sale',
      document_id: 80,
      source: 'auto',
      source_key: 'purchase-delay:11:44',
      title: '关联采购已延期',
      status: 'open',
      version: 1
    }
  ],
  owners: [],
  commitments: [],
  expectedDate: null,
  detectedCount: 1,
  impacts: [],
  delivery: {
    items: [],
    firstDate: null,
    allDate: null,
    commercialGroups: [
      {
        groupId: 8,
        lineKey: 'a',
        kind: 'kit',
        remainingQty: 1,
        readyDate: '2026-10-05',
        readyDateExplanation: '服务端完整组件最晚日期',
        components: []
      },
      {
        groupId: 9,
        lineKey: 'b',
        kind: 'kit',
        remainingQty: 1,
        readyDate: null,
        readyDateExplanation: '分配来源日期未知，齐套日期未知',
        components: []
      }
    ]
  }
} as unknown as FulfillmentDocument
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear()
  vi.resetAllMocks()
  mocks.defaults.baseURL = '/a'
  mocks.get.mockResolvedValue(data)
  mocks.command.mockResolvedValue({})
  useAuthStore.setState({
    token: 'test-only',
    sessionGeneration: 10,
    user: {
      id: 5,
      username: 'fixture',
      realName: '测试',
      roleId: 5,
      roleName: '测试',
      permissions: [PERMISSIONS.PURCHASE_ORDER_VIEW]
    }
  })
})
async function mount(run: (host: HTMLElement, cache: QueryClient) => Promise<void>) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host),
    cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={cache}>
          <CommercialFulfillmentSummary
            id={80}
            owner={owner}
            groups={
              [
                { id: 8, kitName: '套A' },
                { id: 9, kitName: '套B' }
              ] as CommercialGroup[]
            }
          />
        </QueryClientProvider>
      )
      await new Promise((r) => setTimeout(r, 10))
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5))
    })
    await run(host, cache)
  } finally {
    act(() => root.unmount())
    host.remove()
    cache.clear()
  }
}
test('owned panel uses actual saved commercial readyDate and preserves original issue/date actions and purchase links', async () => {
  await mount(async (host) => {
    expect(mocks.get.mock.calls[0]).toEqual(['sale', 80, expect.any(AbortSignal), owner])
    expect(host.textContent).toContain('套A · 还需发 1 · 预计备齐 2026-10-05')
    expect(host.textContent).toContain('套B · 还需发 1 · 备齐日期未知')
    expect(host.textContent).toContain('修改安排')
    expect(host.textContent).toContain('重新检测')
    expect(host.querySelector('a[href="#/purchase/44?focus=fulfillment"]')).toBeTruthy()
    const sync = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === '重新检测')!
    await act(async () => {
      sync.click()
      await new Promise((r) => setTimeout(r, 5))
    })
    expect(mocks.command).toHaveBeenCalledWith('sale', 80, { action: 'sync' }, expect.any(String), owner)
  })
})
test('another endpoint refresh failure hides previous readyDate rather than showing cached promised result', async () => {
  await mount(async (host, cache) => {
    mocks.defaults.baseURL = '/b'
    await act(async () => {
      await cache.invalidateQueries({ queryKey: ['fulfillment'] })
      await new Promise((r) => setTimeout(r, 5))
    })
    expect(host.textContent).toContain('读取来源已变化')
    expect(host.textContent).not.toContain('2026-10-05')
  })
})
test('original issue command late after endpoint/account change cannot invalidate new source cache or report current save', async () => {
  let finish!: (value: object) => void
  mocks.command.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve
    })
  )
  await mount(async (host, cache) => {
    const invalidate = vi.spyOn(cache, 'invalidateQueries')
    const sync = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === '重新检测')!
    await act(async () => {
      sync.click()
      await new Promise((r) => setTimeout(r, 2))
    })
    expect(mocks.command).toHaveBeenCalledWith('sale', 80, { action: 'sync' }, expect.any(String), owner)
    mocks.defaults.baseURL = '/b'
    useAuthStore.setState({ sessionGeneration: 11 })
    await act(async () => {
      finish({})
      await new Promise((r) => setTimeout(r, 5))
    })
    expect(invalidate).not.toHaveBeenCalled()
    expect(host.textContent).toContain('读取来源已变化')
  })
})
