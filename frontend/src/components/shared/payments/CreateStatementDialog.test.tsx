// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { CreateStatementDialog } from './CreateStatementDialog'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const fixture = vi.hoisted(() => ({
  candidates: [
    { id: 21, orderNo: 'PC001', totalAmount: 50, paidAmount: 0, balance: 50, status: 1, createdAt: '2026-09-24' },
    { id: 22, orderNo: 'PC002', totalAmount: 30, paidAmount: 0, balance: 30, status: 1, createdAt: '2026-09-24' },
  ],
  submitted: [] as Array<{ type: number; recordIds: number[] }>,
  queryKeys: [] as unknown[][],
}))
vi.mock('@/hooks/useActiveWorkspaceTab', () => ({ useActiveWorkspaceTab: () => true }))
vi.mock('@/components/shared/AppDialog', () => ({ AppDialog: ({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) => <div>{children}{footer}</div> }))
vi.mock('@/components/shared/DatePicker', () => ({ DatePicker: () => <div /> }))
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ enabled, queryKey }: { enabled: boolean; queryKey: unknown[] }) => {
    fixture.queryKeys.push(queryKey)
    return { data: enabled ? fixture.candidates : undefined, isFetching: false }
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
  const party = host.querySelector<HTMLInputElement>('input[placeholder="输入供应商名称"],input[placeholder="输入客户名称"]')!
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(party, 'Smoke供应商')
    party.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => Array.from(host.querySelectorAll('button')).find(b => b.textContent === '查待对账账款')!.click())
  return { host, root }
}
afterEach(() => { hosts.splice(0).forEach(h => h.remove()); fixture.submitted.length = 0; fixture.queryKeys.length = 0 })

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
  await act(async () => root.unmount())
  fixture.candidates = [
    { id: 21, orderNo: 'PC001', totalAmount: 50, paidAmount: 0, balance: 50, status: 1, createdAt: '2026-09-24' },
    { id: 22, orderNo: 'PC002', totalAmount: 30, paidAmount: 0, balance: 30, status: 1, createdAt: '2026-09-24' },
  ]
})
