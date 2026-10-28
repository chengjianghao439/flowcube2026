// @vitest-environment jsdom
import { act, type ComponentType } from 'react'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import { retentionHarness } from './workspaceRetention'
import { clearReadFixtures, lastRead, readCalls, readData, writeCalls } from './readOnlyApi'
import AccountsPage from '@/pages/finance/accounts'
import TransactionsPage from '@/pages/finance/transactions'
import ExpensesPage from '@/pages/finance/expenses'
import { todayYmd } from '@/lib/dateTime'

const routes = vi.hoisted(() => ({ values: {} as Record<string, ComponentType> }))
vi.mock('@/router/routeRegistry', async original => ({ ...await original<typeof import('@/router/routeRegistry')>(), resolveRouteComponent: (path: string) => routes.values[path] || null }))
vi.mock('@/api/finance', async original => (await import('./readOnlyApi')).mockReadApi(await original(), 'finance'))
const h = retentionHarness()
beforeEach(() => {
  clearReadFixtures()
  routes.values = { '/finance/accounts': AccountsPage, '/finance/transactions': TransactionsPage, '/finance/expenses': ExpensesPage }
  for (const op of ['getAccountsApi', 'getAccountTransactionsApi', 'getExpenseClaimsApi']) readData.set(`finance.${op}`, { list: [], pagination: { total: 0 } })
  readData.set('finance.getActiveAccountsApi', [{ id: 7, name: '合成账户' }])
})
afterEach(() => expect(writeCalls).toEqual([]))

const cases = [
  { page: '/finance/accounts', op: 'getAccountsApi', placeholder: '编码 / 名称 / 账号', dates: [] },
  { page: '/finance/transactions', op: 'getAccountTransactionsApi', placeholder: '关联单号 / 往来单位', dates: [todayYmd(), todayYmd()] },
  { page: '/finance/expenses', op: 'getExpenseClaimsApi', placeholder: '单号 / 事由 / 申请人', dates: [todayYmd(), todayYmd()] },
]
for (const c of cases) test(`${c.page}：关键字直达、取消不应用、重开复原、重置回本页默认日期`, async () => {
  await h.render(c.page)
  const applied = structuredClone(lastRead('finance', c.op)!.args[0])
  const trigger = h.buttons().find(button => button.textContent === '查询')!
  act(() => trigger.focus())
  await h.click('查询')
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!
  const keyword = () => dialog().querySelector<HTMLInputElement>(`input[placeholder="${c.placeholder}"]`)!
  // 共用查询壳优先文本条件，日期查询不应因此自动展开日历。
  expect(document.activeElement).toBe(keyword())
  expect(document.querySelector('.fc-date-menu')).toBeNull()
  const readCount = readCalls.filter(call => call.operation === c.op).length
  await h.input(keyword(), '未应用条件')
  await h.click('取消', dialog())
  expect(readCalls.filter(call => call.operation === c.op)).toHaveLength(readCount)
  expect(lastRead('finance', c.op)!.args[0]).toEqual(applied)
  expect(document.activeElement).toBe(trigger)

  await h.click('查询')
  expect(keyword().value).toBe('')
  await h.input(keyword(), '已应用条件')
  await h.click('查询', dialog())
  expect(lastRead('finance', c.op)!.args[0]).toEqual({ ...applied as object, keyword: '已应用条件' })
  await h.click('查询')
  expect(keyword().value).toBe('已应用条件')
  const appliedCount = readCalls.filter(call => call.operation === c.op).length
  await h.click('重置', dialog())
  expect(keyword().value).toBe('')
  expect([...dialog().querySelectorAll<HTMLInputElement>('.fc-date-picker input')].map(input => input.value)).toEqual(c.dates)
  expect(readCalls.filter(call => call.operation === c.op)).toHaveLength(appliedCount)
  await h.click('取消', dialog())
  await h.click('查询')
  expect(keyword().value).toBe('已应用条件')
  await h.click('重置', dialog())
  await h.click('查询', dialog())
  // 回到原条件时 QueryClient 可命中缓存；显式重读后核原 API 参数。
  await act(async () => { await h.cache.invalidateQueries() })
  await h.settle()
  expect(lastRead('finance', c.op)!.args[0]).toEqual({
    ...applied as object, keyword: undefined,
  })
})

for (const c of cases) test(`${c.page}：完整条件沿原参数应用，后台读取和切标签保留未应用草稿`, async () => {
  await h.render(c.page)
  const original = structuredClone(lastRead('finance', c.op)!.args[0])
  await h.click('查询')
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!
  const keyword = () => dialog().querySelector<HTMLInputElement>(`input[placeholder="${c.placeholder}"]`)!
  await h.input(keyword(), 'SYN条件')
  let conditions: object
  if (c.page === '/finance/accounts') {
    await h.select('全部', '现金')
    await h.select('全部', '停用')
    conditions = { keyword: 'SYN条件', type: '2', isActive: '0' }
  } else {
    if (c.page === '/finance/transactions') {
      await h.select('全部账户', '合成账户')
      await h.select('全部', '费用报销')
      await h.select('全部', '支出')
      conditions = { keyword: 'SYN条件', accountId: 7, bizType: '3', direction: '2' }
    } else {
      await h.select('全部', '待审批')
      await h.input(dialog().querySelector<HTMLInputElement>('[placeholder="最小金额"]')!, '12.34')
      await h.input(dialog().querySelector<HTMLInputElement>('[placeholder="最大金额"]')!, '56.78')
      conditions = { keyword: 'SYN条件', status: '2', minAmount: '12.34', maxAmount: '56.78' }
    }
    const dates = [...dialog().querySelectorAll<HTMLInputElement>('.fc-date-picker input')]
    for (const [index, value] of ['2026-09-01', '2026-09-30'].entries()) {
      await h.input(dates[index], value)
      act(() => dates[index].dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
    }
    conditions = { ...conditions, startDate: '2026-09-01', endDate: '2026-09-30' }
  }
  await h.click('查询', dialog())
  const applied = { ...original as object, ...conditions }
  expect(lastRead('finance', c.op)!.args[0]).toEqual(applied)
  await h.click('查询')
  await h.input(keyword(), '后台读取期间的草稿')
  await act(async () => { await h.cache.invalidateQueries() })
  await h.settle()
  expect(keyword().value).toBe('后台读取期间的草稿')
  expect(lastRead('finance', c.op)!.args[0]).toEqual(applied)
  await h.go('/dashboard')
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  await h.go(c.page)
  expect(keyword().value).toBe('后台读取期间的草稿')
  await h.click('取消', dialog())
  await h.click('查询')
  expect(keyword().value).toBe('SYN条件')
  if (c.page !== '/finance/accounts') {
    expect([...dialog().querySelectorAll<HTMLInputElement>('.fc-date-picker input')].map(input => input.value)).toEqual(['2026-09-01', '2026-09-30'])
  }
  await h.click('重置', dialog())
  expect(keyword().value).toBe('')
  expect([...dialog().querySelectorAll<HTMLInputElement>('.fc-date-picker input')].map(input => input.value)).toEqual(c.dates)
  expect(lastRead('finance', c.op)!.args[0]).toEqual(applied)
  await h.click('取消', dialog())
})
