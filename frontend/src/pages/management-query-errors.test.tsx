// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, within } from '@testing-library/dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { chooseSelectOption } from '@/test/chooseSelectOption'
import PeriodsPage from './accounting/periods'
import LedgerPage from './accounting/ledger'
import PdaDevicesPage from './settings/pda-devices'
import AbcPage from './stockcheck/abc'
import CarrierAccountsPage from './carrier-accounts'

const read = vi.hoisted(() => ({
  periods: vi.fn(), trial: vi.fn(), ledger: vi.fn(), devices: vi.fn(), warehouses: vi.fn(),
  abc: vi.fn(), rules: vi.fn(), coverage: vi.fn(), carriers: vi.fn(), binding: vi.fn(),
}))
vi.mock('@/api/accounting', () => ({ getPeriodsApi: read.periods, getTrialBalanceApi: read.trial, getAccountLedgerApi: read.ledger }))
vi.mock('@/api/stockcheck', () => ({ getAbcListApi: read.abc, getCycleRulesApi: read.rules, getCoverageApi: read.coverage }))
vi.mock('@/api/pda-devices', () => ({ listPdaDevicesApi: read.devices }))
vi.mock('@/api/warehouses', () => ({ getWarehousesActiveApi: read.warehouses }))
vi.mock('@/api/carriers', () => ({ getCarriersApi: read.carriers, getCarrierAccountBindingApi: read.binding }))
vi.mock('@/hooks/useActiveWorkspaceTab', () => ({ useActiveWorkspaceTab: () => true }))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }))
vi.mock('@/hooks/useGlobalPolicyWriteCapability', () => ({
  useGlobalPolicyWriteCapability: () => ({ allowed: true, isAllowed: () => true, isError: false }),
}))

let host: HTMLDivElement, root: Root, cache: QueryClient
const failure = new Error('合成读取失败')
const carrier = { id: 7, name: '合成快递', code: 'CAR007', platformCode: 'sf', isActive: true }
const carrierList = { list: [carrier], pagination: { page: 1, pageSize: 100, total: 1 } }
const carrierBinding = { carrierId: 7, carrierName: carrier.name, platformCode: 'sf', monthlyAccount: 'M001', revision: 'r1', products: [], shippingProduct: '', shippingDeliveryType: '', enabled: false, active: true }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.resetAllMocks()
  read.warehouses.mockResolvedValue([{ id: 7, name: '合成验证仓' }])
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})
afterEach(async () => {
  await act(async () => root.unmount())
  cache.clear()
  host.remove()
})
async function render(page: ReactNode, path = '/') {
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}><QueryClientProvider client={cache}>{page}</QueryClientProvider></MemoryRouter>))
}
async function click(element: HTMLElement) { await act(async () => element.click()) }
async function retry(scope: HTMLElement = host) {
  const retryButton = await within(scope).findByRole('button', { name: '重试' })
  await click(retryButton)
}
async function refresh(key: string[]) {
  await act(async () => { await cache.invalidateQueries({ queryKey: key }) })
}

it('会计期间首次失败和刷新失败均可原位重试，成功后才显示条数与结账操作', async () => {
  read.periods.mockRejectedValueOnce(failure).mockResolvedValue([{ period: '202611', closed: false, closingStatus: 'not_required' }])
  await render(<PeriodsPage />)
  await within(host).findByText('会计期间加载失败')
  expect(host.textContent).not.toContain('暂无数据')
  await retry()
  await within(host).findByRole('button', { name: '结账 2026 年 11 月' })
  read.periods.mockRejectedValueOnce(failure)
  await refresh(['accounting-periods'])
  await within(host).findByText('会计期间加载失败')
  expect(within(host).queryByRole('button', { name: '结账 2026 年 11 月' })).toBeNull()
  expect(host.textContent).not.toContain('共 1 个')
  await retry()
  await within(host).findByText('共 1 个')
})

it('试算与明细账分别重试原期间和科目，失败时不呈现空账、平衡或持续加载', async () => {
  const row = { accountId: 7, code: '1001', name: '合成现金科目', categoryName: '资产', isLeaf: true }
  read.trial.mockRejectedValueOnce(failure).mockResolvedValue({ list: [row], balanced: { period: true, closing: true } })
  read.ledger.mockRejectedValueOnce(failure).mockResolvedValue({ openingBalance: 25, closingBalance: 25, list: [] })
  await render(<LedgerPage />)
  await within(host).findByText('试算平衡表加载失败')
  expect(host.textContent).not.toContain('该期间暂无发生额')
  await retry()
  await click(await within(host).findByRole('button', { name: /合成现金科目/ }))
  const dialog = await within(document.body).findByRole('dialog')
  await within(dialog).findByText('明细账加载失败')
  expect(dialog.textContent).not.toContain('加载中')
  await retry(dialog)
  await within(dialog).findByText('期末余额')
  expect(read.ledger.mock.calls[1]).toEqual(read.ledger.mock.calls[0])
  await click(within(dialog).getByText('关闭', { selector: 'button' }))
  read.trial.mockRejectedValueOnce(failure)
  await refresh(['acct-ledger'])
  await within(host).findByText('试算平衡表加载失败')
  expect(within(host).queryByText('试算平衡')).toBeNull()
  expect(host.textContent).not.toContain(row.name)
})

