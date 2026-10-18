// @vitest-environment jsdom
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { InternalAxiosRequestConfig } from 'axios'
import { StatementPanel, type StatementPanelHandle } from './StatementPanel'
import type { ReconciliationStatement } from '@/api/payments'
import api from '@/api/client'
import { useAuthStore } from '@/store/authStore'

const calls = vi.hoisted(() => ({ list: vi.fn(), confirm: vi.fn(), unlock: vi.fn() }))
vi.mock('@/api/payments', async original => ({
  ...await original<typeof import('@/api/payments')>(),
  getStatementsApi: calls.list, confirmStatementApi: calls.confirm, unlockStatementApi: calls.unlock,
}))
// 独立明细和新建业务不在列表读取修复范围；禁止因此调用业务端点。
vi.mock('@/components/shared/payments/CreateStatementDialog', () => ({ CreateStatementDialog: () => null }))
vi.mock('@/components/shared/payments/StatementDetailDialog', () => ({ StatementDetailDialog: () => null }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

let host: HTMLDivElement, root: Root, cache: QueryClient
const adapter = api.defaults.adapter
const blockedTransport = vi.fn(async (config: InternalAxiosRequestConfig) => {
  throw new Error(`对账列表测试禁止网络：${config.url}`)
})
const statement = (type: 1 | 2, id: number, status: 1 | 2 | 3, settledAmount = 0): ReconciliationStatement => ({
  id, statementNo: `ST-SYN-${id}`, type, partyName: `合成${type === 1 ? '供应商' : '客户'}`,
  periodStart: '2026-10-01', periodEnd: '2026-10-15', totalAmount: 100, settledAmount,
  balance: 100 - settledAmount, status, statusName: { 1: '草稿', 2: '已确认', 3: '已核销' }[status],
  itemCount: 2, createdAt: '2026-10-15T02:00:00Z',
})
const success = (list: ReconciliationStatement[] = []) => ({ list, pagination: { total: list.length } })
const failures = [
  { name: '403', error: { response: { status: 403, data: { message: '合成对账权限已失效' } } }, message: '合成对账权限已失效' },
  { name: '500', error: { response: { status: 500, data: { message: '合成对账读取失败' } } }, message: '合成对账读取失败' },
]
const button = (scope: ParentNode, text: string) => [...scope.querySelectorAll('button')].find(b => b.textContent?.trim() === text)
const row = (id: number) => [...host.querySelectorAll('tbody tr')].find(node => node.textContent?.includes(`ST-SYN-${id}`))!
const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) }) }
async function click(text: string, scope: ParentNode = host) {
  const node = button(scope, text)
  expect(node, text).toBeTruthy()
  await act(async () => node!.click())
  await flush()
}
async function input(node: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value)
    node.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function menu(id: number) {
  const trigger = row(id).querySelector<HTMLButtonElement>('[aria-label="更多操作"]')!
  await act(async () => trigger.click()); await flush()
  const content = document.querySelector<HTMLElement>('[role="menu"]')!
  expect(content).toBeTruthy()
  return content
}
async function closeMenu() {
  await act(async () => document.querySelector('[role="menu"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  await flush()
}
async function render(type: 1 | 2, hideToolbar = false) {
  const panel = createRef<StatementPanelHandle>()
  await act(async () => root.render(<QueryClientProvider client={cache}>
    <MemoryRouter><StatementPanel ref={panel} type={type} hideToolbar={hideToolbar} /></MemoryRouter>
  </QueryClientProvider>))
  await flush()
  return panel
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  calls.list.mockReset(); calls.confirm.mockReset().mockResolvedValue({}); calls.unlock.mockReset().mockResolvedValue({})
  blockedTransport.mockClear(); api.defaults.adapter = blockedTransport
  useAuthStore.setState({ user: { roleId: 1, permissions: [] } as never })
  cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  cache.clear(); host.remove(); api.defaults.adapter = adapter
  useAuthStore.setState({ user: null, token: null }); localStorage.clear()
  expect(blockedTransport).not.toHaveBeenCalled()
})

test.each([1, 2] as const)('%s 对账首读失败显示错误及同条件重试，成功空表才呈现空态', async type => {
  calls.list.mockRejectedValue(new Error('合成对账首读失败'))
  await render(type)
  expect(host.textContent).toContain('合成对账首读失败')
  expect(host.textContent).not.toContain('暂无数据')
  const applied = calls.list.mock.lastCall?.[0]
  calls.list.mockResolvedValue(success())
  await click('重试')
  expect(calls.list.mock.lastCall?.[0]).toEqual(applied)
  expect(host.textContent).not.toContain('合成对账首读失败')
  expect(host.textContent).toContain('暂无数据')
  expect(calls.confirm).not.toHaveBeenCalled(); expect(calls.unlock).not.toHaveBeenCalled()
})

for (const failure of failures) test.each([1, 2] as const)(`%s 对账缓存后${failure.name}隐藏旧账单及确认/解锁，原查询重试采用当前资格`, async type => {
  calls.list.mockResolvedValue(success([statement(type, 11, 1), statement(type, 12, 2)]))
  await render(type)
  expect(button(row(11), '确认')).toBeTruthy()
  expect((await menu(12)).textContent).toContain('解锁')
  await closeMenu()
  const applied = calls.list.mock.lastCall?.[0]
  const queryKey = cache.getQueryCache().findAll({ queryKey: ['payment-statements'] })[0].queryKey
  calls.list.mockRejectedValue(failure.error)
  await act(async () => { await cache.refetchQueries({ queryKey: ['payment-statements'] }) }); await flush()
  expect(host.textContent).toContain(failure.message)
  expect(host.textContent).not.toContain('ST-SYN-')
  expect(host.textContent).not.toContain('暂无数据')
  expect(button(host, '确认')).toBeUndefined()
  expect(document.querySelector('[role="menu"]')).toBeNull()
  expect(host.querySelector('[aria-label="更多操作"]')).toBeNull()

  // 相同单据已发生核销：恢复读取不能重新提供旧确认/解锁。
  calls.list.mockResolvedValue(success([statement(type, 11, 2, 40), statement(type, 12, 3, 100)]))
  await click('重试')
  expect(calls.list.mock.lastCall?.[0]).toEqual(applied)
  expect(cache.getQueryCache().findAll({ queryKey: ['payment-statements'] })[0].queryKey).toEqual(queryKey)
  expect(host.textContent).not.toContain(failure.message)
  expect(row(11).textContent).toContain('40.00')
  expect(button(host, '确认')).toBeUndefined()
  for (const id of [11, 12]) {
    expect((await menu(id)).textContent).not.toContain('解锁')
    await closeMenu()
  }
  expect(calls.confirm).not.toHaveBeenCalled(); expect(calls.unlock).not.toHaveBeenCalled()
})

test.each([1, 2] as const)('%s 对账读取恢复后的草稿确认与未核销解锁沿原单据ID，核销后不可解锁', async type => {
  calls.list.mockRejectedValue(new Error('合成读取暂不可用'))
  await render(type)
  calls.list.mockResolvedValue(success([statement(type, 21, 1), statement(type, 22, 2), statement(type, 23, 2, 10), statement(type, 24, 3, 100)]))
  await click('重试')
  await click('确认', row(21))
  expect(calls.confirm.mock.calls).toEqual([[21]])
  const unlockMenu = await menu(22)
  const unlock = [...unlockMenu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(node => node.textContent === '解锁')!
  expect(unlock).toBeTruthy()
  await act(async () => unlock.click()); await flush()
  expect(calls.unlock.mock.calls).toEqual([[22]])
  for (const id of [23, 24]) {
    expect((await menu(id)).textContent).not.toContain('解锁')
    await closeMenu()
  }
})

test('对账失败与重试保留已应用筛选和未应用草稿，父工具条查询上下文不变', async () => {
  calls.list.mockResolvedValue(success([statement(2, 31, 1)]))
  const panel = await render(2, true)
  await act(async () => panel.current!.openQuery()); await flush()
  let dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
  await input(dialog.querySelector<HTMLInputElement>('[placeholder="输入对账单号"]')!, 'ST-APPLIED')
  await click('查询', dialog)
  expect(calls.list.mock.lastCall?.[0]).toMatchObject({ type: '2', statementNo: 'ST-APPLIED' })
  const applied = calls.list.mock.lastCall?.[0]
  await act(async () => panel.current!.openQuery()); await flush()
  dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
  const draft = dialog.querySelector<HTMLInputElement>('[placeholder="输入对账单号"]')!
  await input(draft, 'ST-DRAFT')
  calls.list.mockRejectedValue(failures[1].error)
  await act(async () => { await cache.refetchQueries({ queryKey: ['payment-statements'] }) }); await flush()
  expect(host.textContent).toContain(failures[1].message)
  expect(draft.value).toBe('ST-DRAFT')
  calls.list.mockResolvedValue(success([statement(2, 31, 2)]))
  await click('重试')
  expect(calls.list.mock.lastCall?.[0]).toEqual(applied)
  expect(draft.value).toBe('ST-DRAFT')
  await click('取消', dialog)
  expect(host.textContent).toContain('ST-APPLIED')
  expect(host.textContent).not.toContain('ST-DRAFT')
})
