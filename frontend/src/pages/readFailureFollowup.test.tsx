// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, test, vi } from 'vitest'
import PrintTemplatesPage from './settings/print-templates'
import InvoicesPage from './accounting/invoices'
const f = vi.hoisted(() => ({ templates: vi.fn(), invoices: vi.fn() }))
vi.mock('@/api/print-templates', async original => ({ ...await original<typeof import('@/api/print-templates')>(), getPrintTemplateListApi: f.templates }))
vi.mock('@/api/accounting', async original => ({ ...await original<typeof import('@/api/accounting')>(), getInvoicesApi: f.invoices }))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }))
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); f.templates.mockReset(); f.invoices.mockReset() })
const scenarios = [
  { name: '打印模板', Component: PrintTemplatesPage, query: f.templates, prefix: 'print-templates', empty: [], cached: [{ id: 7, name: '旧缓存模板', type: 'sale_order', createdAt: '2026-10-08' }] },
  { name: '发票', Component: InvoicesPage, query: f.invoices, prefix: 'acct-invoices', empty: { list: [], pagination: { total: 0 } }, cached: { list: [{ id: 7, invoiceType: 1, invoiceNo: '旧缓存模板', partyName: '合成单位', invoiceDate: '2026-10-08', amountNoTax: 10, taxRate: 0, taxAmount: 0, amountWithTax: 10, status: 1 }], pagination: { total: 1 } } },
]
async function page(Component: typeof PrintTemplatesPage, run: (host: HTMLElement, cache: QueryClient) => Promise<void>) {
 const host = document.createElement('div'); document.body.append(host); const root = createRoot(host), cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
 try { await act(async () => root.render(<QueryClientProvider client={cache}><MemoryRouter><Component /></MemoryRouter></QueryClientProvider>)); await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) }); await run(host, cache) }
 finally { await act(async () => root.unmount()); cache.clear(); host.remove() }
}
test.each(scenarios)('$name 首载失败显示原错误，重试恢复空态；不显示零汇总', async s => {
 s.query.mockRejectedValue(new Error('原读取错误'))
 await page(s.Component, async host => {
  await vi.waitFor(() => expect(host.textContent).toContain('原读取错误')); expect(host.textContent).not.toContain('暂无'); expect(host.textContent).not.toMatch(/共\s*0/)
  const retry = [...host.querySelectorAll('button')].find(b => b.textContent === '重试')!; expect(retry).toBeTruthy(); const params = s.query.mock.calls.at(-1)
  s.query.mockResolvedValue(s.empty); await act(async () => retry.click()); await vi.waitFor(() => expect(host.textContent).toContain('暂无')); expect(s.query.mock.calls.at(-1)).toEqual(params)
 })
})
test.each(scenarios)('$name 缓存重取失败隐去旧表和旧汇总', async s => {
 s.query.mockResolvedValue(s.cached)
 await page(s.Component, async (host, cache) => {
  await vi.waitFor(() => expect(host.textContent).toContain('旧缓存模板')); s.query.mockRejectedValue(new Error('缓存读取错误')); await act(async () => { await cache.refetchQueries({ queryKey: [s.prefix] }) })
  await vi.waitFor(() => expect(host.textContent).toContain('缓存读取错误')); expect(host.textContent).not.toContain('旧缓存模板'); expect(host.textContent).not.toMatch(/共\s*[01]/)
 })
})
