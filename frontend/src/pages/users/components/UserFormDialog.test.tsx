// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/store/authStore'
import UserFormDialog from './UserFormDialog'
const update = vi.fn()
const create = vi.fn()
vi.mock('@/hooks/useUsers', () => ({
  useCreateUser: () => ({ mutate: create, isPending: false }),
  useUpdateUser: () => ({ mutate: update, isPending: false }),
  useAssignableRoles: () => ({ data: [{ id: 201, code: 'audit_custom', name: '审计自定义角色' }, { id: 2, code: 'warehouse_manager', name: '仓库管理员' }, { id: 7, code: 'smoke_scoped', name: 'Smoke单仓角色' }] }),
}))
vi.mock('@/hooks/useDepartments', () => ({ useDepartmentOptions: () => ({ data: [] }) }))
let root: Root, host: HTMLDivElement
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  useAuthStore.setState({ user: { id: 88, roleId: 1, permissions: [] } as never })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); update.mockReset(); create.mockReset(); Reflect.deleteProperty(window, 'flowcubeDesktop') })

async function typeInto(selector: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(selector)!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function submit() {
  await act(async () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
}
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

test('new user requires an explicit role choice before creation', async () => {
  await act(async () => root.render(<UserFormDialog open onClose={() => {}} />))
  await typeInto('#form-username', 'new_user')
  await typeInto('#form-password', 'secret123')
  await typeInto('#form-realName', '新用户')
  expect([...document.querySelectorAll<HTMLInputElement>('input[name="roleId"]')].some(r => r.checked)).toBe(false)
  await submit()
  expect(create).not.toHaveBeenCalled()
  await act(async () => document.querySelector<HTMLInputElement>('input[name="roleId"][value="2"]')!.click())
  await submit()
  expect(create.mock.calls[0][0]).toMatchObject({ username: 'new_user', realName: '新用户', roleId: 2 })
})

test('blank names are rejected with a field error', async () => {
  await act(async () => root.render(<UserFormDialog open onClose={() => {}} editUser={{ id: 77, username: 'audit', realName: '原姓名', roleId: 2, roleName: '仓库管理员', isActive: true } as never} />))
  await typeInto('#form-realName', '   ')
  await submit()
  expect(update).not.toHaveBeenCalled()
  expect(document.querySelector('#form-realName')?.getAttribute('aria-invalid')).toBe('true')
})

test('desktop user form hides development roles but keeps ordinary custom roles', async () => {
  Object.assign(window, { flowcubeDesktop: {} })
  await act(async () => root.render(<UserFormDialog open onClose={() => {}} />))
  expect(document.querySelector('input[name="roleId"][value="7"]')).toBeNull()
  expect(document.querySelector('input[name="roleId"][value="201"]')).not.toBeNull()
})
