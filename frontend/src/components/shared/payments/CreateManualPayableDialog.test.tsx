// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CreateManualPayableDialog } from './CreateManualPayableDialog'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const fixture = vi.hoisted(() => ({
  options: [
    { code: '6602', name: '管理费用', category: 6 },
    { code: '6601', name: '销售费用', category: 6 },
  ],
  calls: [] as Array<{ payload: Record<string, unknown>; requestKey: string }>,
  /** 字符串＝普通业务错误；Error 实例可带 code（用于模拟超时/断网这类「结果未确认」） */
  failWith: null as string | Error | null,
  /** 回执查询的返回（status 由各用例设置） */
  receiptStatus: 'pending' as 'pending' | 'success' | 'failed' | 'not_found',
  toasts: [] as string[],
}))

vi.mock('@/components/shared/AppDialog', () => ({
  AppDialog: ({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) => <div>{children}{footer}</div>,
}))
vi.mock('@/components/shared/DatePicker', () => ({
  DatePicker: ({ value }: { value: string }) => <input data-testid="due-date" value={value} readOnly />,
}))
vi.mock('./usePaymentViewInvalidation', () => ({ usePaymentViewInvalidation: () => () => {} }))
vi.mock('@/lib/toast', () => ({
  toast: { success: (m: string) => fixture.toasts.push(m), error: vi.fn(), warning: vi.fn() },
}))
// Radix Select 在 jsdom 里要靠 pointer 事件开列表，这里降级成原生 select：
// SelectItem 仍以元素形式出现在 children 里，展平后变成 option，值由 Select 上的 value 承载。
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
// 不 mock react-query：用真实 QueryClient，只把网络层换掉，测试跑的就是真实的
// 缓存/失效/mutation 生命周期（mock 掉它就只能验参数拼装，验不了行为）
function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
}

vi.mock('@/api/payments', () => ({
  getDebitAccountOptionsApi: async () => fixture.options,
  createPaymentApi: async (payload: Record<string, unknown>, requestKey: string) => {
    fixture.calls.push({ payload, requestKey })
    if (fixture.failWith) throw fixture.failWith instanceof Error ? fixture.failWith : new Error(fixture.failWith)
    return { id: 7, settlementType: payload.settlementType }
  },
}))
vi.mock('@/api/operation-requests', () => ({
  getOperationRequestStatusApi: async () => ({ status: fixture.receiptStatus, data: null, message: '来自回执查询' }),
}))

const hosts: HTMLDivElement[] = []
let closeCount = 0
const qc = newClient()

async function mount(open = true) {
  const host = document.createElement('div'); document.body.append(host); hosts.push(host)
  const root = createRoot(host)
  await act(async () => root.render(
    <QueryClientProvider client={qc}>
      <CreateManualPayableDialog open={open} onClose={() => { closeCount++ }} />
    </QueryClientProvider>,
  ))
  // 科目下拉是异步查询，等它落地再操作表单
  await act(async () => { await Promise.resolve() })
  return { host, root }
}

/** 原生 setter + change 事件：React 的受控 input/select 只认这种方式的事件 */
async function setField(el: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}
const button = (host: HTMLElement, text: string) =>
  Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes(text))!
const field = (host: HTMLElement, placeholder: string) =>
  host.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)!
/** 第一个 select 是结算方式，第二个是借方科目 */
const selects = (host: HTMLElement) => host.querySelectorAll<HTMLSelectElement>('select')

async function fillValid(host: HTMLElement, account = '6602') {
  await setField(field(host, '输入供应商名称'), 'Smoke供应商')
  await setField(field(host, '本次应付金额'), '120.5')
  await setField(selects(host)[1], account)
}

afterEach(() => {
  hosts.splice(0).forEach(h => h.remove())
  qc.clear()
  fixture.calls.length = 0; fixture.failWith = null; fixture.toasts.length = 0; closeCount = 0
  fixture.receiptStatus = 'pending'
})

it('★ 回执查不到（not_found）视为仍未确认：不换请求键，也不算「确定失败」', async () => {
  // 幂等记录的 PENDING 行写在业务事务里，事务提交前另一个连接读不到（见
  // tests/operation-request-concurrency.smoke.test.js 的可见性回归）。所以 not_found
  // 既可能是「正在处理」也可能是「没送到」——换键重提就会把同一笔应付录两遍。
  const { host, root } = await mount()
  await fillValid(host)
  fixture.failWith = Object.assign(new Error('Network Error'), { code: 'NETWORK_ERROR' })
  await act(async () => button(host, '创建').click())
  expect(host.textContent).toContain('提交结果未确认')
  expect(button(host, '查询上次结果')).toBeTruthy()

  fixture.receiptStatus = 'not_found'
  await act(async () => button(host, '查询上次结果').click())
  await act(async () => { await Promise.resolve() })

  // 文案必须说清「仍未确认」，不能给「服务器没收到，可以放心重试」这种确定性结论
  expect(host.textContent).toContain('还查不到')
  expect(host.textContent).toContain('同一个请求键会被认作同一笔')
  expect(host.textContent).not.toContain('可以放心重试')
  // 「查询上次结果」仍在：未确认状态没被清掉，用户可继续查
  expect(button(host, '查询上次结果')).toBeTruthy()

  // 原样重提走的是同一个请求键（服务端据此认作同一笔，不会重复入账）
  fixture.failWith = null
  await act(async () => button(host, '创建').click())
  expect(fixture.calls).toHaveLength(2)
  expect(fixture.calls[1].requestKey).toBe(fixture.calls[0].requestKey)
  await act(async () => root.unmount())
})

