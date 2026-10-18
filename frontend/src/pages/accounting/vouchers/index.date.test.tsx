// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { AxiosAdapter } from 'axios'
import client from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { useCompanyStore } from '@/store/companyStore'
import { PERMISSIONS as P } from '@/lib/permission-codes'
import type { Voucher } from '@/types/accounting'
import Page from './index'

// 只替换 Axios 传输；页面、hooks、Query、DataTable 和详情 Dialog 均使用真实实现。
const oldAdapter = client.defaults.adapter
const oldCompanyId = useCompanyStore.getState().companyId
const unknown: string[] = [], requests: string[] = []
let root: Root, host: HTMLDivElement, qc: QueryClient, voucher: Voucher

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  unknown.length = 0; requests.length = 0
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  useAuthStore.setState({ token: 'offline', user: { id: 9, username: 'date-fixture', realName: '日期验收', roleId: 2, roleName: '只读', permissions: [P.ACCOUNTING_VOUCHER_VIEW] } })
  useCompanyStore.setState({ companyId: 2 })
  voucher = {
    id: 901, voucherNo: '记-日期回归-0001', voucherDate: '', period: '202610',
    sourceType: 'manual', sourceTypeName: '手工凭证', sourceId: null, sourceNo: null,
    summary: '合成日期回归凭证', totalDebit: 100, totalCredit: 100,
    status: 1, isReversal: 0, reversedId: null, createdAt: '2026-10-16T00:00:00+08:00',
    entries: [
      { id: 1, lineNo: 1, accountId: 33, accountCode: '1001', accountName: '库存现金', direction: 1, amount: 100, summary: null, auxType: 0, auxId: null, auxName: null },
      { id: 2, lineNo: 2, accountId: 34, accountCode: '1002', accountName: '银行存款', direction: 2, amount: 100, summary: null, auxType: 0, auxId: null, auxName: null },
    ],
  }
  client.defaults.adapter = (async config => {
    const route = config.url || ''; requests.push(`${config.method} ${route}`)
    let data: unknown
    if (config.method === 'get' && route === '/accounting/vouchers/reconciliation') data = { items: [] }
    else if (config.method === 'get' && route === '/accounting/vouchers') data = { list: [voucher], pagination: { total: 1, page: 1, pageSize: 20 } }
    else if (config.method === 'get' && route === '/accounting/vouchers/901') data = voucher
    else if (config.method === 'get' && route === '/accounting/accounts/flat?onlyLeaf=1&onlyActive=1') data = []
    else { unknown.push(`${config.method} ${route}`); throw Error(`Unexpected offline API ${config.method} ${route}`) }
    return { status: 200, statusText: 'OK', headers: {}, config, data: { success: true, data } }
  }) satisfies AxiosAdapter
})

afterEach(async () => {
  await act(async () => root.unmount())
  qc.clear(); host.remove(); client.defaults.adapter = oldAdapter
  useAuthStore.setState({ user: null, token: null }); useCompanyStore.setState({ companyId: oldCompanyId })
  localStorage.clear(); expect(unknown).toEqual([])
})

async function settleUntil(ready: () => boolean) {
  for (let i = 0; i < 50 && !ready(); i++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
  }
  expect(ready(), '真实页面查询应在离线传输返回后完成').toBe(true)
}

it.each([
  { name: '纯日期保持原业务日', wireDate: '2026-10-16', expected: '2026-10-16' },
  { name: '北京午夜的 ISO 回包保持北京业务日', wireDate: '2026-10-15T16:00:00.000Z', expected: '2026-10-16' },
  { name: '月初北京午夜不显示上月末', wireDate: '2026-10-31T16:00:00.000Z', expected: '2026-11-01' },
])('列表与真实详情：$name', async ({ wireDate, expected }) => {
  voucher.voucherDate = wireDate
  voucher.period = expected.slice(0, 7).replace('-', '')
  await act(async () => root.render(React.createElement(MemoryRouter, null,
    React.createElement(QueryClientProvider, { client: qc }, React.createElement(Page)))))
  await settleUntil(() => host.textContent?.includes(voucher.voucherNo) === true)
  const row = [...host.querySelectorAll('tbody tr')].find(item => item.textContent?.includes(voucher.voucherNo))!
  expect(row).toBeDefined()
  expect.soft(row.querySelectorAll('td')[1].textContent).toBe(expected)

  const view = [...row.querySelectorAll('button')].find(button => button.textContent?.trim() === '查看')!
  expect(view).toBeDefined()
  await act(async () => view.click())
  await settleUntil(() => document.querySelector('[role="dialog"]')?.textContent?.includes(voucher.summary!) === true)
  const dialog = document.querySelector('[role="dialog"]')!
  const dateLabel = [...dialog.querySelectorAll('span')].find(span => span.textContent === '日期：')!
  expect(dateLabel).toBeDefined()
  expect(requests).toContain('get /accounting/vouchers/901')
  expect(dateLabel.parentElement?.textContent).toBe(`日期：${expected}`)
})
