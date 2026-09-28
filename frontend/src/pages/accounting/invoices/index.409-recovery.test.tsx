// @vitest-environment jsdom
//
// 发票编辑遇 409 的**期望行为**（迁移 263 的恢复语义，2026-09-28）。
//
// 期望：
//   ① 409 时**保留弹窗与已填草稿**，内联提示"本次未保存，请先复制再关闭重开核对"，**不自动关闭**；
//   ② 提交用的 `revision` 与**打开时冻结的基线同源** —— 后台列表刷新**不得**换掉编辑基线
//      （否则就是"新版本 + 旧草稿"）；**不自动 merge / 不自动重试**；
//   ③ **手动关闭**后从**最新列表**再开可正常保存；
//   ④ 正常成功、以及**其它错误**都**不得**被误报成版本冲突。
//   ⑤ 特别观察：手动关闭后若**列表刷新仍 pending** 就立刻重开，也不得吃到旧 row/revision。
//
// 用真实 `InvoicesPage` + 真实 `QueryClient`，只 mock 底层 `@/api/accounting`。
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

const baseInvoice = (over: Record<string, unknown> = {}) => ({
  id: 7, invoiceType: 1, invoiceCode: null, invoiceNo: 'INV-1', partyName: '某公司', partyTaxNo: null,
  invoiceDate: '2026-09-28', amountNoTax: 100, taxRate: 0.13, taxAmount: 13, amountWithTax: 113,
  status: 1, revision: 3, sourceNo: null, remark: '原备注', companyId: 1, ...over,
})
const pageOf = (list: unknown[]) => ({ list, pagination: { page: 1, pageSize: 20, total: list.length } })

let host: HTMLDivElement, root: Root, client: QueryClient
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div'); document.body.append(host)
  root = createRoot(host)
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } })
  vi.mocked(getInvoicesApi).mockReset()
  vi.mocked(updateInvoiceApi).mockReset()
  vi.mocked(getInvoicesApi).mockResolvedValue(pageOf([baseInvoice()]) as never)
})
afterEach(() => { act(() => root.unmount()); client.clear(); host.remove() })

