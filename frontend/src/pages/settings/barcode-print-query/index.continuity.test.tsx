// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { PERMISSIONS } from '@/lib/permission-codes'
import type { BarcodePrintCategory, BarcodePrintRecord } from '@/types/print-jobs'
import { getBarcodePrintRecordsApi, reprintBarcodeRecordApi } from '@/api/print-jobs'
import BarcodePrintQueryPage from './index'
const controls = vi.hoisted(() => ({ active: true, permissions: new Set<string>(), addTab: vi.fn() }))
vi.mock('@/api/print-jobs', () => ({ getBarcodePrintRecordsApi: vi.fn(), reprintBarcodeRecordApi: vi.fn() }))
vi.mock('@/hooks/useActiveWorkspaceTab', () => ({ useActiveWorkspaceTab: () => controls.active }))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: (code: string) => controls.permissions.has(code) }) }))
vi.mock('@/store/workspaceStore', () => ({ useWorkspaceStore: (select: (s: { addTab: typeof controls.addTab }) => unknown) => select({ addTab: controls.addTab }) }))
vi.mock('@/components/shared/DataTable', () => ({ default: ({ columns, data }: { columns: { key: string; render?: (v: unknown, r: BarcodePrintRecord) => React.ReactNode }[]; data: BarcodePrintRecord[] }) => <div>{data.map(r => <div key={r.recordId}>{columns.map(c => <div key={c.key}>{c.render?.(undefined, r)}</div>)}</div>)}</div> }))
vi.mock('@/components/shared/TableActionsMenu', () => ({ default: ({ primaryDisabled, onPrimaryClick, items }: { primaryDisabled: boolean; onPrimaryClick: () => void; items: { label: string; onClick: () => void }[] }) => <><button disabled={primaryDisabled} onClick={onPrimaryClick}>重新打印</button>{items.map(i => <button key={i.label} onClick={i.onClick}>{i.label}</button>)}</> }))
let host: HTMLDivElement, root: Root, qc: QueryClient
function record(category: BarcodePrintCategory, changes: Partial<BarcodePrintRecord> = {}) { return { category, recordId: 119, barcode: 'LABEL-119', inboundTaskId: 12, waveId: 11, waveNo: 'WAVE-11', canReprint: true, latestJob: { statusKey: 'success', printStateLabel: '已打印' }, ...changes } as BarcodePrintRecord }
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.clearAllMocks(); onlineManager.setOnline(true); controls.active = true; controls.permissions = new Set([PERMISSIONS.PRINT_JOB_REPRINT, PERMISSIONS.INBOUND_ORDER_VIEW, PERMISSIONS.PICKING_WAVE_VIEW]); host = document.createElement('div'); document.body.append(host); root = createRoot(host); qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 300000 } } }); vi.mocked(getBarcodePrintRecordsApi).mockResolvedValue({ list: [], pagination: { total: 0 } } as never) })
afterEach(() => { act(() => root.unmount()); qc.clear(); host.remove(); onlineManager.setOnline(true) })
async function settle() { await act(async () => { await new Promise(r => setTimeout(r, 10)) }) }
async function render(category: BarcodePrintCategory, keyword = '') { await act(async () => root.render(<MemoryRouter initialEntries={['/settings/barcode-print-query?category=inbound&inboundTaskId=99']}><QueryClientProvider client={qc}><TabPathContext.Provider value={`/settings/barcode-print-query?category=${category}&keyword=${keyword}`}><BarcodePrintQueryPage /></TabPathContext.Provider></QueryClientProvider></MemoryRouter>)); await settle() }
const button = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent === label)
test.each(['inbound', 'outbound', 'logistics'] as const)('%s五分钟缓存重开/失败/重试后才恢复操作，筛选保持', async category => {
  qc.setQueryData(['barcode-print-records', category, '', '__all__', undefined, undefined], { list: [record(category)], pagination: { total: 1 } }); let finish!: (v: Awaited<ReturnType<typeof getBarcodePrintRecordsApi>>) => void
  vi.mocked(getBarcodePrintRecordsApi).mockImplementation(() => new Promise(resolve => { finish = resolve })); await render(category)
  expect(button('重新打印')?.disabled).toBe(true); expect(button('打开收货详情')).toBeUndefined(); expect(button('打开批次详情')).toBeUndefined()
  await act(async () => finish({ list: [record(category)], pagination: { total: 1 } } as never)); await settle(); expect(button('重新打印')?.disabled).toBe(false)
  vi.mocked(getBarcodePrintRecordsApi).mockRejectedValue(new Error('失败样例')); await act(async () => { await qc.invalidateQueries({ queryKey: ['barcode-print-records'] }) }); await settle()
  expect(host.textContent).toContain('打印记录读取失败'); expect(button('重新打印')?.disabled).toBe(true); expect(button('打开收货详情')).toBeUndefined(); expect(button('打开批次详情')).toBeUndefined(); expect(reprintBarcodeRecordApi).not.toHaveBeenCalled()
  vi.mocked(getBarcodePrintRecordsApi).mockResolvedValue({ list: [record(category)], pagination: { total: 1 } } as never); await act(async () => button('重新读取打印记录')!.click()); await settle(); expect(button('重新打印')?.disabled).toBe(false); expect(getBarcodePrintRecordsApi).toHaveBeenLastCalledWith(expect.objectContaining({ category, keyword: '' }))
})
test('物流记录离线暂停和隐藏标签不补打，恢复激活会重读', async () => {
  qc.setQueryData(['barcode-print-records', 'logistics', '', '__all__', undefined, undefined], { list: [record('logistics')], pagination: { total: 1 } }); onlineManager.setOnline(false); await render('logistics'); expect(button('重新打印')?.disabled).toBe(true)
  vi.mocked(getBarcodePrintRecordsApi).mockResolvedValue({ list: [record('logistics')], pagination: { total: 1 } } as never); await act(async () => onlineManager.setOnline(true)); await settle(); expect(button('重新打印')?.disabled).toBe(false)
  controls.active = false; await render('logistics'); expect(button('重新打印')?.disabled).toBe(true); controls.active = true; await render('logistics'); expect(getBarcodePrintRecordsApi).toHaveBeenCalledTimes(2)
})
test('来源按钮按目标权限与安全ID，补打按真实route权限', async () => {
  controls.permissions.clear(); vi.mocked(getBarcodePrintRecordsApi).mockResolvedValue({ list: [record('inbound')], pagination: { total: 1 } } as never); await render('inbound'); expect(button('重新打印')?.disabled).toBe(true); expect(button('打开收货详情')).toBeUndefined()
  controls.permissions.add(PERMISSIONS.INBOUND_ORDER_VIEW); controls.permissions.add(PERMISSIONS.PRINT_JOB_REPRINT); qc.setQueryData(['barcode-print-records', 'inbound', '', '__all__', undefined, undefined], { list: [record('inbound', { inboundTaskId: 1.5 })], pagination: { total: 1 } }); await settle(); expect(button('打开收货详情')).toBeUndefined()
  qc.setQueryData(['barcode-print-records', 'inbound', '', '__all__', undefined, undefined], { list: [record('inbound')], pagination: { total: 1 } }); await settle(); await act(async () => button('打开收货详情')!.click()); expect(controls.addTab).toHaveBeenCalledWith(expect.objectContaining({ path: '/inbound-tasks/12?focus=print-batches' }))
})
test('有筛选的物流读取失败后手动重读保留关键字，不自动补打', async () => {
  vi.mocked(getBarcodePrintRecordsApi).mockRejectedValue(new Error('筛选读取失败')); await render('logistics', 'REF-119'); expect(host.textContent).toContain('关键字：REF-119')
  vi.mocked(getBarcodePrintRecordsApi).mockResolvedValue({ list: [record('logistics')], pagination: { total: 1 } } as never); await act(async () => button('重新读取打印记录')!.click()); await settle()
  expect(getBarcodePrintRecordsApi).toHaveBeenLastCalledWith(expect.objectContaining({ keyword: 'REF-119', category: 'logistics' })); expect(host.textContent).toContain('关键字：REF-119'); expect(reprintBarcodeRecordApi).not.toHaveBeenCalled()
})
test('既有工作台入口使用别名规范化后的工作区标题', async () => {
  controls.permissions.add(PERMISSIONS.REPORT_VIEW); vi.mocked(getBarcodePrintRecordsApi).mockResolvedValue({ list: [record('logistics')], pagination: { total: 1 } } as never); await render('logistics')
  await act(async () => button('打开异常工作台')!.click()); expect(controls.addTab).toHaveBeenLastCalledWith({ key: '/reports/role-workbench', path: '/reports/role-workbench', title: '待办中心' })
})
test.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('非法批次ID %s不生成来源导航', async waveId => {
  vi.mocked(getBarcodePrintRecordsApi).mockResolvedValue({ list: [record('outbound', { waveId })], pagination: { total: 1 } } as never); await render('outbound'); expect(button('打开批次详情')).toBeUndefined(); expect(button('返回批次详情')).toBeUndefined()
})
test.each([['success', '客户端已回报成功，请现场核对标签纸张'], ['queued', '打印结果尚待确认'], ['printing', '打印结果尚待确认'], ['failed', '先核对工作站、打印机和纸张'], ['timeout', '先核对工作站、打印机和纸张']] as const)('最近任务%s解释不冒称物理出纸', async (statusKey, text) => {
  vi.mocked(getBarcodePrintRecordsApi).mockResolvedValue({ list: [record('logistics', { latestJob: { statusKey, printStateLabel: statusKey } as never })], pagination: { total: 1 } } as never); await render('logistics'); expect(host.textContent).toContain(text); expect(reprintBarcodeRecordApi).not.toHaveBeenCalled()
})
