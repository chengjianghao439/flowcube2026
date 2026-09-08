// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import TaxFilingPage from './index'

const calls = vi.hoisted(() => ({ submissions: [] as Array<{ tab: string; onSuccess: () => void }> }))
vi.mock('@/hooks/useActiveWorkspaceTab', () => ({ useActiveWorkspaceTab: () => true }))
vi.mock('@/store/companyStore', () => ({ useCompanyStore: () => ({ companyId: 1 }) }))
vi.mock('@/hooks/useTax', () => ({
  useTaxVat: () => ({}), useTaxIncome: () => ({}), useTaxAdjustments: () => ({ data: [] }),
  useCreateTaxAdjustment: (_c: number, _p: string, tab: string) => ({ mutate: (_d: unknown, callbacks: { onSuccess: () => void }) => calls.submissions.push({ tab, ...callbacks }), isPending: false }),
  useDeleteTaxAdjustment: () => ({ mutate: vi.fn() }),
}))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/exportDownload', () => ({ downloadExport: vi.fn() }))
vi.mock('@/components/shared/DataTable', () => ({ default: () => <div /> }))

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  calls.submissions.length = 0
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  act(() => root.render(<TaxFilingPage />))
})
afterEach(() => { act(() => root.unmount()); host.remove() })
function visible<T extends HTMLElement>(selector: string): T[] { return [...host.querySelectorAll<T>(selector)].filter(e => !e.closest('[hidden]')) }
function click(text: string) { act(() => visible<HTMLButtonElement>('button').find(b => b.textContent === text)!.click()) }
function item() { return visible<HTMLInputElement>('input').find(e => e.placeholder.startsWith('调整项'))! }
function type(value: string) {
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(item(), value); item().dispatchEvent(new Event('input', { bubbles: true })) })
}
test('两税种分别保留调整草稿，来回切换不串值', () => {
  type('增值税草稿'); click('所得税'); expect(item().value).toBe('')
  type('所得税草稿'); click('增值税'); expect(item().value).toBe('增值税草稿')
  click('所得税'); expect(item().value).toBe('所得税草稿')
})
test('提交后切换税种，异步成功只清除提交税种草稿', () => {
  type('增值税提交'); click('添加'); click('所得税'); type('所得税未保存')
  act(() => calls.submissions[0].onSuccess())
  expect(calls.submissions[0].tab).toBe('vat'); expect(item().value).toBe('所得税未保存')
  click('增值税'); expect(item().value).toBe('')
})
test('同税种提交后切走再回来继续编辑，回执保留新草稿', () => {
  type('已提交草稿'); click('添加'); click('所得税'); click('增值税'); type('后来编辑的草稿')
  act(() => calls.submissions[0].onSuccess())
  expect(item().value).toBe('后来编辑的草稿')
})
test('同税种提交后改动再恢复原文也算新版本，不被旧回执清空', () => {
  type('原草稿'); click('添加'); type('中间修改'); type('原草稿')
  act(() => calls.submissions[0].onSuccess())
  expect(item().value).toBe('原草稿')
})
test('只修改金额也保留整份后续草稿', () => {
  type('原草稿'); click('添加')
  const amount = visible<HTMLInputElement>('input').find(e => e.placeholder === '金额')!
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(amount, '99'); amount.dispatchEvent(new Event('input', { bubbles: true })) })
  act(() => calls.submissions[0].onSuccess())
  expect(item().value).toBe('原草稿'); expect(amount.value).toBe('99')
})
