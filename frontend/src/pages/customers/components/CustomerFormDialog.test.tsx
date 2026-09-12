// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import CustomerFormDialog from './CustomerFormDialog'
import { SETTLEMENT_TYPE } from '@/generated/status'
import type { Customer } from '@/types/customers'

const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }))
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
