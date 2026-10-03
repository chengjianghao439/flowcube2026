// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { PERMISSIONS } from '@/lib/permission-codes'
import type { LogisticsWaybill } from '@/types/logistics'
import LogisticsDetailPage from './detail'
import { getWaybillDetailApi, retryWaybillApi, setWaybillTrackingApi, updateWaybillShipmentApi } from '@/api/logistics'
import { confirmAction } from '@/lib/confirm'
const controls = vi.hoisted(() => ({ active: true, permissions: new Set<string>(), addTab: vi.fn() }))
vi.mock('@/api/logistics', () => ({ getWaybillDetailApi: vi.fn(), retryWaybillApi: vi.fn(), setWaybillTrackingApi: vi.fn(), voidWaybillApi: vi.fn(), updateWaybillShipmentApi: vi.fn() }))
vi.mock('@/hooks/useActiveWorkspaceTab', () => ({ useActiveWorkspaceTab: () => controls.active }))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: (code: string) => controls.permissions.has(code) }) }))
vi.mock('@/hooks/useWorkspaceTabTitle', () => ({ useWorkspaceTabTitle: () => {} }))
vi.mock('@/store/workspaceStore', () => ({ useWorkspaceStore: (selector: (s: { addTab: typeof controls.addTab }) => unknown) => selector({ addTab: controls.addTab }) }))
vi.mock('@/components/shared/OrderDetailSections', () => ({ OrderDetailSections: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
vi.mock('@/lib/confirm', () => ({ confirmAction: vi.fn() }))
let host: HTMLDivElement, root: Root, qc: QueryClient
const contact = { name: '样例', phone: '13800000000', province: '广东省', city: '深圳市', county: '南山区', address: '样例路1号' }
const waybill = (changes: Partial<LogisticsWaybill> = {}) => ({ id: 7, waybillNo: 'WB-7', saleOrderId: 28, saleOrderNo: 'SO-28', platformCode: null, status: 1, statusLabel: '待取号', trackingNo: null, createdAt: '2026-10-03 10:00:00', ...changes }) as LogisticsWaybill
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.clearAllMocks(); onlineManager.setOnline(true); controls.active = true
  controls.permissions = new Set([PERMISSIONS.LOGISTICS_MANAGE, PERMISSIONS.SALE_ORDER_VIEW, PERMISSIONS.PRINT_JOB_VIEW])
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 300000 } } })
  vi.mocked(getWaybillDetailApi).mockResolvedValue(waybill())
})
afterEach(() => { act(() => root.unmount()); qc.clear(); host.remove(); onlineManager.setOnline(true) })
async function settle() { await act(async () => { await new Promise(r => setTimeout(r, 10)) }) }
async function render(path = '/logistics/7?focus=source') { await act(async () => root.render(<MemoryRouter initialEntries={['/logistics/99']}><QueryClientProvider client={qc}><TabPathContext.Provider value={path}><LogisticsDetailPage /></TabPathContext.Provider></QueryClientProvider></MemoryRouter>)); await settle() }
const button = (label: string) => [...document.querySelectorAll('button')].find(b => b.textContent === label)
test('本标签去query取原运单，原销售及物流打印入口使用真实ID和工作区登记', async () => {
  await render(); expect(getWaybillDetailApi).toHaveBeenCalledWith(7)
  await act(async () => button('SO-28')!.click())
  expect(controls.addTab).toHaveBeenCalledWith(expect.objectContaining({ key: '/sale/28', path: '/sale/28' }))
  await act(async () => button('查看物流标签记录')!.click())
  expect(controls.addTab).toHaveBeenCalledWith(expect.objectContaining({ path: '/settings/barcode-print-query?category=logistics', title: '条码打印查询' }))
  expect(setWaybillTrackingApi).not.toHaveBeenCalled(); expect(retryWaybillApi).not.toHaveBeenCalled()
})
test.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('非法销售ID %s只显示原文本', async saleOrderId => {
  vi.mocked(getWaybillDetailApi).mockResolvedValue(waybill({ saleOrderId })); await render('/logistics/7'); expect(button('SO-28')).toBeUndefined()
})
test.each(['0', '-1', '1.5', 'abc', '9007199254740992', '7e0'])('非法运单路径 %s不查询与操作', async id => {
  await render(`/logistics/${id}?focus=source`); expect(getWaybillDetailApi).not.toHaveBeenCalled(); expect(button('手工录入快递单号')).toBeUndefined()
})
test('两个详情context使用各自原单，不从全局另tab推原对象', async () => {
  vi.mocked(getWaybillDetailApi).mockImplementation(async id => waybill({ id, waybillNo: `WB-${id}`, saleOrderId: id === 7 ? 28 : 29, saleOrderNo: id === 7 ? 'SO-28' : 'SO-29' }))
  await act(async () => root.render(<MemoryRouter initialEntries={['/logistics/99']}><QueryClientProvider client={qc}>{[7, 8].map(id => <div key={id} data-id={id}><TabPathContext.Provider value={`/logistics/${id}?focus=source`}><LogisticsDetailPage /></TabPathContext.Provider></div>)}</QueryClientProvider></MemoryRouter>)); await settle()
  await act(async () => [...host.querySelector('[data-id="7"]')!.querySelectorAll('button')].find(b => b.textContent === 'SO-28')!.click()); expect(controls.addTab).toHaveBeenLastCalledWith(expect.objectContaining({ path: '/sale/28' }))
  await act(async () => [...host.querySelector('[data-id="8"]')!.querySelectorAll('button')].find(b => b.textContent === 'SO-29')!.click()); expect(controls.addTab).toHaveBeenLastCalledWith(expect.objectContaining({ path: '/sale/29' })); expect(getWaybillDetailApi).not.toHaveBeenCalledWith(99)
})
test('作废确认清楚限定本地记录且不宣称官方取消', async () => {
  await render('/logistics/7'); await act(async () => button('作废')!.click()); expect(confirmAction).toHaveBeenCalledWith(expect.objectContaining({ title: '作废运单本地记录', description: expect.stringContaining('不代表快递官方订单已取消') }))
})
test('目标权限不足不提供入口，错误身份与未知状态不提供操作', async () => {
  controls.permissions.clear(); await render('/logistics/7'); expect(button('SO-28')).toBeUndefined(); expect(button('查看物流标签记录')).toBeUndefined()
  controls.permissions.add(PERMISSIONS.LOGISTICS_MANAGE); qc.setQueryData(['waybill', 7], waybill({ id: 8 })); await render('/logistics/7'); expect(button('手工录入快递单号')).toBeUndefined()
  vi.mocked(getWaybillDetailApi).mockResolvedValue(waybill({ status: 99 as never })); await act(async () => { await qc.invalidateQueries({ queryKey: ['waybill', 7] }) }); await settle(); expect(button('作废')).toBeUndefined(); expect(host.textContent).toContain('状态暂无法确认')
})
test.each(['fetching', 'error', 'paused'] as const)('5分钟缓存重开%s不能操作，fresh成功恢复', async state => {
  qc.setQueryData(['waybill', 7], waybill()); let finish!: (v: LogisticsWaybill) => void
  vi.mocked(getWaybillDetailApi).mockImplementation(() => state === 'error' ? Promise.reject(new Error('离线样例')) : new Promise(resolve => { finish = resolve }))
  if (state === 'paused') onlineManager.setOnline(false)
  await render('/logistics/7'); expect(button('手工录入快递单号')).toBeUndefined(); expect(button('SO-28')).toBeUndefined(); expect(button('查看物流标签记录')).toBeUndefined()
  if (state === 'error') { expect(host.textContent).toContain('运单加载失败'); vi.mocked(getWaybillDetailApi).mockResolvedValue(waybill()); await act(async () => { await qc.refetchQueries({ queryKey: ['waybill', 7] }) }) }
  else { if (state === 'paused') { await act(async () => onlineManager.setOnline(true)); await settle() }; await act(async () => finish(waybill())) }
  await settle(); expect(button('手工录入快递单号')).toBeDefined()
})
test('隐藏标签不操作，激活时重读当前单且失败后保留已打开录入草稿', async () => {
  await render('/logistics/7'); await act(async () => button('手工录入快递单号')!.click())
  const input = document.querySelector<HTMLInputElement>('#logistics-detail-tracking-number')!
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'DRAFT-7'); input.dispatchEvent(new Event('input', { bubbles: true })) })
  vi.mocked(getWaybillDetailApi).mockRejectedValue(new Error('后台读失败')); await act(async () => { await qc.invalidateQueries({ queryKey: ['waybill', 7] }) }); await settle()
  expect(document.querySelector<HTMLInputElement>('#logistics-detail-tracking-number')?.value).toBe('DRAFT-7'); expect(button('保存')?.disabled).toBe(true); expect(setWaybillTrackingApi).not.toHaveBeenCalled()
  controls.active = false; await render('/logistics/7'); expect(button('SO-28')).toBeUndefined()
  controls.active = true; vi.mocked(getWaybillDetailApi).mockResolvedValue(waybill()); await render('/logistics/7'); expect(getWaybillDetailApi).toHaveBeenCalledTimes(3)
  await render('/logistics/8'); expect(document.querySelector<HTMLInputElement>('#logistics-detail-tracking-number')?.value).toBe('DRAFT-7'); expect(button('保存')?.disabled).toBe(true)
})
test('寄件资料后台失败保留输入并禁止保存，不重新下单', async () => {
  vi.mocked(getWaybillDetailApi).mockResolvedValue(waybill({ platformCode: 'deppon', freightType: 1, shipment: { sender: contact, receiver: contact, cargoName: '配件', productCode: 'DJBK', deliveryType: '3', packages: [{ id: 1 }] } }))
  await render('/logistics/7'); await act(async () => button('补充寄件资料')!.click())
  const input = document.querySelector<HTMLInputElement>('#shipment-cargo')!
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '未保存资料'); input.dispatchEvent(new Event('input', { bubbles: true })) })
  vi.mocked(getWaybillDetailApi).mockRejectedValue(new Error('后台失败')); await act(async () => { await qc.invalidateQueries({ queryKey: ['waybill', 7] }) }); await settle()
  expect(document.querySelector<HTMLInputElement>('#shipment-cargo')?.value).toBe('未保存资料'); expect(button('保存并提交下单')?.disabled).toBe(true); expect(updateWaybillShipmentApi).not.toHaveBeenCalled()
  await render('/logistics/8?focus=source')
  expect(document.querySelector<HTMLInputElement>('#shipment-cargo')?.value).toBe('未保存资料'); expect(button('保存并提交下单')?.disabled).toBe(true)
  qc.setQueryData(['waybill', 8], waybill({ id: 9 })); await settle()
  expect(document.querySelector<HTMLInputElement>('#shipment-cargo')?.value).toBe('未保存资料'); expect(button('保存并提交下单')?.disabled).toBe(true); expect(updateWaybillShipmentApi).not.toHaveBeenCalled()
})
test.each([
  [{ status: 1 }, '手工录入快递单号'], [{ status: 4 }, '手工录入快递单号'],
  [{ status: 1, platformCode: 'legacy' }, '已配置快递平台，请核对取号进度'],
  [{ status: 4, platformCode: 'legacy' }, '原重试或录入已有快递单号'],
  [{ status: 4, platformCode: 'deppon' }, '补充寄件资料'],
  [{ status: 1, platformCode: 'sf', submittedToPlatform: true }, '进入取号失败或下单待核实时可用查询原单'],
  [{ status: 4, platformCode: 'sf', submittedToPlatform: true }, '查询原单核实'],
  [{ status: 6, platformCode: 'sf' }, '查询原单核实'],
  [{ status: 2 }, '取号正在处理中'], [{ status: 3 }, '不等于面单已出纸'],
  [{ status: 3, printDataRef: 'official_platform' }, '请通过快递官方打印面单'], [{ status: 5 }, '本地记录已作废'],
] as const)('状态说明 %j 引导 %s', async (changes, text) => {
  vi.mocked(getWaybillDetailApi).mockResolvedValue(waybill(changes as Partial<LogisticsWaybill>)); await render('/logistics/7'); expect(host.textContent).toContain(text)
  if ('submittedToPlatform' in changes || changes.status === 6) {
    expect(button('作废')).toBeUndefined()
    if (changes.status === 1) expect(button('查询原单')).toBeUndefined()
    else { await act(async () => button('查询原单')!.click()); expect(retryWaybillApi).toHaveBeenCalledWith(7, expect.anything()) }
  }
})
