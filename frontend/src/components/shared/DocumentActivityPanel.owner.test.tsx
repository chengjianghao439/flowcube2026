// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { SectionVisibilityContext } from '@/components/layout/SectionVisibilityContext'
import { useAuthStore } from '@/store/authStore'
import { DocumentActivityPanel } from './DocumentActivityPanel'
const mocks = vi.hoisted(() => ({ get: vi.fn(), defaults: { baseURL: '/a' } }))
vi.mock('@/api/document-activity', () => ({ getDocumentActivityApi: mocks.get }))
vi.mock('@/api/client', () => ({ default: { defaults: mocks.defaults } }))
vi.mock('@/hooks/useActiveWorkspaceTab', () => ({ useActiveWorkspaceTab: () => true }))
const owner = { baseURL: '/a', userId: 5, sessionGeneration: 10 }
const records = { status: '草稿', sections: [], events: [{ id: 'event', title: '原单记录', createdAt: '2026-10-09', createdByName: '记录人' }], historyNote: '历史记录提示' }
let host: HTMLDivElement, root: Root, client: QueryClient
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.resetAllMocks(); mocks.defaults.baseURL = '/a'
  mocks.get.mockResolvedValue(records)
  useAuthStore.setState({ token: 'test', user: { id: 5, roleId: 5 } as never, sessionGeneration: 10 })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})
afterEach(() => { act(() => root.unmount()); client.clear(); host.remove() })
async function render(active = true, owned = true) {
  await act(async () => root.render(<QueryClientProvider client={client}><SectionVisibilityContext.Provider value={active}><DocumentActivityPanel type="sale" id={80} view="log" readOwner={owned ? owner : undefined} /></SectionVisibilityContext.Provider></QueryClientProvider>))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
}
test('默认记录入口保留原query身份、完整记录及重新加载', async () => {
  await render(true, false)
  expect(client.getQueryData(['document-activity', 'sale', 80])).toEqual(records)
  expect(host.textContent).toContain('原单记录')
  await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === '刷新')!.click())
  expect(mocks.get).toHaveBeenCalledTimes(2)
  expect(mocks.get.mock.calls.every(call => call[3] === undefined)).toBe(true)
})
test('成套读取固定原账号服务器，隐藏区块暂停，回来沿同一来源读', async () => {
  await render(false)
  expect(mocks.get).not.toHaveBeenCalled()
  await render(true)
  expect(mocks.get.mock.calls[0].slice(0, 2)).toEqual(['sale', 80])
  expect(mocks.get.mock.calls[0][3]).toEqual(owner)
  expect(client.getQueryData(['document-activity', 'sale', 80, '/a', 5, 10])).toEqual(records)
})
test('迟到记录在服务器切换后不作为当前原单记录呈现', async () => {
  let resolve!: (value: typeof records) => void
  mocks.get.mockReturnValue(new Promise(value => { resolve = value }))
  await render()
  mocks.defaults.baseURL = '/b'
  await act(async () => { resolve(records); await new Promise(value => setTimeout(value, 5)) })
  expect(host.textContent).not.toContain('原单记录')
  expect(host.textContent).toContain('读取来源已变化')
})
test('登录状态已变化时不查询旧来源或接受已有记录', async () => {
  useAuthStore.setState({ sessionGeneration: 11 })
  await render()
  expect(mocks.get).not.toHaveBeenCalled()
  expect(host.textContent).toContain('读取来源已变化')
})
