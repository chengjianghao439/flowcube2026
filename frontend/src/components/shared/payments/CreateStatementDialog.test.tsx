// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CreateStatementDialog } from './CreateStatementDialog'
import { useAuthStore } from '@/store/authStore'

beforeEach(() => useAuthStore.setState({ user: { roleId: 5, permissions: ['payment.execute'] } as never }))
afterEach(() => useAuthStore.setState({ user: null }))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const fixture = vi.hoisted(() => ({
  candidates: [
    { id: 21, orderNo: 'PC001', totalAmount: 50, paidAmount: 0, balance: 50, status: 1, createdAt: '2026-09-24' },
    { id: 22, orderNo: 'PC002', totalAmount: 30, paidAmount: 0, balance: 30, status: 1, createdAt: '2026-09-24' },
  ],
  isFetching: false,
  isPaused: false,
  isError: false,
  refetch: vi.fn(),
  submitted: [] as Array<{ type: number; recordIds: number[] }>,
  queryKeys: [] as unknown[][],
}))
vi.mock('@/hooks/useActiveWorkspaceTab', () => ({ useActiveWorkspaceTab: () => true }))
vi.mock('@/components/shared/AppDialog', () => ({ AppDialog: ({ description, children, footer }: { description?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) => <div><div className="fc-dialog-caption">{description}</div>{children}{footer}</div> }))
vi.mock('@/components/shared/DatePicker', () => ({ DatePicker: () => <div /> }))
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ enabled, queryKey }: { enabled: boolean; queryKey: unknown[] }) => {
    fixture.queryKeys.push(queryKey)
    return { data: enabled ? fixture.candidates : undefined, isFetching: fixture.isFetching, isPaused: fixture.isPaused, isError: fixture.isError, error: fixture.isError ? new Error('合成账款读取失败') : null, refetch: fixture.refetch }
  },
  useMutation: ({ mutationFn, onSuccess }: { mutationFn: () => Promise<unknown>; onSuccess: (result: unknown) => void }) => ({
    isPending: false,
    mutate: () => { void mutationFn().then(onSuccess) },
  }),
}))
vi.mock('@/api/payments', () => ({
  getStatementCandidatesApi: vi.fn(),
  createStatementApi: async (data: { type: number; recordIds: number[] }) => {
    fixture.submitted.push(data)
    return { id: 1, statementNo: 'SP001' }
  },
}))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn() } }))

const hosts: HTMLDivElement[] = []
async function mount(type: 1 | 2) {
  const host = document.createElement('div'); document.body.append(host); hosts.push(host)
  const root = createRoot(host)
  await act(async () => root.render(<CreateStatementDialog open onClose={() => {}} type={type} onCreated={() => {}} />))
  expect(host.querySelector('.fc-dialog-caption')?.textContent).toBe(`填写${type === 1 ? '供应商' : '客户'}与期间后点「查待对账账款」`)
  expect(host.textContent?.split('与期间后点「查待对账账款」')).toHaveLength(2)
  expect(host.textContent).not.toContain('选择往来方、账期与本次对账的账款。')
  const party = host.querySelector<HTMLInputElement>('input[placeholder="输入供应商名称"],input[placeholder="输入客户名称"]')!
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(party, 'Smoke供应商')
    party.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => Array.from(host.querySelectorAll('button')).find(b => b.textContent === '查待对账账款')!.click())
  expect(host.querySelector('.fc-dialog-caption')?.textContent).toBe('选择往来方、账期与本次对账的账款。')
  return { host, root }
}
afterEach(() => { hosts.splice(0).forEach(h => h.remove()); fixture.submitted.length = 0; fixture.queryKeys.length = 0; fixture.isFetching = false; fixture.isPaused = false; fixture.isError = false; fixture.refetch.mockClear() })

for (const type of [1, 2] as const) {
  it(`对账类型 ${type} 用候选 id 建单，全选、取消选中后数量正确`, async () => {
    const { host, root } = await mount(type)
    expect(fixture.queryKeys.at(-1)?.[1]).toBe(type)
    const boxes = host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    expect(boxes).toHaveLength(2)
    await act(async () => boxes[0].click())
    expect(host.textContent).toContain('生成对账单（1 笔')
    await act(async () => boxes[1].click())
    await act(async () => boxes[0].click())
    await act(async () => Array.from(host.querySelectorAll('button')).find(b => b.textContent?.startsWith('生成对账单'))!.click())
    expect(fixture.submitted.at(-1)).toMatchObject({ type, recordIds: [22] })
    await act(async () => root.unmount())
  })
}

