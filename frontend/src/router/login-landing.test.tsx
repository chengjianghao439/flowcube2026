// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import AppRouter from './index'
import { KeepAliveOutlet } from '@/components/layout/KeepAliveOutlet'
import { disposeWorkspaceHistoryGuard } from './workspaceHistoryGuard'
import { useAuthStore } from '@/store/authStore'
import { HOME_TAB, useWorkspaceStore } from '@/store/workspaceStore'
import api from '@/api/client'
import type { User } from '@/types'
import { useLogin } from '@/hooks/useAuth'

// 真实登录表单、mutation、认证/工作区store、HashRouter和KeepAlive权限门；
// 仅隔离HTTP、设备连接和落地页内容，权限直接取296认可夹具的after集合。
const boundary = vi.hoisted(() => ({ forbidden: vi.fn(), binding: vi.fn(async () => null), deviceTicket: vi.fn(async () => null) }))
vi.mock('@/components/pda/PdaConnectionGate', () => ({ default: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/components/erp/ErpDesktopConnectionGate', () => ({ default: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/components/desktop/DesktopUpdateBridge', () => ({ DesktopUpdateBridge: () => null }))
vi.mock('@/components/desktop/DesktopQuitUnloadBridge', () => ({ DesktopQuitUnloadBridge: () => null }))
vi.mock('@/components/desktop/DesktopPrintClientBridge', () => ({ default: () => null }))
vi.mock('@/lib/pdaRuntime', () => ({ syncPdaLabelPrinterBinding: boundary.binding }))
vi.mock('@/api/pda-session', () => ({ ensureDeviceSession: boundary.deviceTicket }))
vi.mock('@/layouts/PdaLayout', async () => {
  const { Outlet } = await import('react-router-dom')
  return { default: () => <Outlet /> }
})
vi.mock('@/components/pda/PdaRoutePermission', () => ({ default: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/pages/pda', () => ({ default: () => <h1>仓库作业</h1> }))
vi.mock('@/pages/pda/login', () => ({ default: function PdaLogin() {
  const { mutate } = useLogin('/pda')
  return <button onClick={() => mutate({ username: 'synthetic-pda', password: 'synthetic-password' })}>测试PDA登录</button>
} }))
vi.mock('@/layouts/AppLayout', () => ({ default: function Workspace() {
  const location = useLocation()
  return <><output data-route>{location.pathname}{location.search}</output><KeepAliveOutlet /></>
} }))
vi.mock('@/pages/dashboard', () => ({ default: () => <h1>仪表盘</h1> }))
vi.mock('@/pages/reports/role-workbench', () => ({ default: () => <h1>待办中心</h1> }))
vi.mock('@/pages/sale', () => ({ default: () => <h1>销售订单</h1> }))
vi.mock('@/pages/403', () => ({ default: () => { boundary.forbidden(); return <h1>无访问权限</h1> } }))

const approved = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../tests/fixtures/qa-roles-approved-20261021.json'), 'utf8')) as { roles: { id: number; code: string; name: string; after: string[] }[] }
function userOf(code: string): User {
  const role = approved.roles.find(item => item.code === code)!
  return { id: 9000 + role.id, username: `synthetic-${role.code}`, realName: '合成登录测试', roleId: role.id, roleName: role.name, permissions: [...role.after] }
}
const roles = ['admin', 'preset_finance_specialist', 'sales', 'warehouse', 'viewer', 'preset_warehouse_operator']
let host: HTMLDivElement, root: Root, cache: QueryClient, loginUser: User
let calls: string[]
const originalAdapter = api.defaults.adapter
const previousAuth = useAuthStore.getState()
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear(); sessionStorage.clear()
  useAuthStore.setState({ user: null, token: null, refreshToken: null, isAuthenticated: false })
  useWorkspaceStore.getState().closeAll()
  boundary.forbidden.mockClear(); boundary.binding.mockReset().mockResolvedValue(null)
  boundary.deviceTicket.mockReset().mockResolvedValue(null)
  loginUser = userOf('sales'); calls = []
  api.defaults.adapter = async config => {
    calls.push(`${config.method} ${config.url}`)
    if (config.url !== '/auth/login') throw new Error(`未允许的登录测试端点：${config.url}`)
    return { config, status: 200, statusText: 'OK', headers: {}, data: { success: true, data: { token: 'synthetic-access', refreshToken: null, user: loginUser } } }
  }
  cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount()); cache.clear(); host.remove()
  disposeWorkspaceHistoryGuard(); api.defaults.adapter = originalAdapter
  useAuthStore.setState(previousAuth, true); useWorkspaceStore.getState().closeAll()
  localStorage.clear(); sessionStorage.clear(); window.history.replaceState(null, '', '/')
})
async function renderAt(path: string, from?: string) {
  window.history.replaceState({ idx: 0, usr: from ? { from: { pathname: from } } : null }, '', `/#${path}`)
  await act(async () => root.render(<QueryClientProvider client={cache}><AppRouter /></QueryClientProvider>))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
}
async function submit() {
  await vi.waitFor(() => expect(host.querySelector('form')).not.toBeNull())
  await act(async () => {
    for (const [id, value] of [['username', loginUser.username], ['password', 'synthetic-password']]) {
      const input = host.querySelector<HTMLInputElement>(`#${id}`)!
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
  })
  await act(async () => {
    host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await new Promise(resolve => setTimeout(resolve, 20))
  })
}
async function at(path: string) {
  await vi.waitFor(() => expect(window.location.hash).toBe(`#${path}`))
  expect(boundary.forbidden).not.toHaveBeenCalled()
  expect(host.textContent).not.toContain('无访问权限')
}

test.each(roles)('%s 从待办地址登录按真实权限落地，从未挂载403', async code => {
  loginUser = userOf(code)
  await renderAt('/reports/role-workbench')
  await submit()
  await at(code === 'admin' || code === 'preset_finance_specialist' ? '/reports/role-workbench' : '/dashboard')
  expect(calls).toEqual(['post /auth/login'])
})

test.each(roles)('%s 无来源登录安全落地，财务默认仍进入待办中心', async code => {
  loginUser = userOf(code)
  await renderAt('/login'); await submit()
  await at(code === 'admin' || code === 'preset_finance_specialist' ? '/reports/role-workbench' : '/dashboard')
})

test('已登录游客守卫也拒绝无权的历史来源', async () => {
  useAuthStore.getState().login('synthetic', null, userOf('sales'))
  await renderAt('/login', '/reports/role-workbench')
  await at('/dashboard')
})

test('登录回调等待设备同步期间，游客守卫不先跳进403', async () => {
  let release!: () => void
  boundary.binding.mockImplementation(() => new Promise<null>(resolve => { release = () => resolve(null) }))
  await renderAt('/reports/role-workbench'); await submit()
  await at('/dashboard')
  await act(async () => release())
  await at('/dashboard')
})

test('同机管理员旧标签经persist恢复后换业务员，清空缓存且不落403', async () => {
  useAuthStore.getState().login('synthetic-admin', null, userOf('admin'))
  useWorkspaceStore.getState().syncFromLocation('/reports/role-workbench')
  useWorkspaceStore.getState().syncFromLocation('/accounting/vouchers')
  const saved = localStorage.getItem('flowcube-workspace')!
  useAuthStore.setState({ user: null, token: null, isAuthenticated: false })
  localStorage.setItem('flowcube-workspace', saved)
  await useWorkspaceStore.persist.rehydrate()
  expect(useWorkspaceStore.getState().activeKey).toBe(HOME_TAB.key)
  expect(useWorkspaceStore.getState().tabs.some(tab => tab.path === '/accounting/vouchers')).toBe(true)
  await renderAt('/reports/role-workbench'); await submit(); await at('/dashboard')
  expect(useWorkspaceStore.getState().tabs).toEqual([HOME_TAB])
})

test('有权的来源保留查询条件', async () => {
  await renderAt('/sale?keyword=keep'); await submit(); await at('/sale?keyword=keep')
})

test.each(['/403', '/login', '/missing', '//outside.invalid', 'https://outside.invalid', '/pda'])('无效ERP登录来源%s回仪表盘', async from => {
  await renderAt('/login', from); await submit(); await at('/dashboard')
})

test('登录后主动访问无权页面仍保持403，未放宽页面权限', async () => {
  useAuthStore.getState().login('synthetic', null, userOf('sales'))
  await renderAt('/reports/role-workbench')
  await vi.waitFor(() => expect(window.location.hash).toBe('#/403'))
  await vi.waitFor(() => expect(boundary.forbidden).toHaveBeenCalled())
})

test.each(['/pda/login', '/pda/login/'])('PDA真实路由%s登录继续换设备票据并进入仓库作业', async path => {
  loginUser = userOf('preset_warehouse_operator')
  await renderAt(path)
  await vi.waitFor(() => expect(host.querySelector('button')?.textContent).toBe('测试PDA登录'))
  await act(async () => host.querySelector<HTMLButtonElement>('button')!.click())
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  await at('/pda')
  expect(boundary.deviceTicket).toHaveBeenCalledOnce()
})
