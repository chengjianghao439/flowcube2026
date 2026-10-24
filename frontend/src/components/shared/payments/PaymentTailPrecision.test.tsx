// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RegisterPaymentDialog } from './RegisterPaymentDialog'
import { SettleReceiptDialog } from './SettleReceiptDialog'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const fixture = vi.hoisted(() => ({
  candidates: [] as Array<Record<string, unknown>>,
  payCalls: [] as Array<{ id: number; body: { amount: number }; key: string }>,
  settleCalls: [] as Array<{ id: number; allocations: Array<{ recordId?: number; statementId?: number; amount: number }>; key: string }>,
  createCalls: [] as Array<{ body: { amount: number; allocations: Array<{ amount: number }> }; key: string }>,
  fail: null as unknown,
  statusCalls: [] as Array<{ key: string; action: string }>,
}))
// Keep the production AppDialog/Portal, form, footer button, Input and submit guard.
// Only peripheral pickers/read APIs are replaced; no auth token or DB is created.
vi.mock('@/components/shared/DatePicker', () => ({ DatePicker: ({ value }: { value: string }) => <input aria-label="日期" value={value} readOnly /> }))
vi.mock('@/components/finder/CustomerFinder', () => ({ CustomerFinder: () => null }))
vi.mock('@/components/finder/SupplierFinder', () => ({ SupplierFinder: () => null }))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }))
vi.mock('@/hooks/useActiveWorkspaceTab', () => ({ useActiveWorkspaceTab: () => true }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))
vi.mock('@/lib/confirm', () => ({ confirmAction: ({ onConfirm }: { onConfirm: () => void }) => onConfirm() }))
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (v: string) => void; children: React.ReactNode }) => <select value={value} onChange={e => onValueChange(e.target.value)}><option value="" />{children}</select>,
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
}))
vi.mock('@/api/finance', () => ({ getActiveAccountsApi: async () => [{ id: 1, name: '合成账户', currentBalance: 1000 }] }))
vi.mock('@/api/payments', () => ({
  getPaymentsApi: async () => ({ list: fixture.candidates }),
  getStatementsApi: async () => ({ list: fixture.candidates }),
  payApi: async (id: number, body: { amount: number }, key: string) => {
    fixture.payCalls.push({ id, body, key })
    if (fixture.fail) throw fixture.fail
    return { id }
  },
  settleReceiptApi: async (id: number, allocations: Array<{ amount: number }>, key: string) => {
    fixture.settleCalls.push({ id, allocations, key })
    if (fixture.fail) throw fixture.fail
    return { id, balance: 0 }
  },
  createReceiptApi: async (body: { amount: number; allocations: Array<{ amount: number }> }, key: string) => {
    fixture.createCalls.push({ body, key })
    if (fixture.fail) throw fixture.fail
    return { id: 9, balance: 0 }
  },
}))
vi.mock('@/api/operation-requests', () => ({
  getOperationRequestStatusApi: async (key: string, action: string) => {
    fixture.statusCalls.push({ key, action })
    return { status: 'success', data: null }
  },
}))

