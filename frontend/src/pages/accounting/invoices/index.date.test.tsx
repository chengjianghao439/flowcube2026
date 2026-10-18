// @vitest-environment jsdom
// 保留真实页面/DatePicker/hooks/API；mockAxios仅放行合成列表GET与唯一受检PUT，无真实写入。
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import InvoicesPage from './index'

const mockAxios = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), unknown: [] as string[] }))
vi.mock('@/api/client', () => ({ payloadClient: mockAxios }))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => true, permissions: [] }) }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

const dateCases = [
  ['ISO北京午夜', '2026-10-15T16:00:00.000Z', '2026-10-16'],
  ['plain YMD', '2026-10-16', '2026-10-16'],
] as const
let host: HTMLDivElement, root: Root, client: QueryClient, invoiceDate: string
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear(); mockAxios.unknown.length = 0
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) mockAxios[method].mockReset().mockImplementation(async (url: string) => { mockAxios.unknown.push(`${method} ${url}`); throw Error('禁止未列明离线请求') })
  mockAxios.get.mockImplementation(async (url: string) => {
    if (url === '/accounting/invoices?invoiceType=1&page=1&pageSize=20') return { list: [{
      id: 7, invoiceType: 1, invoiceTypeName: '进项', invoiceCode: null, invoiceNo: 'OFFLINE-INV-7', partyName: '仅离线合成供应商', partyTaxNo: null,
      invoiceDate, amountNoTax: 100, taxRate: 0.13, taxAmount: 13, amountWithTax: 113, status: 1, statusName: '待认证', revision: 3,
      sourceType: null, sourceId: null, sourceNo: null, remark: '原合成备注', operatorName: null, createdAt: invoiceDate,
    }], pagination: { page: 1, pageSize: 20, total: 1 } }
    mockAxios.unknown.push(`get ${url}`); throw Error('禁止未列明离线GET')
  })
})
afterEach(() => {
  act(() => root.unmount()); client.clear(); host.remove(); localStorage.clear()
  expect(mockAxios.unknown).toEqual([])
  for (const method of ['post', 'patch', 'delete'] as const) expect(mockAxios[method]).not.toHaveBeenCalled()
})
async function mount(raw: string) {
  invoiceDate = raw
  await act(async () => root.render(<QueryClientProvider client={client}><InvoicesPage /></QueryClientProvider>))
  await vi.waitFor(() => expect(host.textContent).toContain('OFFLINE-INV-7'))
}
async function openEditor() {
  await vi.waitFor(() => expect(host.querySelector<HTMLButtonElement>('button[title="编辑"]')?.disabled).toBe(false))
  await act(async () => host.querySelector<HTMLButtonElement>('button[title="编辑"]')!.click())
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull())
}
function dateInput() {
  const label = [...document.querySelectorAll('label')].find(l => l.textContent === '开票日期 *')!
  return document.getElementById(label.htmlFor) as HTMLInputElement
}

it.each(dateCases)('发票列表%s显示北京日期，金额不变', async (_name, raw, expected) => {
  await mount(raw)
  const row = [...host.querySelectorAll('tr')].find(r => r.textContent?.includes('OFFLINE-INV-7'))!
  expect(row.cells[6].textContent).toBe(expected)
  expect(row.cells[5].textContent).toBe('113.00')
  expect(mockAxios.put).not.toHaveBeenCalled()
})
it.each(dateCases)('编辑%s回填原北京业务日', async (_name, raw, expected) => {
  await mount(raw); await openEditor()
  expect(dateInput().value).toBe(expected)
  expect(invoiceDate).toBe(raw)
  expect(mockAxios.put).not.toHaveBeenCalled()
})
it.each(dateCases)('不改%s日期直接保存，正文保持原业务日及revision/金额', async (_name, raw, expected) => {
  // 只截获这个mock PUT；任何其它写入口仍默认拒绝，绝不调用真实HTTP。
  mockAxios.put.mockImplementation(async (url: string) => {
    if (url === '/accounting/invoices/7') return undefined
    mockAxios.unknown.push(`put ${url}`); throw Error('禁止其它离线PUT')
  })
  await mount(raw); await openEditor()
  const save = [...document.querySelectorAll('button')].find(b => b.textContent === '保存修改')!
  await act(async () => save.click())
  await vi.waitFor(() => expect(mockAxios.put).toHaveBeenCalledTimes(1))
  expect(mockAxios.put.mock.calls[0]).toEqual(['/accounting/invoices/7', {
    invoiceType: 1, invoiceCode: null, invoiceNo: 'OFFLINE-INV-7', partyName: '仅离线合成供应商', partyTaxNo: null,
    amountNoTax: 100, taxRate: 0.13, taxAmount: 13, amountWithTax: 113, invoiceDate: expected, sourceNo: null, remark: '原合成备注', revision: 3,
  }])
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
})
