// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import AccountsPage from './index'

const mocks = vi.hoisted(() => ({ mutate: vi.fn() }))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => false }) }))
vi.mock('@/hooks/useAccounts', () => ({
  useAccountTree: () => ({ isLoading: false, data: [{ id: 1, code: '1002', name: '银行存款', category: 1, balanceDir: 1, auxType: 0, level: 1, isLeaf: 0, isPreset: 1, isActive: 1, children: [{ id: 2, code: '100201', name: '结算户', category: 1, balanceDir: 1, auxType: 0, level: 2, isLeaf: 1, isPreset: 0, isActive: 1, children: [] }] }] }),
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
    expect(host.querySelectorAll('button[aria-expanded]')).toHaveLength(1)
    expect(host.textContent).not.toContain('新增一级科目')
    expect(mocks.mutate).not.toHaveBeenCalled()
  } finally { await act(async () => root.unmount()); host.remove() }
})
