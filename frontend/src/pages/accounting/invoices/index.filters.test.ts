// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import InvoicesPage from './index'
import { getInvoicesApi, createInvoiceApi, changeInvoiceStatusApi, deleteInvoiceApi } from '@/api/accounting'
import type { InvoiceQuery } from '@/api/accounting'
import { PERMISSIONS } from '@/lib/permission-codes'
import { INVOICE_STATUS_LABELS } from '@/types/accounting'

const access = vi.hoisted(() => ({ manage: true }))
vi.mock('@/api/accounting', () => ({
  getInvoicesApi: vi.fn(), createInvoiceApi: vi.fn(), updateInvoiceApi: vi.fn(),
  changeInvoiceStatusApi: vi.fn(), deleteInvoiceApi: vi.fn(),
}))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: (code: string) => code === PERMISSIONS.INVOICE_MANAGE && access.manage, permissions: [] }) }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

const rows = [[1, 1], [1, 2], [1, 3], [2, 1], [2, 2]].map(([invoiceType, status], i) => ({
  id: i + 1, invoiceType, invoiceTypeName: invoiceType === 1 ? '进项' : '销项',
  invoiceNo: `FILTER-INV-${i + 1}`, invoiceCode: null, partyName: '仅离线合成单位', partyTaxNo: null,
  amountNoTax: 100, taxRate: .13, taxAmount: 13, amountWithTax: 113, invoiceDate: '2026-10-24',
  status, statusName: INVOICE_STATUS_LABELS[invoiceType][status], sourceType: i === 3 ? 'sale_order' : null, sourceId: i === 3 ? 40 : null,
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
  vi.mocked(createInvoiceApi).mockReset()
  vi.mocked(deleteInvoiceApi).mockReset().mockResolvedValue(undefined)
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
const invoiceRow = (id: number) => [...host.querySelectorAll('tbody tr')].find(row => row.textContent?.includes(`FILTER-INV-${id}`))!
const deleteDialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!
async function openDelete(id: number) {
  const trigger = invoiceRow(id).querySelector('button[aria-label="更多操作"]')
  expect(trigger).toBeTruthy()
  await act(async () => trigger!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
  const item = await vi.waitFor(() => {
    const found = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(value => value.textContent?.trim() === '删除')
    expect(found?.hasAttribute('data-disabled')).toBe(false)
    return found!
  })
  await act(async () => item.click())
  await vi.waitFor(() => expect(deleteDialog()?.textContent).toContain(`FILTER-INV-${id}`))
}

it('进项已认证只保留抵扣，进项已抵扣和销项已红冲没有行操作', async () => {
  await mount()
  expect(buttons(invoiceRow(2)).filter(value => !value.disabled).map(value => value.textContent)).toEqual(['抵扣'])
  expect(buttons(invoiceRow(3))).toHaveLength(0)
  await click('销项发票')
  await vi.waitFor(() => expect(invoiceRow(5)).toBeTruthy())
  expect(buttons(invoiceRow(5))).toHaveLength(0)
  expect(deleteInvoiceApi).not.toHaveBeenCalled()
})

it.each([[1, '待认证', false], [4, '已开具', true]] as const)('%s 号%s发票取消删除后仍在台账', async (id, statusName, linked) => {
  await mount()
  if (linked) {
    await click('销项发票')
    await vi.waitFor(() => expect(invoiceRow(id)).toBeTruthy())
  }
  await openDelete(id)
  expect(deleteDialog().textContent).toContain(statusName)
  expect(deleteDialog().textContent).toContain('无法恢复')
  expect(deleteDialog().textContent?.includes('关联销售单的已开票金额')).toBe(linked)
  expect(deleteInvoiceApi).not.toHaveBeenCalled()
  await click('取消', deleteDialog())
  expect(deleteDialog()).toBeNull()
  expect(invoiceRow(id)).toBeTruthy()
  expect(deleteInvoiceApi).not.toHaveBeenCalled()
})

it('确认删除合法发票仅提交原发票一次，刷新后移除该行', async () => {
  await mount()
  await openDelete(1)
  const list = rows.slice(1, 3)
  vi.mocked(getInvoicesApi).mockResolvedValueOnce({ list, pagination: { page: 1, pageSize: 20, total: list.length } })
  await click('确认删除', deleteDialog())
  await vi.waitFor(() => expect(invoiceRow(1)).toBeUndefined())
  expect(deleteDialog()).toBeNull()
  expect(deleteInvoiceApi).toHaveBeenCalledExactlyOnceWith(1)
})

it.each([[400, 'INVOICE_DELETE_LOCKED'], [409, 'INVOICE_STATUS_CHANGED'], [404, null]] as const)('删除遇到过期状态 %s / %s 时关闭确认并刷新原列表', async (status, code) => {
  vi.mocked(deleteInvoiceApi).mockRejectedValueOnce(Object.assign(new Error('合成过期发票'), { status, code }))
  await mount()
  await openDelete(1)
  const list = status === 404 ? rows.slice(1, 3) : [{ ...rows[0], status: 2, statusName: '已认证' }, ...rows.slice(1, 3)]
  vi.mocked(getInvoicesApi).mockResolvedValueOnce({ list, pagination: { page: 1, pageSize: 20, total: list.length } })
  const originalQuery = lastQuery()
  const queryCount = vi.mocked(getInvoicesApi).mock.calls.length
  await click('确认删除', deleteDialog())
  await vi.waitFor(() => expect(deleteDialog()).toBeNull())
  expect([...host.querySelectorAll('[role="status"]')].some(value => value.textContent?.includes('请核对刷新后的发票列表'))).toBe(true)
  await vi.waitFor(() => expect(getInvoicesApi).toHaveBeenCalledTimes(queryCount + 1))
  expect(lastQuery()).toEqual(originalQuery)
  expect(deleteInvoiceApi).toHaveBeenCalledExactlyOnceWith(1)
  if (status === 404) await vi.waitFor(() => expect(invoiceRow(1)).toBeUndefined())
  else await vi.waitFor(() => expect(buttons(invoiceRow(1)).filter(value => !value.disabled).map(value => value.textContent)).toEqual(['抵扣']))
})

it('重复进项票被拒绝后，弹窗保留原草稿和可读的核对提示', async () => {
  vi.mocked(createInvoiceApi).mockRejectedValue(Object.assign(new Error('发票已存在'), { code: 'INVOICE_DUP' }))
  await mount()
  await click('录入进项发票')
  const form = document.querySelector('[role="dialog"]')!
  const field = (name: string) => form.querySelector<HTMLInputElement>(`[id$="-${name}"]`)!
  const put = async (name: string, value: string) => {
    await act(async () => {
      const input = field(name)
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  await put('invoiceNo', 'FILTER-INV-1')
  await put('partyName', '仅离线合成单位')
  await put('withTax', '1')
  await click('保存', form)
  await vi.waitFor(() => expect(form.querySelector('[role="alert"]')?.textContent).toContain('请核对原票'))
  expect(field('invoiceNo').value).toBe('FILTER-INV-1')
  expect(field('withTax').value).toBe('1')
})
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
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('FILTER-INV-4')
  expect(changeInvoiceStatusApi).toHaveBeenCalledTimes(2)
  await click('取消', document.querySelector('[role="dialog"]')!)
  expect(changeInvoiceStatusApi).toHaveBeenCalledTimes(2)
  await click('红冲')
  await click('确认红冲', document.querySelector('[role="dialog"]')!)
  await vi.waitFor(() => expect(changeInvoiceStatusApi).toHaveBeenCalledWith(4, 'redFlush'))
  expect(changeInvoiceStatusApi).toHaveBeenCalledTimes(3)
})

it('只读岗位不因归编获得录入或行操作', async () => {
  access.manage = false; await mount()
  expect(buttons(host).some(value => /录入.*发票|认证|抵扣|红冲|删除|编辑/.test(value.textContent ?? '') && !value.closest('.desktop-status-filter'))).toBe(false)
  expect(host.querySelectorAll('tbody button')).toHaveLength(0)
  await click('销项发票')
  await vi.waitFor(() => expect(invoiceRow(4)).toBeTruthy())
  expect(host.querySelectorAll('tbody button')).toHaveLength(0)
  expect(deleteInvoiceApi).not.toHaveBeenCalled()
})
