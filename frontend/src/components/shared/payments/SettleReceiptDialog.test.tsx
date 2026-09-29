// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SettleReceiptDialog } from './SettleReceiptDialog'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const fixture = vi.hoisted(() => ({
  /** 回执查询实际收到的 (requestKey, action)——本文件断言的就是这里的 action */
  statusCalls: [] as Array<{ key: string; action: string }>,
  settleCalls: [] as Array<{ id: number; requestKey: string }>,
  receiptStatus: 'success' as 'pending' | 'success' | 'failed' | 'not_found',
  /** 非 null 时提交抛该错误（模拟超时/断网这类「结果未确认」） */
  failWith: null as unknown,
  toasts: [] as string[],
  /** 取证用：置 true 时回执查询挂起，直到测试调用 statusResolver */
  deferStatus: false,
  statusResolver: null as null | (() => void),
}))

vi.mock('@/components/shared/AppDialog', () => ({
  AppDialog: ({ title, children, footer }: { title?: React.ReactNode; children?: React.ReactNode; footer?: React.ReactNode }) =>
    <div>{title}{children}{footer}</div>,
}))
vi.mock('@/components/finder/CustomerFinder', () => ({ CustomerFinder: () => null }))
vi.mock('@/components/finder/SupplierFinder', () => ({ SupplierFinder: () => null }))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }))
vi.mock('@/hooks/useActiveWorkspaceTab', () => ({ useActiveWorkspaceTab: () => true }))
vi.mock('@/components/shared/DatePicker', () => ({ DatePicker: ({ value }: { value: string }) => <input value={value} readOnly /> }))
vi.mock('@/lib/toast', () => ({
  toast: { success: (m: string) => fixture.toasts.push(m), error: vi.fn(), warning: vi.fn() },
}))
// 继续核销不动账户、不弹余额确认；这里仍兜底直接执行，避免测试卡在确认框
vi.mock('@/lib/confirm', () => ({ confirmAction: ({ onConfirm }: { onConfirm?: () => void }) => onConfirm?.() }))
vi.mock('@/components/ui/select', () => {
  const SelectItem = (_props: { value: string; children?: React.ReactNode }) => null
  ;(SelectItem as unknown as { __isSelectItem?: boolean }).__isSelectItem = true
  const flatten = (node: React.ReactNode): Array<{ props: { value: string; children?: React.ReactNode } }> => {
    const out: Array<{ props: { value: string; children?: React.ReactNode } }> = []
    const walk = (n: React.ReactNode): void => {
      if (Array.isArray(n)) { n.forEach(walk); return }
      if (!n || typeof n !== 'object') return
      const el = n as { type?: unknown; props?: { children?: React.ReactNode } }
      if ((el.type as { __isSelectItem?: boolean } | undefined)?.__isSelectItem) {
        out.push(el as unknown as { props: { value: string; children?: React.ReactNode } })
        return
      }
      if (el.props?.children !== undefined) walk(el.props.children)
    }
    walk(node)
    return out
  }
  return {
    Select: ({ value, onValueChange, children }: { value: string; onValueChange?: (v: string) => void; children?: React.ReactNode }) => (
      <select value={value} onChange={e => onValueChange?.(e.target.value)}>
        {flatten(children).map(it => <option key={it.props.value} value={it.props.value}>{it.props.children}</option>)}
      </select>
    ),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: () => null,
    SelectItem,
  }
})
vi.mock('@/api/finance', () => ({
  getActiveAccountsApi: async () => [{ id: 1, name: '测试账户', currentBalance: -100 }],
}))
vi.mock('@/api/payments', () => ({
  getPaymentsApi: async () => ({
    list: [{
      id: 6, orderNo: 'AP-TEST-1', partyName: '验收测试供应商', balance: 20,
      status: 2, confirmStatus: 1, dueDate: '2026-09-29',
    }],
  }),
  getStatementsApi: async () => ({ list: [] }),
  createReceiptApi: async () => ({ id: 1, receiptNo: 'PY-NEW', settledAmount: 0, balance: 0 }),
  settleReceiptApi: async (id: number, _alloc: unknown, requestKey: string) => {
    fixture.settleCalls.push({ id, requestKey })
    if (fixture.failWith) throw fixture.failWith
    return { id, receiptNo: 'PY20260929077', settledAmount: 0, balance: 0 }
  },
}))
vi.mock('@/api/operation-requests', () => ({
  getOperationRequestStatusApi: async (key: string, action: string) => {
    fixture.statusCalls.push({ key, action })
    const payload = { status: fixture.receiptStatus, data: null, message: '来自回执查询' }
    if (fixture.deferStatus) {
      return await new Promise(res => { fixture.statusResolver = () => res(payload) })
    }
    return payload
  },
}))

const hosts: HTMLDivElement[] = []
let closeCount = 0
const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })

