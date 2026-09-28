// @vitest-environment jsdom
//
// 发票编辑遇 409 的**恢复行为**（2026-09-28，取证）。见
// docs/finance-permission-time.md 的"待查（需反例证据）"。
//
// 现状（代码事实）：`InvoiceDialog` 提交的 `onError` 在 `INVOICE_CONCURRENT_MODIFIED` 时执行
// `invalidateQueries + onClose()` ⇒ **弹窗直接关闭**。本测试用真实页面 + 真实 `QueryClient`
// （只 mock 底层 `@/api/accounting`）验证：**409 后弹窗关闭、已填草稿随之消失**。
// ——先取证；是否改为"保留草稿"待 Codex 依此证据判定（避免照搬商品页造成"新版本 + 旧草稿"）。
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
function setNativeValue(el: HTMLInputElement, v: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v)
}
/** 备注输入框：值为给定文本的那个 input */
const remarkInput = (v: string) => [...document.querySelectorAll('input')].find(i => i.value === v) as HTMLInputElement | undefined

it('★ 发票编辑遇 409：弹窗被关闭、草稿随之消失（当前实现）', async () => {
  vi.mocked(updateInvoiceApi).mockRejectedValue(Object.assign(new Error('该发票已被他人修改'), { code: 'INVOICE_CONCURRENT_MODIFIED' }))
  await mount()
  await vi.waitFor(() => expect(document.body.textContent).toContain('INV-1'))

  const editBtn = document.querySelector('button[title="编辑"]') as HTMLButtonElement | null
  expect(editBtn, '应找到操作列的「编辑」按钮').toBeTruthy()
  await act(async () => { editBtn!.click() })

  // 弹窗打开：备注里是原值
  await vi.waitFor(() => expect(remarkInput('原备注')).toBeTruthy())
  await act(async () => {
    const el = remarkInput('原备注')!
    setNativeValue(el, '我填了一半的草稿')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(remarkInput('我填了一半的草稿'), '草稿已进入表单').toBeTruthy()

  const save = btnByText('保存修改')
  expect(save, '应找到「保存修改」').toBeTruthy()
  await act(async () => { save!.click() })
  await vi.waitFor(() => expect(vi.mocked(updateInvoiceApi)).toHaveBeenCalled())

  // 观察到的行为：409 ⇒ 弹窗关闭 ⇒ 草稿在 DOM 中不复存在（未被保留）
  await vi.waitFor(() => expect(document.body.textContent).not.toContain('我填了一半的草稿'))
  expect(document.body.textContent).not.toContain('原备注')
})
