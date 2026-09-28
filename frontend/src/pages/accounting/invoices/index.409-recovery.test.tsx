// @vitest-environment jsdom
//
// 发票编辑遇 409 的**恢复行为**（2026-09-28，取证）。见
// docs/finance-permission-time.md 的"待查（需反例证据）"。
//
// 现状（代码事实）：`InvoiceDialog` 提交的 `onError` 在 `INVOICE_CONCURRENT_MODIFIED` 时执行
// `invalidateQueries + onClose()` ⇒ **弹窗直接关闭**。
//
// 断言要点（避免假绿）：`input.value` **不属于** `textContent`，所以**不能**用
// "textContent 不含草稿" 判断弹窗是否关闭或草稿是否被丢。这里改为直接检查：
//   ① 提交载荷里的 `remark` 就是刚填的草稿、`revision` 与打开时同源；
//   ② 编辑 dialog 从 DOM 消失、草稿输入框不再存在；
//   ③ **重新打开同一发票**时备注回到**原值**（证明草稿没有被保留）。
// 这是**临时取证**：修复（保留草稿）实施后，本用例应改写为**保护期望语义**，不留"断言丢稿"的永久绿测试。
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import InvoicesPage from './index'
import { getInvoicesApi, updateInvoiceApi } from '@/api/accounting'

vi.mock('@/api/accounting', () => ({
  getInvoicesApi: vi.fn(),
  createInvoiceApi: vi.fn(),
  updateInvoiceApi: vi.fn(),
  changeInvoiceStatusApi: vi.fn(),
  deleteInvoiceApi: vi.fn(),
}))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => true, permissions: [] }) }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

const invoice = {
  id: 7, invoiceType: 1, invoiceCode: null, invoiceNo: 'INV-1', partyName: '某公司', partyTaxNo: null,
  invoiceDate: '2026-09-28', amountNoTax: 100, taxRate: 0.13, taxAmount: 13, amountWithTax: 113,
  status: 1, revision: 3, sourceNo: null, remark: '原备注', companyId: 1,
}

let host: HTMLDivElement, root: Root, client: QueryClient
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div'); document.body.append(host)
  root = createRoot(host)
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } })
  vi.mocked(getInvoicesApi).mockReset()
  vi.mocked(updateInvoiceApi).mockReset()
  vi.mocked(getInvoicesApi).mockResolvedValue({ list: [invoice], pagination: { page: 1, pageSize: 20, total: 1 } } as never)
})
afterEach(() => { act(() => root.unmount()); client.clear(); host.remove() })

async function mount() {
  await act(async () => {
    root.render(<QueryClientProvider client={client}><InvoicesPage /></QueryClientProvider>)
  })
}
const btnByText = (t: string) => [...document.querySelectorAll('button')].find(b => (b.textContent ?? '').trim() === t) as HTMLButtonElement | undefined
/** 编辑弹窗根（Radix Dialog） */
const dialog = () => document.querySelector('[role="dialog"]')
/** 值为 v 的输入框（`input.value` 不在 textContent 里，必须按 value 定位） */
const inputByValue = (v: string) => [...document.querySelectorAll('input')].find(i => i.value === v) as HTMLInputElement | undefined
function setNativeValue(el: HTMLInputElement, v: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v)
}
async function openEditor() {
  const editBtn = document.querySelector('button[title="编辑"]') as HTMLButtonElement | null
  expect(editBtn, '应找到操作列的「编辑」按钮').toBeTruthy()
  await act(async () => { editBtn!.click() })
}

it('★ 取证：发票编辑遇 409 ⇒ 提交的是草稿载荷，但弹窗关闭、草稿未保留（重开回到原值）', async () => {
  const update = vi.mocked(updateInvoiceApi)
  update.mockRejectedValue(Object.assign(new Error('该发票已被他人修改'), { code: 'INVOICE_CONCURRENT_MODIFIED' }))
  await mount()
  await vi.waitFor(() => expect(document.body.textContent).toContain('INV-1'))

  await openEditor()
  await vi.waitFor(() => expect(dialog()).toBeTruthy())
  await vi.waitFor(() => expect(inputByValue('原备注')).toBeTruthy())
  await act(async () => {
    const el = inputByValue('原备注')!
    setNativeValue(el, '我填了一半的草稿')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(inputByValue('我填了一半的草稿'), '草稿已进入表单').toBeTruthy()

  await act(async () => { btnByText('保存修改')!.click() })
  await vi.waitFor(() => expect(update).toHaveBeenCalled())

  // ① 提交载荷：就是刚填的草稿 + 与打开时同源的 revision
  const [sentId, payload] = update.mock.calls[0] as [number, { remark?: string | null; revision?: number }]
  expect(sentId).toBe(7)
  expect(payload.remark).toBe('我填了一半的草稿')
  expect(payload.revision).toBe(3)

  // ② 弹窗确实消失、草稿输入框不再存在
  await vi.waitFor(() => expect(dialog()).toBeNull())
  expect(inputByValue('我填了一半的草稿')).toBeUndefined()

  // ③ 重新打开同一发票：备注回到**原值** ⇒ 草稿没有被保留
  await act(async () => { await client.invalidateQueries({ queryKey: ['acct-invoices'] }) })
  await vi.waitFor(() => expect(document.body.textContent).toContain('INV-1'))
  await openEditor()
  await vi.waitFor(() => expect(dialog()).toBeTruthy())
  await vi.waitFor(() => expect(inputByValue('原备注')).toBeTruthy())
  expect(inputByValue('我填了一半的草稿')).toBeUndefined()
})
