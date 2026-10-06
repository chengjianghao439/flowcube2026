// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import CustomerFormDialog from './CustomerFormDialog'
import { SETTLEMENT_TYPE } from '@/generated/status'
import type { Customer } from '@/types/customers'

const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toast: { error: mocks.error } }))
vi.mock('@/hooks/useCustomers', () => ({
  useCreateCustomer: () => ({ mutateAsync: mocks.create, isPending: false }),
  useUpdateCustomer: () => ({ mutateAsync: mocks.update, isPending: false }),
}))
const customer: Customer = {
  id: 7, code: 'C-TEST', name: '状态回归客户', settlementType: SETTLEMENT_TYPE.MONTHLY,
  settlementTypeName: '月结', paymentTermsDays: 60, creditLimit: 1200, isActive: true, createdAt: '',
}
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  mocks.create.mockReset().mockResolvedValue({})
  mocks.update.mockReset().mockResolvedValue({})
  mocks.error.mockReset()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
const toggle = () => document.querySelector<HTMLInputElement>('#customer-active')
const submit = async () => act(async () => {
  document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
})

test('编辑启用客户可停用，保留账期和授信配置', async () => {
  const close = vi.fn()
  await act(async () => root.render(<CustomerFormDialog open onClose={close} customer={customer} />))
  expect(toggle(), '编辑表单需要启用状态入口').not.toBeNull()
  expect(toggle()!.checked).toBe(true)
  await act(async () => toggle()!.click())
  await submit()
  expect(mocks.update).toHaveBeenCalledWith({ id: 7, data: expect.objectContaining({
    isActive: false, paymentTermsDays: 60, creditLimit: 1200,
  }) })
  expect(close).toHaveBeenCalledOnce()
})

test('停用客户可重新启用，失败保留编辑值；重新打开恢复服务端状态', async () => {
  const close = vi.fn()
  const inactive = { ...customer, isActive: false }
  mocks.update.mockRejectedValue(new Error('暂不可用'))
  await act(async () => root.render(<CustomerFormDialog open onClose={close} customer={inactive} />))
  expect(toggle()).not.toBeNull()
  expect(toggle()!.checked).toBe(false)
  await act(async () => toggle()!.click())
  await submit()
  expect(mocks.update).toHaveBeenCalledWith({ id: 7, data: expect.objectContaining({ isActive: true }) })
  expect(close).not.toHaveBeenCalled()
  expect(toggle()!.checked).toBe(true)
  await act(async () => root.render(<CustomerFormDialog open={false} onClose={close} customer={inactive} />))
  await act(async () => root.render(<CustomerFormDialog open onClose={close} customer={inactive} />))
  expect(toggle()!.checked).toBe(false)
})

test('新建保持默认启用契约，不提交编辑专用状态字段', async () => {
  await act(async () => root.render(<CustomerFormDialog open onClose={() => {}} />))
  expect(toggle()).toBeNull()
  const input = document.querySelector<HTMLInputElement>('#customer-name')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '新建回归客户')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await submit()
  expect(mocks.create).toHaveBeenCalledOnce()
  expect(mocks.create.mock.calls[0][0]).not.toHaveProperty('isActive')
  expect(mocks.create.mock.calls[0][0].name).toBe('新建回归客户')
})

test('资料边界按Unicode字符计数，座机和长企业资料完整trim后提交', async () => {
  const profile = { name: '𠮷'.repeat(100), contact: '𠮷'.repeat(50), phone: '+86 (010) 1234-5678', address: '𠮷'.repeat(200), remark: '𠮷'.repeat(500) }
  const editing = { ...customer, ...Object.fromEntries(Object.entries(profile).map(([k, v]) => [k, ` ${v} `])) }
  await act(async () => root.render(<CustomerFormDialog open onClose={() => {}} customer={editing} />))
  for (const [field, limit] of Object.entries({ name: 100, contact: 50, phone: 30, address: 200, remark: 500 })) {
    const input = document.querySelector<HTMLInputElement>(`#customer-${field}`)!
    expect(input.hasAttribute('maxlength'), `${field}不能用UTF16原生上限拦截Unicode字符`).toBe(false)
    expect(input.parentElement!.textContent).toContain(`${Array.from(profile[field as keyof typeof profile]).length}/${limit}`)
  }
  await submit()
  expect(mocks.update).toHaveBeenCalledWith({ id: customer.id, data: expect.objectContaining(profile) })
  expect(mocks.error).not.toHaveBeenCalled()
})

test.each([
  ['name', '名'.repeat(101), '客户名称最多 100 个字符'],
  ['name', '  ', '客户名称不能为空'],
  ['contact', '人'.repeat(51), '联系人最多 50 个字符'],
  ['phone', '1'.repeat(31), '电话最多 30 个字符'],
  ['phone', '123x456', '电话仅支持数字、空格、+、(、)、-'],
  ['address', '址'.repeat(201), '地址最多 200 个字符'],
  ['remark', '注'.repeat(501), '备注最多 500 个字符'],
])('非法资料%s保留输入且只提示一次', async (field, value, message) => {
  const close = vi.fn()
  await act(async () => root.render(<CustomerFormDialog open onClose={close} customer={{ ...customer, [field]: value }} />))
  await submit()
  expect(mocks.update).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
  expect(mocks.error).toHaveBeenCalledExactlyOnceWith(message)
  expect(document.querySelector<HTMLInputElement>(`#customer-${field}`)!.value).toBe(value)
})