const RECEIPT_A = {
  id: 77, receiptNo: 'PY20260929077', type: 1, partyName: '验收测试供应商',
  partyId: null, amount: 30, settledAmount: 0, balance: 30, status: 1,
  paymentDate: '2026-09-29', method: '转账',
}
const RECEIPT_B = { ...RECEIPT_A, id: 88, receiptNo: 'PY20260929088' }

async function renderInto(root: ReturnType<typeof createRoot>, receipt: unknown) {
  await act(async () => root.render(
    <QueryClientProvider client={qc}>
      <SettleReceiptDialog
        open
        onClose={() => { closeCount++ }}
        type={1}
        settlementTypes="1"
        receipt={receipt as never}
      />
    </QueryClientProvider>,
  ))
  // 候选是异步查询，等它落地（多等一轮宏任务，让 isFetching 归位）
  await act(async () => { await Promise.resolve() })
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}

/** 继续核销模式：receipt 固定，弹窗打开即进入「继续核销 — PY20260929077」 */
async function mount(receipt: unknown = RECEIPT_A) {
  const host = document.createElement('div'); document.body.append(host); hosts.push(host)
  const root = createRoot(host)
  await renderInto(root, receipt)
  return { host, root, rerender: (r: unknown) => renderInto(root, r) }
}

const button = (host: HTMLElement, text: string) =>
  Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes(text))!

const field = (host: HTMLElement, placeholder: string) =>
  host.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)!

/** 候选行的「本次核销金额」输入框（placeholder 0.00） */
const allocInput = (host: HTMLElement) => field(host, '0.00')

