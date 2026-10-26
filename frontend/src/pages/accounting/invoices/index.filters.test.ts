// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import InvoicesPage from './index'
import { getInvoicesApi, changeInvoiceStatusApi } from '@/api/accounting'
import type { InvoiceQuery } from '@/api/accounting'
import { INVOICE_STATUS_LABELS } from '@/types/accounting'

const access = vi.hoisted(() => ({ manage: true }))
vi.mock('@/api/accounting', () => ({
  getInvoicesApi: vi.fn(), createInvoiceApi: vi.fn(), updateInvoiceApi: vi.fn(),
  changeInvoiceStatusApi: vi.fn(), deleteInvoiceApi: vi.fn(),
}))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => access.manage, permissions: [] }) }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

const rows = [[1, 1], [1, 2], [1, 3], [2, 1], [2, 2]].map(([invoiceType, status], i) => ({
  id: i + 1, invoiceType, invoiceTypeName: invoiceType === 1 ? '进项' : '销项',
  invoiceNo: `FILTER-INV-${i + 1}`, invoiceCode: null, partyName: '仅离线合成单位', partyTaxNo: null,
  amountNoTax: 100, taxRate: .13, taxAmount: 13, amountWithTax: 113, invoiceDate: '2026-10-24',
  status, statusName: INVOICE_STATUS_LABELS[invoiceType][status], sourceType: null, sourceId: null,
  sourceNo: `FILTER-ORDER-${i + 1}`, remark: null, operatorName: null, createdAt: '2026-10-24', revision: 3,
}))
let host: HTMLDivElement, root: Root, client: QueryClient
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  access.manage = true
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.mocked(getInvoicesApi).mockReset().mockImplementation(async (query: InvoiceQuery = {}) => {
    const list = rows.filter(row => (!query.invoiceType || query.invoiceType === row.invoiceType)
      && (!query.status || query.status === row.status)
      && (!query.keyword || [row.invoiceNo, row.partyName, row.sourceNo].some(value => value.includes(query.keyword!))))
    return { list, pagination: { page: 1, pageSize: 20, total: list.length } }
  })
  vi.mocked(changeInvoiceStatusApi).mockReset().mockResolvedValue({ status: 2 })
})
afterEach(() => { act(() => root.unmount()); client.clear(); host.remove() })

async function mount() {
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(InvoicesPage))))
  await vi.waitFor(() => expect(host.textContent).toContain('FILTER-INV-1'))
}
const buttons = (scope: ParentNode = document) => [...scope.querySelectorAll<HTMLButtonElement>('button')]
function button(text: string, scope: ParentNode = document) {
  const found = buttons(scope).find(value => value.textContent?.trim() === text)
  expect(found, `应有按钮：${text}`).toBeTruthy()
  return found!
}
const queryDialog = () => document.querySelector<HTMLElement>('.fc-app-dialog')!
const keywordInput = () => queryDialog().querySelector<HTMLInputElement>('input')!
const lastQuery = () => vi.mocked(getInvoicesApi).mock.calls.at(-1)![0]!
async function click(text: string, scope?: ParentNode) { await act(async () => button(text, scope).click()) }
async function typeKeyword(value: string) {
  await act(async () => {
    const field = keywordInput()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

it('状态页签只透传已有状态字段，固定第一页与页量，切换类型不带入进项特有状态', async () => {
  await mount(); await click('已抵扣')
  await vi.waitFor(() => expect(lastQuery()).toMatchObject({ invoiceType: 1, status: 3, page: 1, pageSize: 20 }))
  await click('销项发票')
  await vi.waitFor(() => expect(lastQuery().invoiceType).toBe(2))
  expect(lastQuery().status).toBeUndefined()
  const filter = host.querySelector('.desktop-status-filter')!
  expect(filter.textContent).toContain('已开具'); expect(filter.textContent).toContain('已红冲')
  expect(filter.textContent).not.toContain('已抵扣')
  expect(Object.keys(lastQuery()).sort()).toEqual(['invoiceType', 'keyword', 'page', 'pageSize', 'status'].sort())
})

it('查询草稿不提前请求，后台重读不覆盖输入，取消重开只回填已应用条件', async () => {
  await mount(); await click('查询'); await typeKeyword('未应用的草稿')
  expect(lastQuery().keyword).toBeUndefined()
  await act(async () => { await client.invalidateQueries({ queryKey: ['acct-invoices'] }) })
  expect(keywordInput().value).toBe('未应用的草稿')
  await click('取消', queryDialog()); await click('查询')
  expect(keywordInput().value).toBe('')
  await typeKeyword('FILTER'); await click('重置', queryDialog())
  expect(keywordInput().value).toBe(''); expect(lastQuery().keyword).toBeUndefined()
})

it('查询应用与 chips 共用状态源，单条清除保留其他条件，全部清空保留发票类型', async () => {
  await mount(); await click('已认证'); await click('查询'); await typeKeyword('FILTER')
  await click('查询', queryDialog())
  await vi.waitFor(() => expect(lastQuery()).toMatchObject({ invoiceType: 1, keyword: 'FILTER', status: 2 }))
  const remove = host.querySelector<HTMLButtonElement>('button[aria-label="移除「状态：已认证」"]')
  expect(remove).toBeTruthy(); await act(async () => remove!.click())
  await vi.waitFor(() => expect(lastQuery().status).toBeUndefined())
  expect(lastQuery().keyword).toBe('FILTER')
  await click('清空')
  await vi.waitFor(() => expect(lastQuery().keyword).toBeUndefined())
  expect(lastQuery().status).toBeUndefined(); expect(lastQuery().invoiceType).toBe(1)
})

it('认证、抵扣与红冲仍调用原 action 与原单 id', async () => {
  await mount(); await click('认证')
  await vi.waitFor(() => expect(changeInvoiceStatusApi).toHaveBeenCalledWith(1, 'certify'))
  await click('抵扣')
  await vi.waitFor(() => expect(changeInvoiceStatusApi).toHaveBeenCalledWith(2, 'deduct'))
  await click('销项发票'); await vi.waitFor(() => expect(host.textContent).toContain('FILTER-INV-4'))
  await click('红冲')
  await vi.waitFor(() => expect(changeInvoiceStatusApi).toHaveBeenCalledWith(4, 'redFlush'))
})

it('只读岗位不因归编获得录入或行操作', async () => {
  access.manage = false; await mount()
  expect(buttons(host).some(value => /录入.*发票|认证|抵扣|红冲|删除|编辑/.test(value.textContent ?? '') && !value.closest('.desktop-status-filter'))).toBe(false)
})
