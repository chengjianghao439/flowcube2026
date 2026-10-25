// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { getByRole } from '@testing-library/dom'
import ApprovalFlowsPage from './flows'
import { APPROVER_TYPE } from '@/types/approval'

const mocks = vi.hoisted(() => ({ flows: [] as unknown[], pending: false, create: vi.fn(), update: vi.fn(), error: vi.fn() }))
vi.mock('@/hooks/useApprovals', () => ({
  useApprovalFlows: () => ({ data: mocks.flows, isSuccess: true }),
  useCreateApprovalFlow: () => ({ mutate: mocks.create, isPending: mocks.pending }),
  useUpdateApprovalFlow: () => ({ mutate: mocks.update, isPending: false }),
  useDeleteApprovalFlow: () => ({ mutate: vi.fn() }),
}))
vi.mock('@/api/settings', () => ({ getRolesApi: async () => [{ id: 2, code: 'reviewer', name: '审计角色' }, { id: 99, code: 'codex_hidden', name: '开发角色' }] }))
vi.mock('@/hooks/useDepartments', () => ({ useDepartments: () => ({ data: [{ id: 3, name: '采购部' }] }) }))
vi.mock('@/hooks/useUsers', () => ({ useUsers: () => ({ data: { list: [{ id: 77, realName: '合成审批人' }] } }) }))
vi.mock('@/lib/toast', () => ({ toast: { error: mocks.error, success: vi.fn() } }))
let host: HTMLDivElement, root: Root, cache: QueryClient
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = vi.fn(); Element.prototype.releasePointerCapture = vi.fn()
  mocks.flows = []; mocks.pending = false; mocks.create.mockReset(); mocks.update.mockReset(); mocks.error.mockReset()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})
afterEach(() => { act(() => root.unmount()); cache.clear(); host.remove() })
async function render() { await act(async () => root.render(<QueryClientProvider client={cache}><ApprovalFlowsPage /></QueryClientProvider>)) }
async function click(name: string) { const user = userEvent.setup(); await act(async () => { await user.click(getByRole(document.body, 'button', { name })) }) }
async function choose(name: RegExp, option: string) {
  const trigger = getByRole(document.body, 'combobox', { name })
  expect(trigger.tagName).toBe('BUTTON')
  const user = userEvent.setup()
  await act(async () => { await user.click(trigger) })
  const item = getByRole(document.body, 'option', { name: option })
  act(() => item.focus())
  await act(async () => { await user.keyboard('{Enter}') })
}

for (const kind of ['role', 'department', 'user'] as const) test(`定制审批选择保持${kind}分支的原提交值与空值口径`, async () => {
  await render(); await click('新增审批流')
  const user = userEvent.setup()
  await act(async () => { await user.type(getByRole(document.body, 'textbox', { name: '流程名称' }), '合成流程') })
  await choose(/^业务类型$/, '费用报销')
  if (kind === 'role') await choose(/级角色$/, '审计角色')
  else {
    await choose(/级审批人类型$/, kind === 'department' ? '部门负责人' : '指定用户')
    if (kind === 'user') await choose(/级用户$/, '合成审批人')
  }
  await click('保存')
  expect(mocks.create).toHaveBeenCalledOnce()
  expect(mocks.create.mock.calls[0][0]).toEqual({
    bizType: 'expense_claim', name: '合成流程', minAmount: 0, maxAmount: null, isActive: true, remark: '',
    steps: [{ stepOrder: 1, approverType: kind === 'role' ? APPROVER_TYPE.ROLE : kind === 'department' ? APPROVER_TYPE.DEPT_MANAGER : APPROVER_TYPE.USER,
      roleId: kind === 'role' ? 2 : null, departmentId: kind === 'department' ? 0 : null, userId: kind === 'user' ? 77 : null }],
  })
})

test('编辑沿原禁止更换业务类型，并保留已配置的隐藏角色', async () => {
  mocks.flows = [{ id: 1, bizType: 'expense_claim', name: '原流程', minAmount: 0, maxAmount: null, isActive: true, stepCount: 1,
    steps: [{ stepOrder: 1, approverType: APPROVER_TYPE.ROLE, roleId: 99, departmentId: null, userId: null }] }]
  await render(); await click('编辑')
  const biz = getByRole(document.body, 'combobox', { name: '业务类型' }) as HTMLButtonElement
  expect(biz.tagName).toBe('BUTTON'); expect(biz.disabled).toBe(true)
  expect(getByRole(document.body, 'combobox', { name: /级角色$/ }).textContent).toContain('当前隐藏角色（保留原设置）')
  await click('保存修改')
  expect(mocks.update.mock.calls[0][0].data.steps[0].roleId).toBe(99)
})

test('原fieldset锁定覆盖所有定制选择入口，不允许处理中的修改', async () => {
  await render(); await click('新增审批流'); mocks.pending = true; await render()
  const fields = document.querySelectorAll<HTMLButtonElement>('[role=dialog] [role=combobox]')
  expect(fields).toHaveLength(3)
  for (const field of fields) {
    expect(field.tagName).toBe('BUTTON'); expect(field.matches(':disabled')).toBe(true)
  }
})


test('已有部门负责人节点的0仍显示申请人所属部门且提交保留0', async () => {
  mocks.flows = [{ id: 1, bizType: 'expense_claim', name: '原部门流程', minAmount: 0, maxAmount: null, isActive: true, stepCount: 1,
    steps: [{ stepOrder: 1, approverType: APPROVER_TYPE.DEPT_MANAGER, roleId: null, departmentId: 0, userId: null }] }]
  await render(); await click('编辑')
  expect(getByRole(document.body, 'combobox', { name: /级部门/ }).textContent).toContain('申请人所属部门')
  await click('保存修改')
  expect(mocks.update.mock.calls[0][0].data.steps[0].departmentId).toBe(0)
})