it('★ 回执明确 failed 才算确定失败：换新请求键再重试', async () => {
  const { host, root } = await mount()
  await fillValid(host)
  fixture.failWith = Object.assign(new Error('Network Error'), { code: 'NETWORK_ERROR' })
  await act(async () => button(host, '创建').click())
  const firstKey = fixture.calls[0].requestKey

  fixture.receiptStatus = 'failed'
  await act(async () => button(host, '查询上次结果').click())
  await act(async () => { await Promise.resolve() })
  expect(host.textContent).toContain('可以放心重试')

  fixture.failWith = null
  await act(async () => button(host, '创建').click())
  expect(fixture.calls.at(-1)!.requestKey).not.toBe(firstKey)
  await act(async () => root.unmount())
})

it('未选借方科目时拦住提交：不发请求并就地说明缺什么', async () => {
  const { host, root } = await mount()
  await setField(field(host, '输入供应商名称'), 'Smoke供应商')
  await setField(field(host, '本次应付金额'), '120.5')
  await act(async () => button(host, '创建').click())
  expect(fixture.calls).toHaveLength(0)
  expect(host.textContent).toContain('请选择借方科目')
  await act(async () => root.unmount())
})

it('金额为空/为零时拦住提交', async () => {
  const { host, root } = await mount()
  await fillValid(host)
  await setField(field(host, '本次应付金额'), '')
  await act(async () => button(host, '创建').click())
  expect(fixture.calls).toHaveLength(0)
  expect(host.textContent).toContain('金额必须大于 0')
  await act(async () => root.unmount())
})

it('合法录入带上所选科目与结算方式，选中后显示科目名称', async () => {
  const { host, root } = await mount()
  await fillValid(host, '6601')
  // 下拉里是 code+name，选中后要把「将生成的分录」写清楚，财务才能核对
  expect(host.textContent).toContain('将生成分录：借 6601 销售费用 / 贷 2202 应付账款')
  await act(async () => button(host, '创建').click())
  const call = fixture.calls.at(-1)!
  expect(call.payload).toMatchObject({
    type: 1, partyName: 'Smoke供应商', totalAmount: 120.5,
    settlementType: 1, debitAccountCode: '6601',
  })
  expect(fixture.toasts.at(-1)).toContain('已创建')
  expect(closeCount).toBe(1)
  await act(async () => root.unmount())
})

it('★ 请求键在重试时保持不变、重新打开才换新（连点/断网重试不落两条账款）', async () => {
  const { host, root } = await mount()
  await fillValid(host)
  // 第一次失败（如科目刚被停用）：键必须留下，重试要能被识别为同一笔
  fixture.failWith = '借方科目「销售费用」已停用，不能用于新应付'
  await act(async () => button(host, '创建').click())
  expect(host.textContent).toContain('已停用')            // 校验错误留在弹窗里，不是一闪而过的 toast
  expect(closeCount).toBe(0)                              // 失败不关窗，否则财务看不到原因
  fixture.failWith = null
  await act(async () => button(host, '创建').click())
  expect(fixture.calls).toHaveLength(2)
  expect(fixture.calls[1].requestKey).toBe(fixture.calls[0].requestKey)

  // 成功后重新打开是另一笔：必须换新键，否则会被后端当成上一笔的重放、直接返回旧结果
  const firstKey = fixture.calls[0].requestKey
  await act(async () => root.render(
    <QueryClientProvider client={qc}><CreateManualPayableDialog open={false} onClose={() => {}} /></QueryClientProvider>,
  ))
  await act(async () => root.render(
    <QueryClientProvider client={qc}><CreateManualPayableDialog open onClose={() => { closeCount++ }} /></QueryClientProvider>,
  ))
  await act(async () => { await Promise.resolve() })
  await fillValid(host)
  await act(async () => button(host, '创建').click())
  expect(fixture.calls.at(-1)!.requestKey).not.toBe(firstKey)
  await act(async () => root.unmount())
})

it('切换结算方式时到期日跟着走，改成月结即 30 天后（手工改过则不再覆盖）', async () => {
  const { host, root } = await mount()
  const due = () => host.querySelector<HTMLInputElement>('[data-testid="due-date"]')!.value
  const cashDue = due()
  await setField(selects(host)[0], '2')
  const monthlyDue = due()
  expect(monthlyDue).not.toBe(cashDue)
  // 只比两个 YYYY-MM-DD 的 UTC 日差，不碰宿主时区（组件内部走的是北京原语）
  expect((Date.parse(monthlyDue) - Date.parse(cashDue)) / 86400000).toBe(30)
  await setField(selects(host)[0], '1')
  expect(due()).toBe(cashDue)
  await act(async () => root.unmount())
})

it('金额按四位精度录入（金额/单价四位、数量两位）', async () => {
  const { host, root } = await mount()
  const amountInput = field(host, '本次应付金额')
  expect(amountInput.getAttribute('step')).toBe('0.0001')
  await fillValid(host)
  await setField(amountInput, '8.3333')
  await act(async () => button(host, '创建').click())
  expect(fixture.calls.at(-1)!.payload.totalAmount).toBe(8.3333)
  await act(async () => root.unmount())
})
