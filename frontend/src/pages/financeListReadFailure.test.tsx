// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import CustomersPage from './customers'
import FinanceTransactionsPage from './finance/transactions'
import VouchersPage from './accounting/vouchers'
import PaymentsView from './payments/PaymentsView'
import { useAuthStore } from '@/store/authStore'

const fixture = vi.hoisted(() => ({ list: vi.fn(), reconciliation: vi.fn(), voucher: vi.fn(), trace: vi.fn() }))
vi.mock('@/api/customers', async original => ({ ...await original<typeof import('@/api/customers')>(), getCustomersApi: fixture.list }))
vi.mock('@/api/finance', async original => ({ ...await original<typeof import('@/api/finance')>(), getAccountTransactionsApi: fixture.list, getActiveAccountsApi: async () => [], getSupplierRefundTraceApi: fixture.trace }))
vi.mock('@/api/accounting', async original => ({ ...await original<typeof import('@/api/accounting')>(), getVouchersApi: fixture.list, getAccountFlatApi: async () => [], getReconciliationApi: fixture.reconciliation, getVoucherApi: fixture.voucher }))
vi.mock('@/api/payments', async original => ({ ...await original<typeof import('@/api/payments')>(), getPaymentsApi: fixture.list }))

const samples = [
  { path: '/customers', Component: CustomersPage, prefix: 'customers' },
  { path: '/finance/transactions', Component: FinanceTransactionsPage, prefix: 'finance-account-transactions' },
  { path: '/accounting/vouchers', Component: VouchersPage, prefix: 'acct-vouchers' },
  { path: '/payments/receivable', Component: () => <PaymentsView type={2} />, prefix: 'payments' },
  { path: '/payments/payable', Component: () => <PaymentsView type={1} />, prefix: 'payments' },
]
const row = { id: 7, code: 'OLD7', name: '旧缓存单', bizNo: '旧缓存单', voucherNo: '旧缓存单', orderNo: '旧缓存单', status: 1, statusName: '未结清', totalAmount: 99, paidAmount: 0, balance: 99, totalDebit: 99, totalCredit: 99, bizType: 1, direction: 1, amount: 99, balanceAfter: 99, happenedAt: '2026-10-08', voucherDate: '2026-10-08', sourceType: 'manual', sourceTypeName: '手工', isActive: true, settlementType: 1, confirmStatus: 1 }
const success = (rows: object[] = []) => ({ list: rows, pagination: { total: rows.length }, summary: { inAmount: 99, outAmount: 0 } })
const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) }) }
const button = (host: ParentNode, text: string) => [...host.querySelectorAll('button')].find(button => button.textContent?.trim() === text)
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); fixture.list.mockReset(); fixture.reconciliation.mockReset(); fixture.voucher.mockReset(); fixture.trace.mockReset()
  fixture.reconciliation.mockResolvedValue({ items: [] })
  useAuthStore.setState({ token: 'offline-fixture', user: { id: 9, username: 'fixture', realName: 'fixture', roleId: 1, roleName: 'fixture', permissions: [] } })
})
afterEach(() => { useAuthStore.setState({ user: null, token: null }); localStorage.clear() })
async function page(sample: typeof samples[number], run: (host: HTMLDivElement, cache: QueryClient) => Promise<void>) {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host), cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  try {
    await act(async () => root.render(<QueryClientProvider client={cache}><MemoryRouter initialEntries={[sample.path]}><sample.Component /></MemoryRouter></QueryClientProvider>))
    await flush(); await run(host, cache)
  } finally { await act(async () => root.unmount()); cache.clear(); host.remove() }
}

