// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/store/authStore'
import UserFormDialog from './UserFormDialog'
const update = vi.fn()
vi.mock('@/hooks/useUsers', () => ({
  useCreateUser: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateUser: () => ({ mutate: update, isPending: false }),
  useAssignableRoles: () => ({ data: [{ id: 201, name: '审计自定义角色' }, { id: 2, name: '仓库管理员' }] }),
}))
vi.mock('@/hooks/useDepartments', () => ({ useDepartmentOptions: () => ({ data: [] }) }))
let root: Root, host: HTMLDivElement
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  useAuthStore.setState({ user: { id: 88, roleId: 1, permissions: [] } as never })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); update.mockReset() })
test('dynamic custom roles are rendered and submitted by id', async () => {
  await act(async () => root.render(<UserFormDialog open onClose={() => {}} editUser={{ id: 77, username: 'audit', realName: '测试', roleId: 2, roleName: '仓库管理员', isActive: true } as never} />))
  const radio = document.querySelector<HTMLInputElement>('input[name="roleId"][value="201"]')
  expect(radio).not.toBeNull()
  await act(async () => radio!.click())
  const form = document.querySelector('form')!
  await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(update.mock.calls[0][0].data.roleId).toBe(201)
})
test('ordinary operator cannot edit their own role in the form', async () => {
  useAuthStore.setState({ user: { id: 88, roleId: 201, permissions: ['user.update'] } as never })
  await act(async () => root.render(<UserFormDialog open onClose={() => {}} editUser={{ id: 88, username: 'audit', realName: '测试', roleId: 201, roleName: '审计自定义角色', isActive: true } as never} />))
  const radios = [...document.querySelectorAll<HTMLInputElement>('input[name="roleId"]')]
  expect(radios.length).toBeGreaterThan(0)
  expect(radios.every(r => r.disabled)).toBe(true)
})
