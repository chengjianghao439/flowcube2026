// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RegisterPaymentDialog } from './RegisterPaymentDialog'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const fixture = vi.hoisted(() => ({
  statusCalls: [] as Array<{ key: string; action: string }>,
  payCalls: [] as Array<{ id: number; requestKey: string; body: Record<string, unknown> }>,
  toasts: [] as string[],
  failWith: null as unknown,
  balance: 1000,
  pendingConfirm: null as null | (() => void),
}))

vi.mock('@/components/shared/AppDialog', () => ({
  AppDialog: ({ title, children, footer }: { title?: React.ReactNode; children?: React.ReactNode; footer?: React.ReactNode }) =>
    <div>{title}{children}{footer}</div>,
}))
vi.mock('@/components/shared/DatePicker', () => ({
  DatePicker: ({ value, onChange }: { value: string; onChange?: (v: string) => void }) => (
    <input data-testid="pay-date" value={value} onChange={e => onChange?.(e.target.value)} />
  ),
}))
vi.mock('@/components/shared/payments/BackfillRequestDialog', () => ({ BackfillRequestDialog: () => null }))
vi.mock('./usePaymentViewInvalidation', () => ({ usePaymentViewInvalidation: () => () => {} }))
vi.mock('@/lib/toast', () => ({ toast: { success: (m: string) => fixture.toasts.push(m), error: vi.fn(), warning: vi.fn() } }))
vi.mock('@/lib/confirm', () => ({ confirmAction: ({ onConfirm }: { onConfirm?: () => void }) => { fixture.pendingConfirm = onConfirm ?? null } }))
vi.mock('@/components/ui/select', () => {
  const SelectItem = ({ value, children }: { value: string; children?: React.ReactNode }) => <option value={value}>{children}</option>
  return {
    Select: ({ value, onValueChange, children }: { value: string; onValueChange?: (v: string) => void; children?: React.ReactNode }) => (
      <select value={value} onChange={e => onValueChange?.(e.target.value)}>{children}</select>
    ),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    SelectItem,
  }
})
vi.mock('@/api/finance', () => ({ getActiveAccountsApi: async () => [{ id: 1, name: '验收账户', currentBalance: fixture.balance }] }))
vi.mock('@/api/payments', () => ({
  payApi: async (id: number, d: object, requestKey: string) => {
    fixture.payCalls.push({ id, requestKey, body: d as Record<string, unknown> })
    if (fixture.failWith) throw fixture.failWith
    return { ok: true }
  },
}))
vi.mock('@/api/operation-requests', () => ({
  getOperationRequestStatusApi: async (key: string, action: string) => {
    fixture.statusCalls.push({ key, action })
    return { status: 'success', data: null, message: '' }
  },
}))

const hosts: HTMLDivElement[] = []
const roots: Array<ReturnType<typeof createRoot>> = []
const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
let closeCount = 0

const REC = (id: number, orderNo: string) => ({
  id, orderNo, partyName: `供应商${id}`, totalAmount: 100, balance: 50, status: 2, confirmStatus: 1,
} as never)

async function renderInto(root: ReturnType<typeof createRoot>, record: unknown) {
  await act(async () => root.render(
    <QueryClientProvider client={qc}>
      <RegisterPaymentDialog open onClose={() => { closeCount++ }} type={1} record={record as never} />
    </QueryClientProvider>,
  ))
  await act(async () => { await Promise.resolve() })
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}

async function mount(record: unknown) {
  const host = document.createElement('div'); document.body.append(host); hosts.push(host)
  const root = createRoot(host); roots.push(root)
  await renderInto(root, record)
  return { host, root, rerender: (r: unknown) => renderInto(root, r) }
}

const button = (text: string) =>
  Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes(text))!
const numInput = () => document.querySelector<HTMLInputElement>('input[type=number]')!