async function mount() {
  await act(async () => {
    root.render(<QueryClientProvider client={client}><InvoicesPage /></QueryClientProvider>)
  })
}
const btnByText = (t: string) => [...document.querySelectorAll('button')].find(b => (b.textContent ?? '').trim() === t) as HTMLButtonElement | undefined
const dialog = () => document.querySelector('[role="dialog"]')
const inputByValue = (v: string) => [...document.querySelectorAll('input')].find(i => i.value === v) as HTMLInputElement | undefined
function setNativeValue(el: HTMLInputElement, v: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v)
}
/** 操作列编辑按钮（列表刷新中 title 会变，需一并匹配） */
const editBtn = () => document.querySelector('button[title="编辑"], button[title*="列表刷新中"]') as HTMLButtonElement | null
async function openEditor() {
  const b = editBtn()
  expect(b, '应找到操作列的「编辑」按钮').toBeTruthy()
  await act(async () => { b!.click() })
  await vi.waitFor(() => expect(dialog()).toBeTruthy())
}
/** 改备注为给定值 */
async function typeRemark(from: string, to: string) {
  await vi.waitFor(() => expect(inputByValue(from)).toBeTruthy())
  await act(async () => {
    const el = inputByValue(from)!
    setNativeValue(el, to)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(inputByValue(to)).toBeTruthy()
}

it('★ 409 ⇒ 保留弹窗与草稿，并给出"先复制再关闭重开"的内联提示', async () => {
  vi.mocked(updateInvoiceApi).mockRejectedValue(Object.assign(new Error('该发票已被他人修改'), { code: 'INVOICE_CONCURRENT_MODIFIED' }))
  await mount()
  await vi.waitFor(() => expect(document.body.textContent).toContain('INV-1'))
  await openEditor()
  await typeRemark('原备注', '我填了一半的草稿')

  await act(async () => { btnByText('保存修改')!.click() })
  await vi.waitFor(() => expect(vi.mocked(updateInvoiceApi)).toHaveBeenCalled())
  const [, payload] = vi.mocked(updateInvoiceApi).mock.calls[0] as [number, { remark?: string | null; revision?: number }]
  expect(payload.remark).toBe('我填了一半的草稿')
  expect(payload.revision).toBe(3)

  // 弹窗仍在、草稿仍在、有冲突提示
  await vi.waitFor(() => expect(dialog()).toBeTruthy())
  expect(inputByValue('我填了一半的草稿'), '草稿应保留').toBeTruthy()
  await vi.waitFor(() => expect(document.body.textContent).toMatch(/未保存|复制/))

  // 手动关闭 → 重开：**不得**携带旧冲突提示
  await act(async () => { btnByText('取消')!.click() })
  await vi.waitFor(() => expect(dialog()).toBeNull())
  await openEditor()
  expect(document.body.textContent, '重开后不应显示旧冲突提示').not.toMatch(/该发票已被他人修改/)
  await act(async () => { btnByText('取消')!.click() })
  await vi.waitFor(() => expect(dialog()).toBeNull())

  // 转「录入」：同样**不得**携带旧冲突提示
  await act(async () => { btnByText('录入进项发票')!.click() })
  await vi.waitFor(() => expect(dialog()).toBeTruthy())
  expect(document.body.textContent, '转录入后不应显示旧冲突提示').not.toMatch(/该发票已被他人修改/)
})

it('★（既有正向）后台列表刷新不换编辑基线、不抹草稿：提交仍用打开时的 revision', async () => {
  vi.mocked(updateInvoiceApi).mockRejectedValue(Object.assign(new Error('冲突'), { code: 'INVOICE_CONCURRENT_MODIFIED' }))
  await mount()
  await vi.waitFor(() => expect(document.body.textContent).toContain('INV-1'))
  await openEditor()
  await typeRemark('原备注', '草稿A')

  // 后台刷新：同 id 但 revision 变新。用**发票号**观察，等**真正 DOM 更新**（不是只等调用数/固定 sleep）
  vi.mocked(getInvoicesApi).mockResolvedValue(pageOf([baseInvoice({ revision: 9, remark: '他人改过', invoiceNo: 'INV-9' })]) as never)
  await act(async () => { void client.invalidateQueries({ queryKey: ['acct-invoices'] }) })
  await vi.waitFor(() => expect(document.body.textContent).toContain('INV-9'), { timeout: 3000 })

  // 表单不被后台刷新重置（草稿仍在，且仍是打开时那条）
  expect(inputByValue('草稿A'), '后台刷新不得抹掉草稿').toBeTruthy()

  await act(async () => { btnByText('保存修改')!.click() })
  await vi.waitFor(() => expect(vi.mocked(updateInvoiceApi)).toHaveBeenCalled())
  const [, payload] = vi.mocked(updateInvoiceApi).mock.calls[0] as [number, { revision?: number; remark?: string | null }]
  expect(payload.revision, '提交用打开时的基线 revision（既有正向，非缺陷）').toBe(3)
  expect(payload.remark).toBe('草稿A')
})

it('★ 手动关闭后从最新列表再开：用新 revision 保存成功', async () => {
  vi.mocked(updateInvoiceApi).mockRejectedValueOnce(Object.assign(new Error('冲突'), { code: 'INVOICE_CONCURRENT_MODIFIED' }))
  await mount()
  await vi.waitFor(() => expect(document.body.textContent).toContain('INV-1'))
  await openEditor()
  await typeRemark('原备注', '草稿B')
  await act(async () => { btnByText('保存修改')!.click() })
  await vi.waitFor(() => expect(vi.mocked(updateInvoiceApi)).toHaveBeenCalled())

  // 列表已刷新到最新（revision=9；备注不在列表列，故用发票号观察刷新）
  vi.mocked(getInvoicesApi).mockResolvedValue(pageOf([baseInvoice({ revision: 9, remark: '他人改过', invoiceNo: 'INV-9' })]) as never)
  await act(async () => { await client.invalidateQueries({ queryKey: ['acct-invoices'] }) })
  await vi.waitFor(() => expect(document.body.textContent).toContain('INV-9'))

  // 手动关闭 + 重开（期望行为下弹窗仍在；若实现仍是 409 即关，这里也能继续）
  const cancel = btnByText('取消')
  if (cancel && dialog()) await act(async () => { cancel.click() })
  await vi.waitFor(() => expect(dialog()).toBeNull())
  await openEditor()
  await vi.waitFor(() => expect(inputByValue('他人改过')).toBeTruthy())

  vi.mocked(updateInvoiceApi).mockResolvedValue(undefined as never)
  await act(async () => { btnByText('保存修改')!.click() })
  await vi.waitFor(() => expect(vi.mocked(updateInvoiceApi).mock.calls.length).toBe(2))
  const [, payload2] = vi.mocked(updateInvoiceApi).mock.calls[1] as [number, { revision?: number }]
  expect(payload2.revision, '重开后应使用列表上的最新 revision').toBe(9)
})

it('★ 正常成功与其它错误都不得被误报为版本冲突', async () => {
  vi.mocked(updateInvoiceApi).mockResolvedValue(undefined as never)
  await mount()
  await vi.waitFor(() => expect(document.body.textContent).toContain('INV-1'))
  await openEditor()
  await typeRemark('原备注', '正常保存')
  await act(async () => { btnByText('保存修改')!.click() })
  await vi.waitFor(() => expect(dialog()).toBeNull())   // 成功 ⇒ 关闭
  expect(document.body.textContent).not.toMatch(/未保存|复制/)

  // 其它错误（非冲突）⇒ 不应出现"先复制再关闭重开"的冲突提示
  vi.mocked(updateInvoiceApi).mockRejectedValue(Object.assign(new Error('税率不合法'), { code: 'SOMETHING_ELSE' }))
  await openEditor()
  await typeRemark('原备注', '其它错误')
  await act(async () => { btnByText('保存修改')!.click() })
  await vi.waitFor(() => expect(vi.mocked(updateInvoiceApi).mock.calls.length).toBe(2))
  // 等 mutation **落定**的 UI 信号：按钮从「保存中…」恢复为「保存修改」（不用固定 sleep）
  await vi.waitFor(() => expect(btnByText('保存修改')).toBeTruthy())
  expect(document.body.textContent, '非冲突错误不得显示冲突提示').not.toMatch(/该发票已被他人修改/)
  expect(inputByValue('其它错误'), '非冲突错误时应保留草稿').toBeTruthy()
})

it('★ 列表刷新期间**阻止重新编辑**（等刷新完成后再开，用最新 revision 保存成功）', async () => {
  vi.mocked(updateInvoiceApi).mockRejectedValueOnce(Object.assign(new Error('冲突'), { code: 'INVOICE_CONCURRENT_MODIFIED' }))
  await mount()
  await vi.waitFor(() => expect(document.body.textContent).toContain('INV-1'))
  await openEditor()
  await typeRemark('原备注', '草稿C')
  await act(async () => { btnByText('保存修改')!.click() })
  await vi.waitFor(() => expect(vi.mocked(updateInvoiceApi)).toHaveBeenCalled())

  // 列表重取：**延迟**返回最新（revision=9）
  let release: (v: unknown) => void = () => {}
  vi.mocked(getInvoicesApi).mockImplementation(() => new Promise(res => { release = res as unknown as (v: unknown) => void }))
  await act(async () => { void client.invalidateQueries({ queryKey: ['acct-invoices'] }) })

  // 关掉弹窗（期望行为下 409 后仍开着 ⇒ 手动取消）
  const cancel2 = btnByText('取消')
  if (cancel2 && dialog()) await act(async () => { cancel2.click() })
  await vi.waitFor(() => expect(dialog()).toBeNull())

  // **刷新仍 pending** ⇒ 编辑入口被**明确阻止**（不自动续开到旧 row / 旧 revision）
  expect(editBtn()?.disabled, '列表刷新未完成时应阻止重新编辑').toBe(true)
  // 属性之外再**实际点一次**：不得打开弹窗、也不得发出额外更新请求
  const updateCallsBefore = vi.mocked(updateInvoiceApi).mock.calls.length
  await act(async () => { editBtn()!.click() })
  await act(async () => { await new Promise(r => setTimeout(r, 30)) })
  expect(dialog(), '刷新中点击编辑不应打开弹窗').toBeNull()
  expect(vi.mocked(updateInvoiceApi).mock.calls.length, '不应发出额外更新请求').toBe(updateCallsBefore)

  // 释放最新数据 ⇒ 编辑恢复；重开后拿到**最新** revision 并保存成功
  const latest = pageOf([baseInvoice({ revision: 9, remark: '他人改过', invoiceNo: 'INV-9' })])
  vi.mocked(getInvoicesApi).mockResolvedValue(latest as never)
  await act(async () => { release(latest as never) })
  await vi.waitFor(() => expect(document.body.textContent).toContain('INV-9'))
  expect(editBtn()?.disabled).toBe(false)

  await openEditor()
  await vi.waitFor(() => expect(inputByValue('他人改过')).toBeTruthy())
  vi.mocked(updateInvoiceApi).mockResolvedValue(undefined as never)
  await act(async () => { btnByText('保存修改')!.click() })
  await vi.waitFor(() => expect(vi.mocked(updateInvoiceApi).mock.calls.length).toBe(2))
  const [, payload2] = vi.mocked(updateInvoiceApi).mock.calls[1] as [number, { revision?: number }]
  expect(payload2.revision, '刷新完成后重开 ⇒ 用最新 revision').toBe(9)
})

it('★ 列表刷新**失败**时给出可读错误与**真实重试入口**；点重试恢复后可正常再开', async () => {
  await mount()
  await vi.waitFor(() => expect(document.body.textContent).toContain('INV-1'))
  expect(editBtn()?.disabled).toBe(false)

  // 列表重取失败 ⇒ 出现可读错误 + 重试按钮（表格被错误态替代，故编辑入口随列表消失）
  vi.mocked(getInvoicesApi).mockRejectedValue(new Error('boom'))
  await act(async () => { await client.invalidateQueries({ queryKey: ['acct-invoices'] }) })
  await vi.waitFor(() => expect(document.body.textContent).toContain('发票列表加载失败'))
  const retry = [...document.querySelectorAll('button')].find(b => (b.textContent ?? '').trim() === '重试') as HTMLButtonElement | undefined
  expect(retry, '应有真实的重试入口（员工可执行）').toBeTruthy()
  expect(document.body.textContent).toContain('没能加载数据')

  // **点击重试**（真实员工路径）⇒ 真实 getInvoicesApi 成功 ⇒ 列表与编辑恢复
  vi.mocked(getInvoicesApi).mockResolvedValue(pageOf([baseInvoice({ revision: 9, remark: '他人改过', invoiceNo: 'INV-9' })]) as never)
  await act(async () => { retry!.click() })
  await vi.waitFor(() => expect(document.body.textContent).toContain('INV-9'))
  expect(editBtn()?.disabled).toBe(false)
  await openEditor()
  await vi.waitFor(() => expect(inputByValue('他人改过')).toBeTruthy())
})
