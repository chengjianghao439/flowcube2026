// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import PermissionsPage from './index'

const fixtures = vi.hoisted(() => ({
  query: { data: undefined as string[] | undefined, isLoading: true, isError: false },
  save: vi.fn(),
}))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }))
vi.mock('@/hooks/usePermissions', () => ({
  useRoles: () => ({ data: [{ id: 2, code: 'warehouse', name: '合成仓管角色', is_system: 0 }] }),
  useRolePermissions: () => fixtures.query,
  useSaveRolePermissions: () => ({ mutate: fixtures.save }),
  useCreateRole: () => ({}), useDeleteRole: () => ({}), useDuplicateRole: () => ({}),
}))

test('加载或失败不能编辑，撤销后重读可编辑，后台变更不能覆盖草稿或直接提交', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const render = () => act(async () => root.render(<PermissionsPage />))
  const button = (name: string) => [...host.querySelectorAll('button')].find(b => b.textContent === name)!
  try {
    await render()
    expect(button('编辑').disabled).toBe(true)
    fixtures.query = { data: [], isLoading: false, isError: true }
    await render()
    expect(button('编辑').disabled).toBe(true)
    fixtures.query = { data: [], isLoading: false, isError: false }
    await render()
    await act(async () => button('编辑').click())
    expect(button('保存修改').disabled).toBe(false)
    fixtures.query = { data: ['sale.order.view'], isLoading: false, isError: false }
    await render()
    expect(button('保存修改').disabled).toBe(true)
    await act(async () => button('保存修改').click())
    expect(fixtures.save).not.toHaveBeenCalled()
    await act(async () => button('取消编辑').click())
    expect(button('编辑').disabled).toBe(false)
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})

test('保存期间继续勾选后，以已保存的权限核对回流数据并保留后续草稿', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement('div')
  const root = createRoot(host)
  const render = () => act(async () => root.render(<PermissionsPage />))
  const button = (name: string) => [...host.querySelectorAll('button')].find(b => b.textContent === name)!
  fixtures.query = { data: [], isLoading: false, isError: false }
  fixtures.save.mockClear()
  try {
    await render()
    await act(async () => button('编辑').click())
    const [first, second] = host.querySelectorAll<HTMLButtonElement>('section button[aria-pressed]')
    await act(async () => first.click())
    await act(async () => button('保存修改').click())
    const [submitted, options] = fixtures.save.mock.calls[0]
    await act(async () => second.click())
    await act(async () => options.onSuccess({}, submitted))
    fixtures.query = { ...fixtures.query, data: submitted.permissions }
    await render()
    expect(host.querySelector('[role="alert"]')).toBeNull()
    expect(button('保存修改').disabled).toBe(false)
    expect(second.getAttribute('aria-pressed')).toBe('true')
    await act(async () => button('保存修改').click())
    expect(fixtures.save.mock.lastCall?.[0].permissions).toHaveLength(2)
  } finally {
    await act(async () => root.unmount())
  }
})