/** 原生 setter + input 事件：React 的受控 input 只认这种方式的事件 */
async function setField(el: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** 把候选的核销金额填满（该笔余额 ≤ 汇款单余额，故分配后 unallocated ≥ 0，可提交） */
async function allocateFull(host: HTMLElement) {
  await act(async () => button(host, '全额').click())
}

afterEach(() => {
  hosts.splice(0).forEach(h => h.remove())
  qc.clear()
  fixture.statusCalls.length = 0; fixture.settleCalls.length = 0
  fixture.toasts.length = 0; closeCount = 0
  fixture.receiptStatus = 'success'; fixture.failWith = null
  fixture.deferStatus = false; fixture.statusResolver = null
})

it('★ 查询在途期间又提交一次时，陈旧的 success 回执不得抹掉新一次的未确认、不得轮换它的键', async () => {
  // 已取证的原始行为：陈旧回执（settle.77 的 success）会把 B 那一次（settle.88）的「未确认」
  // 一并清掉并轮换键——B 若其实已在服务端成功，用户按提示重试就会带新键而重复核销。
  // 现按提交代次保护：查询发起后若又提交过，则该回执只作提示，不动当前的未确认与请求键。
  const { host, root, rerender } = await mount(RECEIPT_A)
  await allocateFull(host)
  fixture.failWith = Object.assign(new Error('Network Error'), { code: 'NETWORK_ERROR' })
  await act(async () => button(host, '确认核销').click())
  const keyA = fixture.settleCalls[0].requestKey

  fixture.deferStatus = true
  await act(async () => button(host, '查询上次结果').click())

  await rerender(RECEIPT_B)
  await allocateFull(host)
  await act(async () => button(host, '确认核销').click())
  expect(fixture.settleCalls).toHaveLength(2)
  const keyB = fixture.settleCalls[1].requestKey
  expect(keyB).toBe(keyA)                       // 未确认期间不换键
  expect(host.textContent).toContain('没有收到') // B 之后仍是未确认态

  // 让陈旧的 A 回执返回 success
  await act(async () => { fixture.statusResolver?.(); await Promise.resolve() })
  await act(async () => { await Promise.resolve() })

  // B 那一次的未确认必须还在，键必须没被轮换
  expect(host.textContent).toContain('没有收到')
  await allocateFull(host)
  await act(async () => button(host, '确认核销').click())
  expect(fixture.settleCalls.at(-1)!.requestKey).toBe(keyB)
  await act(async () => root.unmount())
})

it('★ 继续核销的「查询上次结果」必须带本张汇款单的 receiptId，不能用 base action', async () => {
  // 前端在继续核销时**已经知道 receipt.id**（弹窗标题就是这张单），但查询仍传 base action
  // `payment.receipt.settle`。服务端 getScopedOperationRequestStatus 对同键多条只认「恰好一条」：
  //   · 同键下有两条（例如先后核销过两张单）→ 返回 not_found，两笔其实都已成功却报「查不到」；
  //   · 同键下只有一条（切到另一张单但未提交）→ 直接返回**那一张**的回执，界面会把它当成
  //     「本次提交成功」，并关窗丢掉当前这张单的草稿。
  // 因为 action 里带了 receiptId，服务端本可精确定位（settle.77 → 恰好那条）。
  const { host, root } = await mount()
  expect(host.textContent).toContain('继续核销 — PY20260929077')

  await allocateFull(host)
  fixture.failWith = Object.assign(new Error('Network Error'), { code: 'NETWORK_ERROR' })
  await act(async () => button(host, '确认核销').click())
  expect(host.textContent).toContain('没有收到')
  expect(fixture.settleCalls).toHaveLength(1)
  expect(fixture.settleCalls[0].id).toBe(77)

  await act(async () => button(host, '查询上次结果').click())
  await act(async () => { await Promise.resolve() })

  expect(fixture.statusCalls).toHaveLength(1)
  // 查询键要与提交时一致（这条不变）
  expect(fixture.statusCalls[0].key).toBe(fixture.settleCalls[0].requestKey)
  // ← 本行是缺陷所在：查询必须能定位到本张单
  expect(fixture.statusCalls[0].action).toBe('payment.receipt.settle.77')
  await act(async () => root.unmount())
})

it('★ 切到另一张单并填了草稿后，查询上一张的成功不得关窗、不得丢当前草稿', async () => {
  // 查询是异步的，期间用户可能切到另一张汇款单并开始填。此时若凭「提交时的那一张」关窗，
  // 会把当前这张单上未提交的草稿一并丢掉。
  const { host, root, rerender } = await mount(RECEIPT_A)
  await allocateFull(host)
  fixture.failWith = Object.assign(new Error('Network Error'), { code: 'NETWORK_ERROR' })
  await act(async () => button(host, '确认核销').click())
  expect(host.textContent).toContain('没有收到')

  // 切到 B，并填一笔尚未提交的分配（草稿）
  await rerender(RECEIPT_B)
  await allocateFull(host)
  expect(host.textContent).toContain('继续核销 — PY20260929088')
  expect(Number(allocInput(host).value)).toBe(20)
  const before = closeCount

  await act(async () => button(host, '查询上次结果').click())
  await act(async () => { await Promise.resolve() })

  // 查的是上一张（A）——按 A 的 receiptId 定位
  expect(fixture.statusCalls.at(-1)!.action).toBe('payment.receipt.settle.77')
  // 当前目标是 B：不得关窗，B 的标题与**草稿值**都还在
  expect(closeCount).toBe(before)
  expect(host.textContent).toContain('继续核销 — PY20260929088')
  expect(Number(allocInput(host).value)).toBe(20)
  await act(async () => root.unmount())
})

it('★ 已有单丢响应后切到「新建」并填草稿，查询上一张成功不得关窗、不得清空新建草稿', async () => {
  // 反向的同目标误判：新建模式的 receipt 是 null，若把「提交目标为 null」直接当成同目标，
  // 就会关掉用户正在填的新建草稿。
  const { host, root, rerender } = await mount(RECEIPT_A)
  await allocateFull(host)
  fixture.failWith = Object.assign(new Error('Network Error'), { code: 'NETWORK_ERROR' })
  await act(async () => button(host, '确认核销').click())
  expect(host.textContent).toContain('没有收到')

  // 切到新建模式，填一份未提交的草稿
  await rerender(null)
  const draftName = '新建草稿供应商'
  await setField(field(host, '输入供应商名称'), draftName)
  expect(host.textContent).toContain('登记付款并核销')
  const before = closeCount

  await act(async () => button(host, '查询上次结果').click())
  await act(async () => { await Promise.resolve() })

  expect(fixture.statusCalls.at(-1)!.action).toBe('payment.receipt.settle.77')
  // 当前是新建模式：不得关窗，新建草稿的输入值不得被清掉
  expect(closeCount).toBe(before)
  expect(host.textContent).toContain('登记付款并核销')
  expect(field(host, '输入供应商名称').value).toBe(draftName)
  await act(async () => root.unmount())
})

it('★ 两次提交都丢响应后，查询按最后一次提交的 receiptId 定位，提示条带该张单号', async () => {
  const { host, root, rerender } = await mount(RECEIPT_A)
  fixture.failWith = Object.assign(new Error('Network Error'), { code: 'NETWORK_ERROR' })

  await allocateFull(host)
  await act(async () => button(host, '确认核销').click())
  await rerender(RECEIPT_B)
  await allocateFull(host)
  await act(async () => button(host, '确认核销').click())
  expect(fixture.settleCalls).toHaveLength(2)
  expect(fixture.settleCalls[1].id).toBe(88)
  // 提示条要说清在确认哪一张（同单位同金额的两张单只靠金额无法区分）
  expect(host.textContent).toContain('汇款单 PY20260929088')

  await act(async () => button(host, '查询上次结果').click())
  await act(async () => { await Promise.resolve() })

  // 定位到最后一次提交的那一张，而不是 base action（否则同键多条会 not_found）
  expect(fixture.statusCalls.at(-1)!.action).toBe('payment.receipt.settle.88')
  await act(async () => root.unmount())
})