it('设备列表查询保留关键词，首次失败和刷新失败不显示空态或旧设备操作', async () => {
  const device = { id: 7, deviceName: '合成手持机', deviceCode: 'PDA007', status: 'active' }
  read.devices.mockResolvedValueOnce({ list: [], pagination: { total: 0 } })
  await render(<PdaDevicesPage />)
  await within(host).findByText('共 0 台')
  read.devices.mockRejectedValueOnce(failure).mockResolvedValue({ list: [device], pagination: { total: 1 } })
  await click(within(host).getByRole('button', { name: '查询' }))
  const filters = within(within(document.body).getByRole('dialog', { name: '查询 PDA 设备' }))
  await act(async () => { fireEvent.change(filters.getByRole('textbox', { name: '设备名称或设备码' }), { target: { value: 'PDA007' } }) })
  await click(filters.getByRole('button', { name: '查询' }))
  await within(host).findByText('设备列表加载失败')
  expect(host.textContent).not.toContain('暂无数据')
  await retry()
  await within(host).findByText(device.deviceName)
  expect(read.devices.mock.lastCall?.[0]).toMatchObject({ keyword: 'PDA007' })
  read.devices.mockRejectedValueOnce(failure)
  await refresh(['pda-devices'])
  await within(host).findByText('设备列表加载失败')
  expect(within(host).queryByRole('button', { name: '编辑' })).toBeNull()
  expect(host.textContent).not.toContain('共 1 台')
})

it.each(['登记新设备', '编辑'])('设备%s时仓库选项读取失败可在弹窗重试，保留已输入名称', async action => {
  read.warehouses.mockRejectedValueOnce(failure).mockResolvedValue([{ id: 7, name: '合成验证仓' }])
  read.devices.mockResolvedValue({ list: [{ id: 1, deviceName: '合成手持机', deviceCode: 'PDA007', warehouseId: null, status: 'active' }], pagination: { total: 1 } })
  await render(<PdaDevicesPage />)
  await click(await within(host).findByRole('button', { name: action }))
  const dialog = await within(document.body).findByRole('dialog')
  await within(dialog).findByText('仓库选项加载失败')
  const name = within(dialog).getByRole<HTMLInputElement>('textbox', { name: '设备名称' })
  await act(async () => { fireEvent.change(name, { target: { value: '待登记的手持机' } }) })
  await retry(dialog)
  await vi.waitFor(() => expect(within(dialog).queryByText('仓库选项加载失败')).toBeNull())
  await chooseSelectOption(within(dialog).getByRole('combobox', { name: '所属仓库' }), '合成验证仓')
  expect(name.value).toBe('待登记的手持机')
})

it('分档仓库选项首次失败可重试，选仓后才读取该仓分档', async () => {
  read.warehouses.mockRejectedValueOnce(failure).mockResolvedValue([{ id: 7, name: '合成验证仓' }])
  read.abc.mockResolvedValue([])
  await render(<AbcPage />)
  await within(host).findByText('仓库选项加载失败')
  expect(host.textContent).not.toContain('先选择仓库')
  expect(read.abc).not.toHaveBeenCalled()
  await retry()
  await within(host).findByText('先选择仓库')
  await chooseSelectOption(within(host).getByRole('combobox', { name: '当前仓库' }), '合成验证仓')
  expect(read.abc).toHaveBeenCalledWith({ warehouseId: 7 })
})

