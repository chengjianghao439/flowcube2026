// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import DepartmentsPage from './index'

const mocks = vi.hoisted(() => ({
  departments: [] as Array<Record<string, unknown>>,
  users: [] as Array<{ id: number; realName: string; isActive: boolean }>,
  canEdit: false,
  canDelete: false,
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('@/hooks/useDepartments', () => ({
  useDepartments: () => ({ data: mocks.departments, isLoading: false, isError: false }),
  useCreateDepartment: () => ({ mutate: mocks.create, isPending: false }),
  useUpdateDepartment: () => ({ mutate: mocks.update, isPending: false }),
  useDeleteDepartment: () => ({ mutate: mocks.remove, isPending: false }),
}))
vi.mock('@/hooks/useUserOptions', () => ({
  useUserOptions: () => ({ options: mocks.users, currentUserId: 1 }),
  userOptionLabel: (u: { realName: string }) => u.realName,
}))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: (code: string) => mocks.canEdit || (mocks.canDelete && code === 'department.delete') }) }))

const baseDepartment = {
  id: 1, name: '采购部', parentId: 0, managerId: 42, managerName: '王主管', managerIsActive: true,
  memberCount: 2, approvalFlowCount: 0, sortOrder: 0, remark: null, createdAt: '2026-09-23T09:00:00.000Z',
}

let root: Root
let host: HTMLDivElement
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  mocks.departments = [{ ...baseDepartment }]
  mocks.users = [{ id: 42, realName: '王主管', isActive: true }]
  mocks.canEdit = false
  mocks.canDelete = false
  mocks.create.mockReset()
  mocks.update.mockReset()
  mocks.remove.mockReset()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

async function render() { await act(async () => root.render(<DepartmentsPage />)) }
async function click(element: Element | null) {
  expect(element).not.toBeNull()
  await act(async () => (element as HTMLElement).click())
}

test('department table displays its saved manager and creation time', async () => {
  await render()
  const cells = [...document.querySelectorAll('tbody tr:first-child td')].map(cell => cell.textContent?.trim())
  expect(cells).toContain('王主管')
  expect(cells.filter(value => value === '—')).toHaveLength(0)
})

test('shows invalid manager, approval references and direct member count', async () => {
  mocks.departments = [{ ...baseDepartment, managerIsActive: false, approvalFlowCount: 2 }]
  await render()
  expect(document.body.textContent).toContain('负责人已禁用')
  expect(document.body.textContent).toContain('2 条审批流引用')
  expect([...document.querySelectorAll('th')].map(th => th.textContent)).toContain('直属成员')
})

test('does not expose a development manager in the list or edit form', async () => {
  mocks.canEdit = true
  mocks.departments = [{ ...baseDepartment, managerName: null, managerIsActive: false, managerIsDevelopment: true }]
  mocks.users = []
  await render()
  expect(document.body.textContent).not.toContain('王主管')
  expect(document.body.textContent).not.toContain('负责人已禁用')
  await click([...document.querySelectorAll('button')].find(button => button.textContent === '编辑') ?? null)
  expect(document.body.textContent).not.toContain('王主管')
  expect(document.body.textContent).not.toContain('负责人已禁用')
  expect(document.body.textContent).toContain('负责人不可用，请更换或清空')
})

test('row action creates a child with parent already selected', async () => {
  mocks.canEdit = true
  await render()
  await click([...document.querySelectorAll('button')].find(button => button.textContent?.includes('新增子部门')) ?? null)
  expect(document.body.textContent).toContain('新增部门')
  expect(document.querySelector('#department-parentId')?.textContent).toContain('采购部')
})

test('expand control exposes state and search results show full paths', async () => {
  mocks.departments = [
    { ...baseDepartment },
    { ...baseDepartment, id: 2, name: '华东采购', parentId: 1, managerId: null, managerName: null },
  ]
  await render()
  const expand = document.querySelector('button[aria-label="收起子部门"]')
  expect(expand?.getAttribute('aria-expanded')).toBe('true')
  await click(expand)
  expect(document.querySelectorAll('tbody tr')).toHaveLength(1)
  expect(expand?.getAttribute('aria-expanded')).toBe('false')
  const input = document.querySelector('input[placeholder="搜索部门名称"]') as HTMLInputElement
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '华东')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await click([...document.querySelectorAll('button')].find(button => button.textContent === '搜索') ?? null)
  expect(document.body.textContent).toContain('采购部 / 华东采购')
  expect(document.querySelector('button[aria-label="搜索时子部门已展开"]')?.getAttribute('aria-expanded')).toBe('true')
  expect(document.querySelector('tbody tr:first-child td:first-child')?.textContent?.match(/采购部/g)).toHaveLength(1)
})

test('form keeps invalid manager visible and rejects it', async () => {
  mocks.canEdit = true
  mocks.departments = [{ ...baseDepartment, managerIsActive: false }]
  mocks.users = [
    { id: 42, realName: '王主管', isActive: false },
    { id: 43, realName: '李主管', isActive: true },
  ]
  await render()
  await click([...document.querySelectorAll('button')].find(button => button.textContent === '编辑') ?? null)
  expect(document.body.textContent).toContain('当前负责人已禁用，请更换')
  const save = [...document.querySelectorAll('button')].find(button => button.textContent === '保存修改')
  await click(save ?? null)
  expect(mocks.update).not.toHaveBeenCalled()
  expect(document.querySelector('#department-managerId-error')?.textContent).toContain('更换')
})

test('blank name shows field error instead of sending create request', async () => {
  mocks.canEdit = true
  await render()
  await click([...document.querySelectorAll('button')].find(button => button.textContent === '新增部门') ?? null)
  await click([...document.querySelectorAll('button')].find(button => button.textContent === '保存') ?? null)
  expect(mocks.create).not.toHaveBeenCalled()
  expect(document.querySelector('#department-name-error')?.textContent).toContain('部门名称')
})

test('a pending create ignores a second save click', async () => {
  mocks.canEdit = true
  await render()
  await click([...document.querySelectorAll('button')].find(button => button.textContent === '新增部门') ?? null)
  const input = document.querySelector('#department-name') as HTMLInputElement
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '新部门')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const save = [...document.querySelectorAll('button')].find(button => button.textContent === '保存')
  await click(save ?? null)
  await click(save ?? null)
  expect(mocks.create).toHaveBeenCalledTimes(1)
  expect(document.body.textContent).toContain('保存中…')
})

test('expand all and collapse all change visible organization rows', async () => {
  mocks.departments = [
    { ...baseDepartment },
    { ...baseDepartment, id: 2, name: '华东采购', parentId: 1, managerId: null, managerName: null },
  ]
  await render()
  await click([...document.querySelectorAll('button')].find(button => button.textContent === '全部收起') ?? null)
  expect(document.querySelectorAll('tbody tr')).toHaveLength(1)
  await click([...document.querySelectorAll('button')].find(button => button.textContent === '全部展开') ?? null)
  expect(document.querySelectorAll('tbody tr')).toHaveLength(2)
})

test('delete confirmation explains flow references and never sends delete', async () => {
  mocks.canDelete = true
  mocks.departments = [{ ...baseDepartment, approvalFlowCount: 2 }]
  await render()
  await click([...document.querySelectorAll('button')].find(button => button.textContent === '删除') ?? null)
  expect(document.body.textContent).toContain('被 2 条审批流引用')
  await click([...document.querySelectorAll('button')].find(button => button.textContent === '知道了') ?? null)
  expect(mocks.remove).not.toHaveBeenCalled()
})
