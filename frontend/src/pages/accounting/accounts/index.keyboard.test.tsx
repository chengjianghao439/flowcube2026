// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { getByRole, queryByRole, within } from '@testing-library/dom'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import AccountsPage from './index'

const mocks = vi.hoisted(() => ({ mutate: vi.fn(), canManage: false }))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => mocks.canManage }) }))
vi.mock('@/hooks/useAccounts', () => ({
  useAccountTree: () => ({ isLoading: false, data: [{ id: 1, code: '1002', name: '银行存款', category: 1, balanceDir: 1, auxType: 0, level: 1, isLeaf: 0, isPreset: 1, isActive: 1, children: [{ id: 2, code: '100201', name: '结算户', category: 1, balanceDir: 1, auxType: 0, level: 2, isLeaf: 1, isPreset: 0, isActive: 1, children: [{ id: 3, code: '10020101', name: '跨城备用金', category: 1, balanceDir: 1, auxType: 0, level: 3, isLeaf: 1, isPreset: 0, isActive: 1 }] }] }, { id: 4, code: '1003', name: '其他存款', category: 1, balanceDir: 1, auxType: 0, level: 1, isLeaf: 1, isPreset: 0, isActive: 1 }] }),
  useCreateAccount: () => ({ mutate: mocks.mutate }), useUpdateAccount: () => ({ mutate: mocks.mutate }),
  useDeleteAccount: () => ({ mutate: mocks.mutate }), useToggleAccountStatus: () => ({ mutate: mocks.mutate }),
}))

test('查看权限也能通过可聚焦的展开按钮浏览下级，不获得编辑动作', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<AccountsPage />))
    const expand = host.querySelector<HTMLButtonElement>('button[aria-expanded]')
    expect(expand).not.toBeNull()
    expect(expand!.tabIndex).toBe(0)
    expect(expand!.getAttribute('aria-label')).toContain('1002')
    expand!.focus(); expect(document.activeElement).toBe(expand)
    await act(async () => expand!.click())
    expect(expand!.getAttribute('aria-expanded')).toBe('true')
    expect(host.textContent).toContain('100201')
    expect(host.querySelectorAll('button[aria-expanded]')).toHaveLength(2)
    expect(host.textContent).not.toContain('新增一级科目')
    expect(mocks.mutate).not.toHaveBeenCalled()
  } finally { await act(async () => root.unmount()); host.remove() }
})


test('可管理的科目有常显且指向具体科目的操作按钮', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  mocks.canManage = true
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  try {
    await act(async () => root.render(<AccountsPage />))
    const row = getByRole(host, 'row', { name: /1002.*银行存款/ })
    expect(within(row).getByRole('button', { name: '编辑 1002 银行存款' })).toBeTruthy()
    const menu = within(row).getByRole('button', { name: '更多操作 1002 银行存款' })
    await act(async () => userEvent.click(menu))
    expect(row.querySelector('[aria-haspopup="menu"]')?.getAttribute('aria-label')).toBe('更多操作 1002 银行存款')
    expect(getByRole(document.body, 'menuitem', { name: '新增下级科目 1002 银行存款' })).toBeTruthy()
  } finally {
    mocks.canManage = false
    await act(async () => root.unmount())
    host.remove()
  }
})


test('按科目编码即时检索深层科目，清除时恢复折叠状态', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  const user = userEvent.setup()
  try {
    await act(async () => root.render(<AccountsPage />))
    const search = getByRole(host, 'searchbox', { name: '搜索科目编码或名称' })
    await act(async () => user.type(search, '10020101'))
    expect(getByRole(host, 'row', { name: /10020101.*跨城备用金/ })).toBeTruthy()
    expect(getByRole(host, 'row', { name: /1002.*银行存款/ })).toBeTruthy()
    expect(queryByRole(host, 'row', { name: /其他存款/ })).toBeNull()
    await act(async () => user.clear(search))
    expect(queryByRole(host, 'row', { name: /跨城备用金/ })).toBeNull()
  } finally { await act(async () => root.unmount()); host.remove() }
})

test('层级全部展开后依然可以直接收起祖先科目', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  const user = userEvent.setup()
  try {
    await act(async () => root.render(<AccountsPage />))
    await act(async () => user.click(getByRole(host, 'button', { name: '全部展开' })))
    expect(getByRole(host, 'row', { name: /跨城备用金/ })).toBeTruthy()
    await act(async () => user.click(getByRole(host, 'button', { name: '收起 1002 银行存款' })))
    expect(queryByRole(host, 'row', { name: /跨城备用金/ })).toBeNull()
  } finally { await act(async () => root.unmount()); host.remove() }
})
