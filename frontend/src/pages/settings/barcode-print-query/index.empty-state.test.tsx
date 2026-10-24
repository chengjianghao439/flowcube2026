// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { getByRole, queryByText } from '@testing-library/dom'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { getBarcodePrintRecordsApi, reprintBarcodeRecordApi } from '@/api/print-jobs'
import BarcodePrintQueryPage from './index'

vi.mock('@/api/print-jobs', () => ({ getBarcodePrintRecordsApi: vi.fn(), reprintBarcodeRecordApi: vi.fn() }))
vi.mock('@/hooks/useActiveWorkspaceTab', () => ({ useActiveWorkspaceTab: () => true }))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }))
vi.mock('@/store/workspaceStore', () => ({ useWorkspaceStore: () => vi.fn() }))

let host: HTMLDivElement, root: Root, qc: QueryClient
const empty = { list: [], pagination: { total: 0 } }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.mocked(getBarcodePrintRecordsApi).mockResolvedValue(empty as never)
})
afterEach(() => { act(() => root.unmount()); qc.clear(); host.remove() })
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) }) }
async function render() {
  await act(async () => root.render(<MemoryRouter><QueryClientProvider client={qc}><BarcodePrintQueryPage /></QueryClientProvider></MemoryRouter>))
  await settle()
}

test('首次读取失败不冒称零条或暂无数据，重读成功后才显示真实空记录', async () => {
  vi.mocked(getBarcodePrintRecordsApi).mockRejectedValue(new Error('读取失败样例'))
  await render()
  expect(queryByText(host, '暂无数据')).toBeNull()
  expect(host.textContent).not.toMatch(/共\s*0\s*条/)
  expect(getByRole(host, 'alert').textContent).toContain('打印记录读取失败')
  vi.mocked(getBarcodePrintRecordsApi).mockResolvedValue(empty as never)
  await act(async () => getByRole(host, 'button', { name: '重新读取打印记录' }).click())
  await settle()
  expect(host.textContent).toContain('暂无入库条码打印记录')
  expect(host.textContent).toMatch(/共\s*0\s*条/)
  expect(reprintBarcodeRecordApi).not.toHaveBeenCalled()
})

test('恢复标签未输入条件时明确等待查询，从空态进入原查询窗且不提交补打', async () => {
  await render()
  const initialCalls = vi.mocked(getBarcodePrintRecordsApi).mock.calls.length
  await act(async () => getByRole(host, 'button', { name: '恢复收货标签' }).click())
  await settle()
  expect(host.textContent).toContain('先查询有效收货来源')
  expect(host.textContent).not.toContain('最新打印记录尚待核对')
  expect(host.textContent).not.toMatch(/共\s*0\s*条/)
  expect(getBarcodePrintRecordsApi).toHaveBeenCalledTimes(initialCalls)
  await act(async () => getByRole(host, 'button', { name: '输入恢复查询条件' }).click())
  const dialog = getByRole(document.body, 'dialog')
  expect(document.activeElement).toBe(getByRole(dialog, 'textbox'))
  const user = userEvent.setup()
  await act(async () => { await user.type(getByRole(dialog, 'textbox'), 'DEMO-BOX-001') })
  await act(async () => getByRole(dialog, 'button', { name: '查询' }).click())
  await settle()
  expect(getBarcodePrintRecordsApi).toHaveBeenLastCalledWith(expect.objectContaining({ recovery: true, keyword: 'DEMO-BOX-001', category: 'inbound' }))
  expect(host.textContent).toContain('未找到可恢复的收货标签')
  expect(document.activeElement).toBe(getByRole(host, 'button', { name: '查询' }))
  expect(reprintBarcodeRecordApi).not.toHaveBeenCalled()
})


test('整页出纸提示与当前类别说明只在页头出现，恢复模式沿同一位置更新', async () => {
  await render()
  const caption = () => host.querySelector('.desktop-page-description')!
  expect(host.querySelectorAll('.desktop-page-description')).toHaveLength(1)
  expect(caption().textContent).toContain('业务完成与条码业务状态不代表已出纸')
  expect(host.textContent?.match(/业务完成与条码业务状态不代表已出纸/g)).toHaveLength(1)
  expect(host.querySelector('.fc-context-notice')).toBeNull()
  await act(async () => getByRole(host, 'button', { name: '恢复收货标签' }).click())
  await settle()
  expect(caption().textContent).toContain('仅恢复有有效收货单及明细的现存条码；不新建库存')
  expect(host.textContent?.match(/仅恢复有有效收货单及明细的现存条码/g)).toHaveLength(1)
  expect(reprintBarcodeRecordApi).not.toHaveBeenCalled()
})
