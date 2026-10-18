// @vitest-environment jsdom
// The real page, table, Radix menus and dialogs exercise focus and pointer-lock
// cleanup. Lookup/mutation hooks are offline; no account or password is changed.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { getByRole } from '@testing-library/dom'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import UsersPage from './index'

const io = vi.hoisted(() => ({ mutate: vi.fn(), scope: [] }))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => true, roleId: 1 }) }))
vi.mock('@/hooks/useUsers', () => ({
  useUsers: () => ({ data: { list: [{ id: 42, username: 'SYNTHETIC42', realName: '合成用户', roleId: 2, roleName: '合成角色', isActive: true }], pagination: { total: 1 } }, isLoading: false, isError: false }),
  useDeleteUser: () => ({ mutate: io.mutate, isPending: false }),
  useResetPassword: () => ({ mutate: io.mutate, isPending: false }),
}))
vi.mock('./components/UserFormDialog', () => ({ default: () => null }))
vi.mock('@/api/warehouses', () => ({ getWarehousesApi: async () => ({ list: [{ id: 8, name: '合成仓库' }] }) }))
vi.mock('@/hooks/useUserWarehouseScope', () => ({
  useUserWarehouseScope: () => ({ data: io.scope, isLoading: false, isError: false }),
  useSaveUserWarehouseScope: () => ({ mutate: io.mutate, isPending: false }),
}))

let host: HTMLDivElement, root: Root, query: QueryClient
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear(); vi.clearAllMocks()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  query = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  window.HTMLElement.prototype.scrollIntoView = vi.fn()
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); query.clear() })
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 15)) })

test.each([
  { action: '重置密码', title: '重置密码' },
  { action: '仓库访问范围', title: '仓库数据权限 — 合成用户' },
  { action: '删除', title: '确认删除' },
])('$action 从真实行菜单交接后弹窗可访问，取消后回原行并能继续搜索', async ({ action, title }) => {
  await act(async () => root.render(<QueryClientProvider client={query}><UsersPage /></QueryClientProvider>)); await settle()
  const user = userEvent.setup()
  await act(async () => user.click(getByRole(host, 'button', { name: '更多操作' }))); await settle()
  const source = host.querySelector<HTMLButtonElement>('[aria-label="更多操作"]')!
  await act(async () => user.click(getByRole(document.body, 'menuitem', { name: action }))); await settle()
  const dialog = getByRole(document.body, 'dialog', { name: title })
  expect(document.querySelector('[role="menu"][data-state="open"]')).toBeNull()
  expect(dialog.getAttribute('aria-hidden')).not.toBe('true')
  expect(dialog.contains(document.activeElement)).toBe(true)
  if (action === '重置密码') expect(document.activeElement).toBe(dialog.querySelector('#new-password'))
  await act(async () => user.click(getByRole(dialog, 'button', { name: '取消' }))); await settle()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(document.body.style.pointerEvents).not.toBe('none')
  expect(document.activeElement).toBe(source)
  await act(async () => user.click(getByRole(host, 'button', { name: '搜索' }))); await settle()
  expect(io.mutate).not.toHaveBeenCalled()
})