test.each(samples)('$path 首次读取失败不显示暂无/零总数，重试沿用筛选恢复真实空结果', async sample => {
  fixture.list.mockRejectedValue(new Error('财务读取失败夹具'))
  await page(sample, async host => {
    expect(host.textContent).toContain('财务读取失败夹具')
    expect(host.textContent).not.toContain('暂无')
    expect(host.textContent).not.toMatch(/共\s*0/)
    expect(host.textContent).not.toContain('期间收入')
    const previousParams = fixture.list.mock.calls.at(-1)?.[0]
    fixture.list.mockResolvedValue(success())
    expect(button(host, '重试')).toBeTruthy()
    await act(async () => button(host, '重试')!.click()); await flush()
    expect(fixture.list.mock.calls.at(-1)?.[0]).toEqual(previousParams)
    expect(host.textContent).toContain('暂无')
    expect(host.textContent).toMatch(/共\s*0/)
  })
})

test.each(samples)('$path 缓存刷新失败隐去旧表/汇总并提供重试', async sample => {
  fixture.list.mockResolvedValue(success([row]))
  await page(sample, async (host, cache) => {
    expect(host.textContent).toContain('旧缓存单')
    fixture.list.mockRejectedValue(new Error('财务刷新失败夹具'))
    await act(async () => { await cache.refetchQueries({ queryKey: [sample.prefix] }) }); await flush()
    expect(host.textContent).toContain('财务刷新失败夹具')
    expect(host.textContent).not.toContain('旧缓存单')
    expect(host.textContent).not.toMatch(/共\s*1/)
    expect(host.textContent).not.toContain('期间收入')
    expect(button(host, '重试')).toBeTruthy()
  })
})

test('凭证勾稽刷新失败不继续显示缓存的勾稽一致', async () => {
  fixture.list.mockResolvedValue(success())
  fixture.reconciliation.mockResolvedValue({ items: [{ name: '库存', matched: true, voucher: 99, business: 99, diff: 0 }] })
  await page(samples[2], async (host, cache) => {
    expect(host.textContent).toContain('勾稽一致')
    fixture.reconciliation.mockRejectedValue(new Error('勾稽失败夹具'))
    await act(async () => { await cache.refetchQueries({ predicate: query => query.queryKey.includes('reconciliation') }) }); await flush()
    expect(host.textContent).toContain('勾稽失败夹具')
    expect(host.textContent).not.toContain('勾稽一致')
  })
})

test('凭证详情读取失败有明确错误和重试，不一直加载；重试可恢复分录', async () => {
  fixture.list.mockResolvedValue(success([row])); fixture.voucher.mockRejectedValue(new Error('凭证详情失败夹具'))
  await page(samples[2], async host => {
    await act(async () => button(host, '查看')!.click()); await flush()
    expect(document.body.textContent).toContain('凭证详情失败夹具')
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.textContent).not.toContain('加载中…')
    expect(button(dialog, '重试')).toBeTruthy()
    fixture.voucher.mockResolvedValue({ ...row, entries: [] })
    await act(async () => button(dialog, '重试')!.click()); await flush()
    expect(dialog.textContent).toContain('旧缓存单')
    expect(dialog.textContent).toContain('合计')
  })
})

test('供应商退款原单追踪刷新失败不继续展示缓存到账结果', async () => {
  fixture.list.mockResolvedValue(success([{ ...row, bizNo: 'RF-7', bizType: 6, bizId: 11, amount: 0.004 }]))
  fixture.trace.mockResolvedValue({ id: 11, refund_no: 'RF-7', amount: '0.0040', fund_transaction_id: 7, voucher_generate_error: '旧凭证核对结果' })
  await page(samples[1], async (host, cache) => {
    await act(async () => button(host, 'RF-7')!.click()); await flush()
    expect(document.body.textContent).toContain('旧凭证核对结果')
    fixture.trace.mockRejectedValue(new Error('追踪失败夹具'))
    await act(async () => { await cache.refetchQueries({ queryKey: ['supplier-refund-trace'] }) }); await flush()
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain('追踪失败夹具')
    expect(dialog.textContent).not.toContain('旧凭证核对结果')
    expect(button(dialog, '重试')).toBeTruthy()
  })
})
