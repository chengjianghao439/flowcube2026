// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { buildWorkspaceTabRegistration } from '@/router/workspaceRouteMeta'
import { getBarcodePrintRecordsApi, reprintBarcodeRecordApi } from '@/api/print-jobs'
import BarcodePrintQueryPage from './index'
vi.mock('@/api/print-jobs', () => ({ getBarcodePrintRecordsApi: vi.fn(), reprintBarcodeRecordApi: vi.fn() }))
vi.mock('@/hooks/useActiveWorkspaceTab', () => ({ useActiveWorkspaceTab: () => true }))
let host: HTMLDivElement, root: Root, qc: QueryClient
const path = (id: number) => buildWorkspaceTabRegistration('/settings/barcode-print-query', `?category=inbound&inboundTaskId=${id}`).path
const record = { recordId: 1, category: 'inbound', inboundTaskId: 12, bizNo: 'IT-12', barcode: 'I-12', latestJob: { statusKey: 'failed', status: 3 } }
beforeEach(() => { onlineManager.setOnline(true); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.clearAllMocks(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } }); vi.mocked(getBarcodePrintRecordsApi).mockResolvedValue({ list: [], pagination: { total: 0 } } as never) })
afterEach(() => { act(() => root.unmount()); qc.clear(); host.remove(); onlineManager.setOnline(true) })
async function render(ids: number[]) { await act(async () => root.render(<MemoryRouter initialEntries={[path(99)]}><QueryClientProvider client={qc}>{ids.map(id => <TabPathContext.Provider key={id} value={path(id)}><BarcodePrintQueryPage /></TabPathContext.Provider>)}</QueryClientProvider></MemoryRouter>)); await act(async () => { await new Promise(r => setTimeout(r, 5)) }) }
test('真实注册的两个打印目标各用本标签原收货id发起查询，不混入全局别单', async () => { await render([12, 13]); expect(getBarcodePrintRecordsApi).toHaveBeenCalledWith(expect.objectContaining({ inboundTaskId: 12, category: 'inbound' })); expect(getBarcodePrintRecordsApi).toHaveBeenCalledWith(expect.objectContaining({ inboundTaskId: 13, category: 'inbound' })); expect(getBarcodePrintRecordsApi).not.toHaveBeenCalledWith(expect.objectContaining({ inboundTaskId: 99 })); expect(reprintBarcodeRecordApi).not.toHaveBeenCalled() })
test('交接重新读取失败时隐藏旧缓存和补打动作，允许重试', async () => { qc.setQueryData(['barcode-print-records', 'inbound', '', '__all__', 12, undefined], { list: [record], pagination: { total: 1 } }); vi.mocked(getBarcodePrintRecordsApi).mockRejectedValue(new Error('无法读取')); await render([12]); expect(host.textContent).toContain('打印记录读取失败'); expect(host.textContent).not.toContain('I-12'); expect([...host.querySelectorAll('button')].some(b => b.textContent === '重新读取打印记录')).toBe(true); expect(reprintBarcodeRecordApi).not.toHaveBeenCalled() })

test('打印交接离线暂停时隐藏旧记录，恢复重读后才显示最新记录', async () => {
  qc.setQueryData(['barcode-print-records', 'inbound', '', '__all__', 12, undefined], { list: [record], pagination: { total: 1 } })
  let finish!: (value: Awaited<ReturnType<typeof getBarcodePrintRecordsApi>>) => void
  vi.mocked(getBarcodePrintRecordsApi).mockImplementation(() => new Promise(resolve => { finish = resolve }))
  onlineManager.setOnline(false); await render([12])
  expect(qc.getQueryState(['barcode-print-records', 'inbound', '', '__all__', 12, undefined])?.fetchStatus).toBe('paused')
  expect(host.textContent).toContain('网络已暂停，等待恢复后重新读取打印记录')
  expect(host.textContent).not.toContain('I-12')
  await act(async () => onlineManager.setOnline(true)); await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
  expect(host.textContent).not.toContain('I-12')
  await act(async () => finish({ list: [{ ...record, barcode: 'I-LATEST' }], pagination: { total: 1 } } as never)); await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
  expect(host.textContent).toContain('I-LATEST')
  expect(reprintBarcodeRecordApi).not.toHaveBeenCalled()
})