it.each([
  ['商品分档结果', '商品分档结果加载失败', 'abc'],
  ['分批盘点规则', '分批盘点规则加载失败', 'rules'],
  ['按期盘点率', '按期盘点率加载失败', 'coverage'],
] as const)('%s 失败仅重试本页签、保留选仓，成功后退出错误状态', async (tab, error, source) => {
  const result = source === 'rules' ? { rules: [] } : []
  read[source].mockRejectedValueOnce(failure).mockResolvedValue(result)
  await render(<AbcPage />)
  if (source === 'abc') {
    await chooseSelectOption(within(host).getByRole('combobox', { name: '当前仓库' }), '合成验证仓')
  } else {
    await click(within(host).getByRole('tab', { name: tab }))
  }
  const panel = within(host).getByRole('tabpanel')
  await within(panel).findByText(error)
  expect(panel.textContent).not.toContain('暂无')
  await retry(panel)
  await vi.waitFor(() => expect(within(panel).queryByText(error)).toBeNull())
  expect(read[source]).toHaveBeenCalledTimes(2)
  expect(read[source].mock.calls[1]).toEqual(read[source].mock.calls[0])
  for (const other of ['abc', 'rules', 'coverage'] as const) {
    if (other !== source) expect(read[other]).not.toHaveBeenCalled()
  }
})

it('承运商账号列表读取失败不显示零条，重新加载恢复真实计数', async () => {
  read.carriers.mockRejectedValueOnce(failure).mockResolvedValue(carrierList)
  await render(<CarrierAccountsPage />, '/carrier-accounts')
  const sidebar = within(host).getByRole('complementary', { name: '快递账号列表' })
  await within(sidebar).findByRole('alert')
  expect(sidebar.textContent).not.toContain('0 个承运商')
  await click(within(sidebar).getByRole('button', { name: '重新加载' }))
  await within(sidebar).findByText(carrier.name)
  expect(sidebar.textContent).toContain('1 个承运商')
})

it('分批盘点规则刷新失败后保留编辑草稿，重试成功也不覆盖输入', async () => {
  const rule = { abcClass: 'A', intervalDays: 10, batchLimit: 50, enabled: true, isOverride: false }
  read.rules.mockResolvedValue({ rules: [rule] })
  await render(<AbcPage />)
  await click(within(host).getByRole('tab', { name: '分批盘点规则' }))
  await within(host).findByRole('cell', { name: '10' })
  await click(await within(host).findByRole('button', { name: '编辑规则' }))
  const days = within(host).getByRole<HTMLInputElement>('spinbutton', { name: 'A 类盘点周期（天）' })
  await act(async () => { fireEvent.change(days, { target: { value: '21' } }) })
  read.rules.mockRejectedValueOnce(failure).mockResolvedValue({ rules: [{ ...rule, intervalDays: 30 }] })
  await refresh(['cycle-rules'])
  await within(host).findByText(/分批盘点规则刷新失败/)
  expect(days.value).toBe('21')
  await retry()
  await vi.waitFor(() => expect(within(host).queryByText(/分批盘点规则刷新失败/)).toBeNull())
  expect(within(host).getByRole<HTMLInputElement>('spinbutton', { name: 'A 类盘点周期（天）' }).value).toBe('21')
})

it('首次读取绑定详情失败能从页头重试，保留错误原因和指定承运商', async () => {
  read.carriers.mockResolvedValue(carrierList)
  read.binding.mockRejectedValueOnce(failure).mockResolvedValue(carrierBinding)
  await render(<CarrierAccountsPage />, '/carrier-accounts?carrierId=7')
  const notice = await within(host).findByRole('alert')
  expect(notice.textContent).toContain(failure.message)
  expect(host.textContent).not.toContain('正在检查账号准备状态')
  await click(within(host).getByRole('button', { name: '刷新开通状态' }))
  await within(host).findByText('M001')
  expect(read.binding.mock.calls).toEqual([[7, 'sf'], [7, 'sf']])
})

it('开通状态刷新失败提示旧资料且保留编辑中的月结号，带草稿也能重试', async () => {
  read.carriers.mockResolvedValue(carrierList)
  read.binding.mockResolvedValue(carrierBinding)
  await render(<CarrierAccountsPage />, '/carrier-accounts?carrierId=7')
  await click(await within(host).findByRole('button', { name: '编辑' }))
  const monthly = () => within(host).getByRole<HTMLInputElement>('textbox', { name: '月结账号' })
  await act(async () => { fireEvent.change(monthly(), { target: { value: 'M-DRAFT' } }) })
  read.binding.mockRejectedValueOnce(failure)
  await refresh(['carriers', 'account-binding-detail'])
  const notice = await within(host).findByRole('alert')
  expect(notice.textContent).toContain('刷新失败')
  expect(monthly().value).toBe('M-DRAFT')
  const reload = within(host).getByRole<HTMLButtonElement>('button', { name: '刷新开通状态' })
  expect(reload.disabled).toBe(false)
  await click(reload)
  await vi.waitFor(() => expect(within(host).queryByRole('alert')).toBeNull())
  expect(monthly().value).toBe('M-DRAFT')
})