it('全选、取消全选及候选刷新后不会提交失效 ID', async () => {
  const { host, root } = await mount(1)
  const button = (text: string) => Array.from(host.querySelectorAll('button')).find(b => b.textContent === text)!
  await act(async () => button('全选').click())
  expect(host.textContent).toContain('生成对账单（2 笔')
  await act(async () => button('取消全选').click())
  expect((button('生成对账单（0 笔 / ¥0.00）') as HTMLButtonElement).disabled).toBe(true)
  await act(async () => button('全选').click())
  fixture.candidates = fixture.candidates.filter(x => x.id === 22)
  await act(async () => root.render(<CreateStatementDialog open onClose={() => {}} type={1} onCreated={() => {}} />))
  expect(host.textContent).toContain('已选 1 笔')
  await act(async () => button('生成对账单（1 笔 / ¥30.00）').click())
  expect(fixture.submitted.at(-1)?.recordIds).toEqual([22])
  fixture.isFetching = true
  await act(async () => root.render(<CreateStatementDialog open onClose={() => {}} type={1} onCreated={() => {}} />))
  expect(host.querySelector('.fc-dialog-caption')?.textContent).toBe('加载中…')
  expect(host.textContent?.split('加载中…')).toHaveLength(2)
  fixture.isFetching = false; fixture.candidates = []
  await act(async () => root.render(<CreateStatementDialog open onClose={() => {}} type={1} onCreated={() => {}} />))
  expect(host.querySelector('.fc-dialog-caption')?.textContent).toBe('该期间内没有未对账的月结账款')
  expect(host.textContent?.split('该期间内没有未对账的月结账款')).toHaveLength(2)
  expect(host.textContent).toContain('已选 0 笔 · 合计 ¥0.00')
  expect(button('生成对账单（0 笔 / ¥0.00）')).toBeDefined()
  expect((Array.from(host.querySelectorAll('button')).find(b => b.textContent?.startsWith('生成对账单')) as HTMLButtonElement).disabled).toBe(true)
  await act(async () => root.unmount())
  fixture.candidates = [
    { id: 21, orderNo: 'PC001', totalAmount: 50, paidAmount: 0, balance: 50, status: 1, createdAt: '2026-09-24' },
    { id: 22, orderNo: 'PC002', totalAmount: 30, paidAmount: 0, balance: 30, status: 1, createdAt: '2026-09-24' },
  ]
})


for (const type of [1, 2] as const) it(`未查询类型${type}先提示填写对象，不声称无账款`, async () => {
  const host = document.createElement('div'); document.body.append(host); hosts.push(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<CreateStatementDialog open onClose={() => {}} type={type} onCreated={() => {}} />))
    const body = host.querySelector('.fc-empty-state')
    expect(body?.textContent).toContain(`请先填写${type === 1 ? '供应商' : '客户'}与期间`)
    expect(host.textContent).not.toContain('该期间内没有未对账的月结账款')
    expect(host.textContent).toContain('尚未查询')
    expect(host.textContent).not.toContain('已选 0 笔')
    expect(host.textContent).not.toContain('¥0.00')
    expect(fixture.submitted).toEqual([])
  } finally { await act(async () => root.unmount()) }
})

it('候选读取失败与成功空结果独立，失败缓存不能选取或生成，重试只重读', async () => {
  const { host, root } = await mount(1)
  try {
    await act(async () => Array.from(host.querySelectorAll('button')).find(b => b.textContent === '全选')!.click())
    fixture.isError = true
    await act(async () => root.render(<CreateStatementDialog open onClose={() => {}} type={1} onCreated={() => {}} />))
    expect(host.textContent).toContain('待对账账款加载失败')
    expect(host.textContent).not.toContain('该期间内没有未对账的月结账款')
    expect(host.querySelectorAll('input[type="checkbox"]')).toHaveLength(0)
    expect(Array.from(host.querySelectorAll('button')).find(b => b.textContent === '全选')?.disabled).toBe(true)
    expect(Array.from(host.querySelectorAll('button')).find(b => b.textContent?.startsWith('生成对账单'))?.disabled).toBe(true)
    await act(async () => Array.from(host.querySelectorAll('button')).find(b => b.textContent === '重试')!.click())
    expect(fixture.refetch).toHaveBeenCalledOnce()
    expect(fixture.submitted).toEqual([])
  } finally { await act(async () => root.unmount()) }
})


for (const state of ['isFetching', 'isError', 'isPaused'] as const) it(`已勾选真实账款后${state}不投影为零，恢复读取后保留原勾选和金额`, async () => {
  const { host, root } = await mount(1)
  const generate = () => [...host.querySelectorAll('button')].find(button => button.textContent?.startsWith('生成对账单'))!
  const redraw = async () => { await act(async () => root.render(<CreateStatementDialog open onClose={() => {}} type={1} onCreated={() => {}} />)) }
  try {
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click())
    expect(host.textContent).toContain('已选 1 笔 · 合计 ¥50.00')
    expect(generate().textContent).toBe('生成对账单（1 笔 / ¥50.00）')
    expect(generate().disabled).toBe(false)

    fixture[state] = true
    await redraw()
    expect(host.textContent).toContain('已选账款待核对')
    expect(host.textContent).not.toContain('已选 0 笔')
    expect(host.textContent).not.toContain('¥0.00')
    expect(generate().textContent).not.toContain('0 笔')
    expect(generate().disabled).toBe(true)
    await act(async () => generate().click())
    expect(fixture.submitted).toEqual([])

    fixture[state] = false
    await redraw()
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true)
    expect(host.textContent).toContain('已选 1 笔 · 合计 ¥50.00')
    expect(generate().textContent).toBe('生成对账单（1 笔 / ¥50.00）')
    expect(generate().disabled).toBe(false)
    expect(fixture.submitted).toEqual([])
  } finally { await act(async () => root.unmount()) }
})
