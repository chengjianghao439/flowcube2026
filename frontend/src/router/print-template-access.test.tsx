// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { HashRouter, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { KeepAliveOutlet } from '@/components/layout/KeepAliveOutlet'
import { useAuthStore } from '@/store/authStore'
import { HOME_TAB, useWorkspaceStore } from '@/store/workspaceStore'
import { disposeWorkspaceHistoryGuard } from './workspaceHistoryGuard'
import { PERMISSIONS as P } from '@/lib/permission-codes'
import { resolveRoutePermission } from './routeDefinitions'

// 路由声明、HashRouter、KeepAliveOutlet、权限store及真实模板编辑器均保留；只隔离读取API。
vi.mock('@/api/settings', () => ({ getLogoApi: async () => ({ url: '' }) }))
let host: HTMLDivElement, root: Root, qc: QueryClient
const previousAuth = useAuthStore.getState()
function Harness() {
  const location = useLocation()
  return <><output data-route>{location.pathname}</output><KeepAliveOutlet /></>
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  localStorage.clear(); useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key })
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => { root.unmount(); qc.clear() }); host.remove()
  disposeWorkspaceHistoryGuard(); useAuthStore.setState(previousAuth, true); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})
async function renderWith(permissions: string[], path = '/settings/print-templates/new') {
  useAuthStore.setState({ user: { id: 401, roleId: 81, roleName: '合成只读角色', username: 'template-fixture', realName: '模板测试', permissions } })
  window.history.replaceState({ idx: 0 }, '', `#${path}`)
  await import('@/pages/settings/print-templates/editor')
  await act(async () => root.render(<QueryClientProvider client={qc}><HashRouter><Harness /></HashRouter></QueryClientProvider>))
}
test('只读账号直输模板新建地址被真实路由拒绝，不挂载编辑器', async () => {
  await renderWith([P.PRINT_TEMPLATE_VIEW])
  expect(host.querySelector('[data-route]')?.textContent).toBe('/403')
  expect(host.querySelector('h1')).toBeNull()
  expect(useWorkspaceStore.getState().tabs.some(tab => tab.path.endsWith('/new'))).toBe(false)
})
test('授予打印模板管理权限后直输新建地址可打开真实编辑器', async () => {
  await renderWith([P.PRINT_TEMPLATE_VIEW, P.PRINT_TEMPLATE_MANAGE])
  expect(host.querySelector('[data-route]')?.textContent).toBe('/settings/print-templates/new')
  await vi.waitFor(() => expect(host.querySelector('h1')?.textContent).toBe('新建打印模板'))
  expect([...host.querySelectorAll('button')].some(button => button.textContent === '保存')).toBe(true)
})
test('已有模板和模板列表仍沿查看权限读取', () => {
  expect(resolveRoutePermission('/settings/print-templates/42')).toBe(P.PRINT_TEMPLATE_VIEW)
  expect(resolveRoutePermission('/settings/print-templates')).toBe(P.PRINT_TEMPLATE_VIEW)
})