async function setAmount(v: string) {
  await act(async () => {
    const el = numInput()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

afterEach(() => {
  roots.splice(0).forEach(r => { try { r.unmount() } catch { /* 已卸载 */ } })
  hosts.splice(0).forEach(h => h.remove())
  qc.clear()
  fixture.statusCalls.length = 0; fixture.payCalls.length = 0; fixture.toasts.length = 0
  fixture.failWith = null; closeCount = 0; fixture.balance = 1000; fixture.pendingConfirm = null
})

it('★ 付款「查询上次结果」要按本次账款 ID 定位；切到另一笔后查询上一笔成功不得关掉当前弹窗，提示要点出原单号', async () => {
  const { root, rerender } = await mount(REC(1, 'AP-A-1'))
  // 账户下拉在 mock 里是原生 <select>：直接设值（否则 handlePay 会因未选账户提前返回）
  await act(async () => {
    const sel = document.querySelector<HTMLSelectElement>('select')!
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(sel, '1')
    sel.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await setAmount('5')
  fixture.failWith = Object.assign(new Error('Network Error'), { code: 'NETWORK_ERROR' })
  await act(async () => button('确认登记').click())
  fixture.pendingConfirm = null
  expect(fixture.payCalls).toHaveLength(1)
  expect(fixture.payCalls[0].id).toBe(1)

  await rerender(REC(2, 'AP-B-2'))                     // 切到另一笔（未提交）
  const before = closeCount
  await act(async () => button('查询上次结果').click())
  await act(async () => { await Promise.resolve() })

  // 查询必须带本次账款 ID（否则同键多条查不到；同键一条时又会误定位/误关）
  expect(fixture.statusCalls.at(-1)!.action).toBe('payment.record.pay.1')
  // 当前看的是 2：不得关弹窗
  expect(closeCount).toBe(before)
  // 成功提示要点出被确认的原单号
  expect(fixture.toasts.some(t => t.includes('AP-A-1'))).toBe(true)
  await act(async () => root.unmount())
})

it('★ 余额不足确认挂起期间切到另一笔，执行原确认仍必须写原账款（id/金额/日期/单号取提交时快照）', async () => {
  // 这正是本次审查纠正的边界：写入用的是 mutation 参数 id，而「余额不足确认」的回调可能
  // 在用户切到另一笔之后才被执行——若用当前 record 填身份，就会把 A 的付款记成 B。
  fixture.balance = 0                                  // 触发余额不足二次确认
  const { root, rerender } = await mount(REC(1, 'AP-A-1'))
  await act(async () => {
    const sel = document.querySelector<HTMLSelectElement>('select')!
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(sel, '1')
    sel.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await setAmount('7')
  // 捕获**提交前**的原日期，断言用它（硬编码具体日期会在换日后假失败）
  const originalDate = document.querySelector<HTMLInputElement>('[data-testid="pay-date"]')!.value
  fixture.failWith = Object.assign(new Error('Network Error'), { code: 'NETWORK_ERROR' })
  await act(async () => button('确认登记').click())
  expect(typeof fixture.pendingConfirm).toBe('function')   // 确认框挂起，尚未提交
  expect(fixture.payCalls).toHaveLength(0)

  await rerender(REC(2, 'AP-B-2'))                      // 挂起期间切到另一笔
  // 并在 B 上把金额/日期改成不同值——原确认若用当前表单值，就会把 A 的付款写成 B 的金额/日期
  await setAmount('999')
  await act(async () => {
    const dateEl = document.querySelector<HTMLInputElement>('[data-testid="pay-date"]')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(dateEl, '2026-12-31')  // 与 B 不同日
    dateEl.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => { fixture.pendingConfirm?.(); await Promise.resolve() })

  // 实际写入的仍是 A，且金额/日期取的是**提交时快照**而非 B 上的当前值
  expect(fixture.payCalls).toHaveLength(1)
  expect(fixture.payCalls[0].id).toBe(1)
  expect(fixture.payCalls[0].body.amount).toBe(7)
  expect(fixture.payCalls[0].body.paymentDate).toBe(originalDate)

  // 查询与提示也必须指 A，且不得关掉当前正在看的 B
  const before = closeCount
  await act(async () => button('查询上次结果').click())
  await act(async () => { await Promise.resolve() })
  expect(fixture.statusCalls.at(-1)!.action).toBe('payment.record.pay.1')
  expect(fixture.toasts.some(t => t.includes('AP-A-1'))).toBe(true)
  expect(closeCount).toBe(before)
  await act(async () => root.unmount())
})
