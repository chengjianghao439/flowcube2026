// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, test, vi } from 'vitest'
import apiClient, { setApiClientBaseURL } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { HOME_TAB, useWorkspaceStore } from '@/store/workspaceStore'
import { captureReorderOwner } from '@/lib/saleReorder'
import { REPEAT_CREATE_STORAGE, useRepeatSaleCreate } from '@/hooks/useRepeatSaleCreate'
import type { RepeatSaleCreate } from '@/hooks/useRepeatSaleCreate'
import { resolveRoutePermission, isRegisteredErpRoute, buildTopNavSections } from '@/router/routeDefinitions'
import { PERMISSIONS } from '@/lib/permission-codes'
import { KeepAliveOutlet } from '@/components/layout/KeepAliveOutlet'
import { TopNav } from '@/components/layout/TopNav'
const calls: string[] = []
vi.mock('@/lib/toast', () => ({ toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn() } }))
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); sessionStorage.clear(); localStorage.clear(); calls.length = 0
  setApiClientBaseURL('/a'); useAuthStore.getState().login('fixture', null, { id: 9, roleId: 2, permissions: [PERMISSIONS.SALE_ORDER_CREATE] } as never)
  useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key })
  apiClient.defaults.adapter = async config => {
    calls.push(`${config.method} ${config.url}`)
    if (config.method === 'post' && config.url === '/sale') throw Error('网络未知')
    if (config.method === 'get' && config.url?.startsWith('/system/request-status/')) return { data: { success: true, data: { status: 'not_found' } }, status: 200, statusText: 'OK', config, headers: {} }
    throw Error('禁止真实网络和主档/来源读取')
  }
})
async function flush() { await act(async () => { await new Promise(r => setTimeout(r, 5)) }) }
function Route() { const l = useLocation(); return <output data-route>{l.pathname + l.search}</output> }
test('首发未知后撤CREATE并卸载，auth-only恢复能本人查询；无源/主档/表单/POST或retry', async () => {
  const host = document.createElement('div'), root = createRoot(host), cache = new QueryClient(), owner = captureReorderOwner()
  let write: RepeatSaleCreate
  function Sender() { write = useRepeatSaleCreate(80, 'ordinary', owner, '/sale/new?sourceId=80'); return null }
  await act(async () => root.render(<QueryClientProvider client={cache}><Sender /></QueryClientProvider>))
  await act(async () => { await write.submit({ customerId: 4, customerName: '只在原实例的客户', warehouseId: 8, warehouseName: '仓', items: [] }) })
  await act(async () => { root.render(null); useAuthStore.setState({ user: { ...useAuthStore.getState().user!, permissions: [] } }) })
  await import('./RepeatSaleRecoveryPage')
  await act(async () => root.render(<MemoryRouter initialEntries={['/sale/create-recovery']}><QueryClientProvider client={cache}><TopNav /><KeepAliveOutlet /></QueryClientProvider></MemoryRouter>)); await flush()
  try {
    expect(host.textContent).toContain('开单结果核对'); expect(host.querySelector('input')).toBeNull()
    const query = [...host.querySelectorAll('button')].find(b => b.textContent === '查询原创建结果')!
    expect(query.disabled).toBe(false); await act(async () => query.click()); await flush()
    expect(calls.filter(c => c.startsWith('post'))).toHaveLength(1)
    expect(calls.filter(c => c.startsWith('get'))).toHaveLength(1)
    expect([...host.querySelectorAll('button')].find(b => b.textContent === '按原请求重试')?.disabled).toBe(true)
    expect(JSON.parse(sessionStorage.getItem(REPEAT_CREATE_STORAGE)!)).toHaveLength(1)
  } finally { await act(async () => root.unmount()); cache.clear() }
})
test('仅本人当前服务器未决记录露入口，合法改址无需父draw立即隔离；恢复不加入常驻菜单', async () => {
  expect(isRegisteredErpRoute('/sale/create-recovery')).toBe(true)
  expect(resolveRoutePermission('/sale/create-recovery')).toBeUndefined()
  expect(resolveRoutePermission('/sale/new')).toBe(PERMISSIONS.SALE_ORDER_CREATE)
  expect(resolveRoutePermission('/sale/new-kit')).toBe(PERMISSIONS.SALE_ORDER_CREATE)
  sessionStorage.setItem(REPEAT_CREATE_STORAGE, JSON.stringify([{ version: 1, scope: '/sale/new?sourceId=80', sourceId: 80, model: 'ordinary', userId: 9, baseURL: '/a', requestKey: 'original', createdAt: Date.now() }]))
  const { RepeatSaleRecoveryEntry } = await import('./RepeatSaleRecoveryPage')
  const host = document.createElement('div'), root = createRoot(host)
  await act(async () => root.render(<MemoryRouter><Route /><RepeatSaleRecoveryEntry /></MemoryRouter>))
  try {
    expect(host.textContent).toContain('开单结果核对'); await act(async () => setApiClientBaseURL('/b')); expect(host.querySelector('button')).toBeNull()
    await act(async () => setApiClientBaseURL('/a')); expect(host.querySelector('button')).not.toBeNull()
    await act(async () => useAuthStore.setState({ user: { ...useAuthStore.getState().user!, id: 10 } })); expect(host.querySelector('button')).toBeNull()
    expect(buildTopNavSections().some(s => s.kind === 'link' ? s.path === '/sale/create-recovery' : s.children.some(c => c.path === '/sale/create-recovery'))).toBe(false)
    expect(isRegisteredErpRoute('/sale/create-recovery')).toBe(true); expect(resolveRoutePermission('/sale/create-recovery')).toBeUndefined()
    expect(resolveRoutePermission('/sale/new')).toBe(PERMISSIONS.SALE_ORDER_CREATE); expect(resolveRoutePermission('/sale/new-kit')).toBe(PERMISSIONS.SALE_ORDER_CREATE)
  } finally { await act(async () => root.unmount()) }
})

test('撤CREATE且本人记录损坏仍露核对入口，打开前重核错误并保留满30草稿', async () => {
  const { RepeatSaleRecoveryEntry } = await import('./RepeatSaleRecoveryPage')
  useAuthStore.setState(s => ({ user: { ...s.user!, permissions: [] } }))
  sessionStorage.setItem(REPEAT_CREATE_STORAGE, '{invalid')
  const host = document.createElement('div'), root = createRoot(host)
  await act(async () => root.render(<MemoryRouter><Route /><RepeatSaleRecoveryEntry /></MemoryRouter>))
  try {
    expect(host.textContent).toContain('开单结果核对')
    const tabs = Array.from({ length: 30 }, (_, index) => ({ key: `/sale/${index + 1}`, path: `/sale/${index + 1}`, title: '销售单', closable: true }))
    useWorkspaceStore.setState({ tabs, activeKey: tabs[0].key })
    await act(async () => host.querySelector('button')!.click()); expect(useWorkspaceStore.getState().tabs).toEqual(tabs)
    useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key })
    sessionStorage.removeItem(REPEAT_CREATE_STORAGE)
    await act(async () => host.querySelector('button')!.click()); expect(host.querySelector('output')?.textContent).toBe('/')
    sessionStorage.setItem(REPEAT_CREATE_STORAGE, '{invalid')
    await act(async () => host.querySelector('button')!.click()); expect(host.querySelector('output')?.textContent).toBe('/sale/create-recovery')
    expect(calls).toEqual([])
  } finally { await act(async () => root.unmount()) }
})
