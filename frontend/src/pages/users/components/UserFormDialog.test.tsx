// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import UserFormDialog from './UserFormDialog'
import type { SysUser } from '@/types/users'

const mocks = vi.hoisted(() => ({
  roleId: 1,
  update: vi.fn(),
  create: vi.fn(),
  updateCurrent: vi.fn(),
}))

vi.mock('@/hooks/useUsers', () => ({
  useCreateUser: () => ({ mutate: mocks.create, isPending: false }),
  useUpdateUser: () => ({ mutate: mocks.update, isPending: false }),
  useAssignableRoles: () => ({ data: [{ id: 2, code: 'staff', name: '员工' }], isLoading: false, isError: false }),
}))
vi.mock('@/hooks/useDepartments', () => ({ useDepartmentOptions: () => ({ data: [], isError: false }) }))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ roleId: mocks.roleId }) }))
vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (state: { user: { id: number }; updateUser: typeof mocks.updateCurrent }) => unknown) =>
    selector({ user: { id: 99 }, updateUser: mocks.updateCurrent }),
}))

const user: SysUser = {
  id: 42, username: 'old_account', realName: '张三', roleId: 2, roleName: '员工', isActive: true,
  allowSelfApprove: false, departmentId: null, departmentName: null, createdAt: '2026-09-23T00:00:00Z',
}

let root: Root
let host: HTMLDivElement
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  mocks.roleId = 1
  mocks.update.mockReset()
  mocks.create.mockReset()
  mocks.updateCurrent.mockReset()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

async function render() { await act(async () => root.render(<UserFormDialog open onClose={() => {}} editUser={user} />)) }

test('superadmin can submit a new login name from the edit dialog', async () => {
  await render()
  const input = document.querySelector('#form-username') as HTMLInputElement
  expect(input).not.toBeNull()
  expect(input.disabled).toBe(false)
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'new_account')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => (document.querySelector('button[type="submit"]') as HTMLButtonElement).click())
  expect(mocks.update).toHaveBeenCalledWith(
    expect.objectContaining({ id: 42, data: expect.objectContaining({ username: 'new_account' }) }),
    expect.any(Object),
  )
})

test('ordinary user editor cannot submit a login name change', async () => {
  mocks.roleId = 2
  await render()
  const input = document.querySelector('#form-username') as HTMLInputElement
  expect(input).not.toBeNull()
  expect(input.disabled || input.readOnly).toBe(true)
  await act(async () => (document.querySelector('button[type="submit"]') as HTMLButtonElement).click())
  expect(mocks.update.mock.calls[0]?.[0]?.data).not.toHaveProperty('username')
})
