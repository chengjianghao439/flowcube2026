// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, within } from '@testing-library/dom'
import { afterEach, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/store/authStore'
import { PERMISSIONS as P } from '@/lib/permission-codes'
import FixedAssetsPage from './index'

const api = vi.hoisted(() => ({ list: vi.fn(), run: vi.fn(), create: vi.fn() }))
vi.mock('@/api/fixedAssets', () => ({ listFixedAssetsApi: api.list, runDepreciationApi: api.run, createFixedAssetApi: api.create, disposeFixedAssetApi: vi.fn() }))

function setPermissions(permissions: string[]) {
  useAuthStore.setState({ user: { id: 9, username: 'fixture', realName: '合成用户', roleId: 5, roleName: '合成角色', permissions } })
}

afterEach(() => useAuthStore.setState({ user: null }))

test.each([false, true])('固定资产读取和导出保留，写操作按凭证管理权限显示 (%s)', async canManage => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  setPermissions([P.ACCOUNTING_LEDGER_VIEW, ...(canManage ? [P.ACCOUNTING_VOUCHER_MANAGE] : [])])
  api.list.mockResolvedValue({
    list: [
      { id: 1, assetNo: 'FA1', assetName: '在用合成资产', status: 1 },
      { id: 2, assetNo: 'FA2', assetName: '提足合成资产', status: 2 },
      { id: 3, assetNo: 'FA3', assetName: '已处置合成资产', status: 3 },
    ],
    pagination: { total: 3 },
  })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  try {
    await act(async () => root.render(<QueryClientProvider client={cache}><FixedAssetsPage /></QueryClientProvider>))
    await act(async () => new Promise(resolve => setTimeout(resolve, 0)))
    const page = within(host)
    await vi.waitFor(() => expect(page.getByText('在用合成资产')).toBeTruthy())
    expect(page.getByRole('button', { name: '导出 Excel' })).toBeTruthy()
    expect(Boolean(page.queryByRole('button', { name: '新增资产' }))).toBe(canManage)
    expect(Boolean(page.queryByRole('button', { name: '计提本月折旧' }))).toBe(canManage)
    expect(page.queryAllByRole('button', { name: '处置' })).toHaveLength(canManage ? 2 : 0)
    expect(Boolean(page.queryByRole('columnheader', { name: '操作' }))).toBe(canManage)
  } finally {
    await act(async () => root.unmount())
    cache.clear()
    host.remove()
  }
})

test('计提本月折旧提交北京时间的月份', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  setPermissions([P.ACCOUNTING_LEDGER_VIEW, P.ACCOUNTING_VOUCHER_MANAGE])
  // 保留真实定时器，只固定 Date 构造的当前时间。
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-31T16:05:00Z'))
  api.list.mockResolvedValue({ list: [], pagination: { total: 0 } })
  api.run.mockResolvedValue({ ran: 0, vouchers: [] })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const qc = new QueryClient()
  try {
    await act(async () => root.render(<QueryClientProvider client={qc}><FixedAssetsPage /></QueryClientProvider>))
    const button = [...host.querySelectorAll('button')].find(b => b.textContent === '计提本月折旧')!
    await act(async () => button.click())
    expect(api.run.mock.calls[0]?.[0]).toBe('202611')
  } finally {
    await act(async () => root.unmount())
    qc.clear()
    host.remove()
    vi.useRealTimers()
    vi.restoreAllMocks()
  }
})


test('固定资产原值、残值率和月数无效时提示并阻止提交', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  setPermissions([P.ACCOUNTING_LEDGER_VIEW, P.ACCOUNTING_VOUCHER_MANAGE])
  api.list.mockResolvedValue({ list: [], pagination: { total: 0 } })
  api.create.mockResolvedValue({ id: 7, assetNo: 'FA7' })
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  const qc = new QueryClient()
  try {
    await act(async () => root.render(<QueryClientProvider client={qc}><FixedAssetsPage /></QueryClientProvider>))
    await act(async () => within(host).getByRole('button', { name: '新增资产' }).click())
    const dialog = within(within(document.body).getByRole('dialog', { name: '新增固定资产' }))
    const create = dialog.getByRole('button', { name: '创建' }) as HTMLButtonElement
    const change = (element: HTMLElement, value: string) => act(async () => { fireEvent.change(element, { target: { value } }) })
    await change(dialog.getByRole('textbox', { name: '资产名称' }), '合成资产')
    const cases = [
      { name: '原值（元）', bad: '-100', good: '100.01', hint: '原值必须大于 0' },
      { name: '残值率', bad: '0.99995', good: '0.05', hint: '残值率必须在 0 至 0.9999 之间' },
      { name: '使用年限（月）', bad: '601', good: '36', hint: '使用年限必须为 1 至 600 的整数月' },
    ]
    for (const { name, bad, good, hint } of cases) {
      const field = dialog.getByRole('spinbutton', { name })
      await change(field, bad)
      expect(create.disabled).toBe(true)
      expect(dialog.getByText(hint)).toBeTruthy()
      await act(async () => create.click())
      expect(api.create).not.toHaveBeenCalled()
      await change(field, good)
    }
    const rate = dialog.getByRole('spinbutton', { name: '残值率' })
    Object.defineProperty(rate, 'validity', { configurable: true, value: { badInput: true } })
    await act(async () => { fireEvent.input(rate, { target: { value: '' } }) })
    expect(create.disabled).toBe(true)
    expect(dialog.getByText('残值率必须在 0 至 0.9999 之间')).toBeTruthy()
    Reflect.deleteProperty(rate, 'validity')
    await act(async () => { fireEvent.input(rate, { target: { value: '0.05' } }) })
    expect(create.disabled).toBe(false)
    await act(async () => create.click())
    expect(api.create.mock.calls[0]?.[0]).toMatchObject({ originalCost: 100.01, residualRate: 0.05, usefulMonths: 36 })
  } finally {
    await act(async () => root.unmount())
    qc.clear()
    host.remove()
  }
})
