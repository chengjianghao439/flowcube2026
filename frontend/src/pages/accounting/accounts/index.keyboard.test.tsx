// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import AccountsPage from './index'

const mocks = vi.hoisted(() => ({ mutate: vi.fn(), canManage: false }))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => mocks.canManage }) }))
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

test('新增科目页脚关联原表单，按编码与名称启用保存，取消不提交', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  mocks.canManage = true
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<AccountsPage />))
    const add = [...host.querySelectorAll('button')].find(button => button.textContent?.trim() === '新增一级科目')!
    await act(async () => add.click())
    const form = document.querySelector<HTMLFormElement>('[role="dialog"] form')!
    const body = form.querySelector('.fc-form-dialog-body')!
    const save = form.querySelector<HTMLButtonElement>('.fc-dialog-footer button[type="submit"]')!
    expect(save.form).toBe(form)
    expect(body.nextElementSibling).toBe(save.closest('.fc-dialog-footer'))
    expect(save.disabled).toBe(true)
    const cancel = form.querySelector<HTMLButtonElement>('.fc-dialog-footer button[type="button"]')!
    await act(async () => cancel.click())
    expect(form.isConnected).toBe(false)
    expect(mocks.mutate).not.toHaveBeenCalled()

    await act(async () => add.click())
    const reopened = document.querySelector<HTMLFormElement>('[role="dialog"] form')!
    const code = reopened.querySelector<HTMLInputElement>('input[placeholder="如 1001 / 660101"]')!
    const name = reopened.querySelector<HTMLInputElement>('input[placeholder="如 库存现金"]')!
    const submit = reopened.querySelector<HTMLButtonElement>('.fc-dialog-footer button[type="submit"]')!
    const enter = async (input: HTMLInputElement, value: string) => act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await enter(code, '1009')
    await enter(name, ' ')
    expect(submit.disabled).toBe(true)
    await act(async () => submit.click())
    expect(mocks.mutate).not.toHaveBeenCalled()
    await enter(name, '测试科目')
    expect(submit.disabled).toBe(false)
    await act(async () => submit.click())
    expect(mocks.mutate).toHaveBeenCalledOnce()
    expect(mocks.mutate.mock.calls[0][0]).toMatchObject({ code: '1009', name: '测试科目' })
  } finally {
    await act(async () => root.unmount())
    host.remove()
    mocks.canManage = false
    mocks.mutate.mockClear()
  }
})