const clients: QueryClient[] = []
const mounted: Array<{ root: ReturnType<typeof createRoot>; host: HTMLDivElement }> = []
const record = (id: number, balance: number) => ({ id, orderNo: `AR-${id}`, statementNo: `ST-${id}`, partyName: '合成客户', partyId: 1, type: 2, balance, totalAmount: balance, status: 2, confirmStatus: 1, dueDate: `2026-10-${String(id).padStart(2, '0')}` })
const receipt = (balance: number) => ({ id: 91, receiptNo: 'RC-TAIL', type: 2, partyName: '合成客户', partyId: 1, amount: balance, balance, settledAmount: 0, status: 1, paymentDate: '2026-10-14', accountId: 1 })
const buttons = () => Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
const button = (text: string) => buttons().find(b => b.textContent?.includes(text))!
const allocations = () => Array.from(document.querySelectorAll<HTMLInputElement>('input[aria-label$="本次核销金额"]'))
async function flush() { await act(async () => { await new Promise(r => setTimeout(r, 10)) }) }
async function mount(element: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(client)
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); mounted.push({ root, host })
  await act(async () => root.render(<QueryClientProvider client={client}>{element}</QueryClientProvider>))
  await flush()
  return { client, rerender: async (next: React.ReactNode) => {
    await act(async () => root.render(<QueryClientProvider client={client}>{next}</QueryClientProvider>))
    await flush()
  } }
}
async function input(el: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function click(text: string) { await act(async () => button(text).click()); await flush() }
async function chooseAccount() {
  const el = Array.from(document.querySelectorAll('select')).find(s => s.querySelector('option[value="1"]'))!
  await act(async () => { el.value = '1'; el.dispatchEvent(new Event('change', { bubbles: true })) })
}
async function continueWith(total: number, balances = [total], target: 'record' | 'statement' = 'record') {
  fixture.candidates = balances.map((b, i) => record(i + 1, b))
  return mount(<SettleReceiptDialog open onClose={() => {}} type={2} settlementTypes="1" receipt={receipt(total) as never} target={target} />)
}
afterEach(async () => {
  await act(async () => { mounted.splice(0).forEach(({ root, host }) => { root.unmount(); host.remove() }) })
  clients.splice(0).forEach(c => c.clear())
  fixture.candidates = []; fixture.payCalls = []; fixture.settleCalls = []; fixture.createCalls = []; fixture.statusCalls = []; fixture.fail = null
  localStorage.clear()
})


it.each([{ type: 1 as const, amount: 12.34 }, { type: 1 as const, amount: .01 }, { type: 2 as const, amount: 12.34 }, { type: 2 as const, amount: .01 }])('actual single-payment form submits cash cents $amount for type $type', async ({ type, amount }) => {
  await mount(<RegisterPaymentDialog open onClose={() => {}} type={type} record={record(1, amount) as never} />)
  await chooseAccount(); const el = document.querySelector<HTMLInputElement>('input[type="number"]')!
  expect(el.min).toBe('0.01'); expect(el.step).toBe('0.01'); await input(el, String(amount)); expect(el.checkValidity()).toBe(true)
  await click('确认登记'); expect(fixture.payCalls).toHaveLength(1); expect(fixture.payCalls[0].body.amount).toBe(amount)
})
it.each(['0.001', '0.0067', '12.3456', '1.23456'])('native form and direct submit cannot send fractional-cent %s', async value => {
  await mount(<RegisterPaymentDialog open onClose={() => {}} type={2} record={record(1, 100) as never} />)
  await chooseAccount(); const el = document.querySelector<HTMLInputElement>('input[type="number"]')!
  await input(el, value); expect(el.checkValidity()).toBe(false); await click('确认登记'); expect(fixture.payCalls).toHaveLength(0)
  await act(async () => { document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }); await flush(); expect(fixture.payCalls).toHaveLength(0)
})
it.each([.0067, .8999, 12.3456])('legacy single balance %s stays exact and cannot be rounded up for payment', async balance => {
  await mount(<RegisterPaymentDialog open onClose={() => {}} type={2} record={record(1, balance) as never} />)
  expect(document.querySelector('.fc-dialog-caption')?.textContent).toContain('历史余额含不足一分的尾差，请先核对')
  expect(document.body.textContent?.split('历史余额含不足一分的尾差，请先核对')).toHaveLength(2)
  expect(document.body.textContent).not.toContain('核对原账款、资金账户、实际日期与金额。')
  await chooseAccount(); await input(document.querySelector('input[type="number"]')!, '.01')
  expect(document.body.textContent).toContain(`¥${balance}`); expect(document.body.textContent).toContain('请先核对'); expect(button('确认登记').disabled).toBe(true)
  await act(async () => { document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }); expect(fixture.payCalls).toHaveLength(0)
})
it.each([12.34, 1.23, .01])('autoAllocate exactly settles cent tail %s', async amount => {
  await continueWith(amount); await click('自动分配'); expect(Number(allocations()[0].value)).toBe(amount); expect(allocations()[0].step).toBe('0.01'); expect(allocations()[0].checkValidity()).toBe(true)
  await click('确认核销'); expect(fixture.settleCalls[0].allocations).toEqual([{ recordId: 1, amount }])
})
it('integer cents conserve .30 across .10+.20, without consuming a third .01', async () => {
  await continueWith(.30, [.1, .2, .01]); await click('自动分配'); expect(allocations().map(e => e.value)).toEqual(['0.10', '0.20', '']); expect(document.body.textContent).toContain('未分配 ¥0.00')
  await click('确认核销'); expect(fixture.settleCalls[0].allocations.map(a => a.amount)).toEqual([.1, .2])
})
it('auto allocation never exceeds the original receipt cents or a candidate', async () => {
  await continueWith(.02, [.01, .01, .01]); await click('自动分配'); expect(allocations().map(e => e.value)).toEqual(['0.01', '0.01', '']); await click('确认核销'); expect(fixture.settleCalls[0].allocations).toHaveLength(2)
})
it('statement full-amount allocation sends cents, not a price-scale amount', async () => {
  await continueWith(12.34, [12.34], 'statement'); await click('全额'); expect(allocations()[0].value).toBe('12.34'); await click('确认核销'); expect(fixture.settleCalls[0].allocations).toEqual([{ statementId: 1, amount: 12.34 }])
})
it.each(['12.345', '-0.01', '12.35', '1.00001'])('manual allocation %s cannot bypass cents/positive/candidate limits', async value => {
  await continueWith(20, [12.34]); await input(allocations()[0], value); expect(button('确认核销')?.disabled ?? button('仅登记不核销').disabled).toBe(true); expect(fixture.settleCalls).toHaveLength(0)
})
it.each(['0.01', '.01', '1e-2'])('new receipt accepts exactly representable cash %s', async text => {
  fixture.candidates = [record(1, .01)]; await mount(<SettleReceiptDialog open onClose={() => {}} type={2} settlementTypes="1" />)
  await input(document.querySelector<HTMLInputElement>('input[placeholder="输入客户名称"]')!, '合成客户'); await flush(); await chooseAccount(); const el = document.querySelector<HTMLInputElement>('input[type="number"]')!
  await input(el, text); expect(el.checkValidity()).toBe(true); await click('自动分配'); await click('确认核销'); expect(fixture.createCalls[0].body.amount).toBe(.01); expect(fixture.createCalls[0].body.allocations).toEqual([{ recordId: 1, amount: .01 }])
})
it.each(['.001', '.0067', '1.23456'])('new receipt never sends fractional-cent %s even though its layout is not a native form', async value => {
  await mount(<SettleReceiptDialog open onClose={() => {}} type={2} settlementTypes="1" />)
  await input(document.querySelector<HTMLInputElement>('input[placeholder="输入客户名称"]')!, '合成客户'); await chooseAccount(); await input(document.querySelector('input[type="number"]')!, value)
  expect(button('仅登记不核销').disabled).toBe(true); await click('仅登记不核销'); expect(fixture.createCalls).toHaveLength(0)
})
it.each([.8999, .0067])('legacy receipt balance %s is read-only and requires reconciliation; no automatic rounding', async balance => {
  await continueWith(balance)
  expect(document.querySelector('.fc-dialog-caption')?.textContent).toContain(`原余额 ¥${balance}，含不足一分的尾差，请先核对`)
  expect(document.body.textContent?.split('含不足一分的尾差，请先核对')).toHaveLength(3) // 窗口提示和原候选行各一次，局部账款依据保留。
  expect(document.body.textContent).not.toContain('核对收付款信息并选择本次核销账款。')
  expect(document.body.textContent).toContain(String(balance)); expect(document.body.textContent).toContain('请先核对'); expect(button('全额').disabled).toBe(true); expect(button('自动分配').disabled).toBe(true); expect(button('仅登记不核销').disabled).toBe(true)
  await click('全额'); await click('自动分配'); expect(allocations()[0].value).toBe(''); expect(fixture.settleCalls).toHaveLength(0)
})
it('legacy candidate is skipped, while a verified cent candidate may be allocated without rounding the old balance', async () => {
  await continueWith(1, [.8999, .01]); await click('自动分配'); expect(document.body.textContent).toContain('¥0.8999（待核）'); expect(allocations()[0].disabled).toBe(true); expect(allocations().map(e=>e.value)).toEqual(['','0.01']); await click('确认核销'); expect(fixture.settleCalls[0].allocations).toEqual([{ recordId: 2, amount: .01 }])
})
it('cent retry after 503 and close/reopen keeps original payload/key/action when the candidate has disappeared', async () => {
  fixture.fail = Object.assign(new Error('server unavailable'), { status: 503 }); const view = await continueWith(12.34); await click('全额'); await click('确认核销')
  fixture.candidates = []; await act(async () => { await view.client.invalidateQueries({ queryKey: ['payments', 'settleable'] }) })
  await view.rerender(<SettleReceiptDialog open={false} onClose={() => {}} type={2} settlementTypes="1" receipt={receipt(12.34) as never} />); await view.rerender(<SettleReceiptDialog open onClose={() => {}} type={2} settlementTypes="1" receipt={receipt(12.34) as never} />)
  await click('确认核销'); expect(fixture.settleCalls).toHaveLength(2); expect(fixture.settleCalls[1]).toEqual(fixture.settleCalls[0]); await click('查询上次结果'); expect(fixture.statusCalls[0]).toEqual({ key: fixture.settleCalls[0].key, action: 'payment.receipt.settle.91' })
})
