// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import BarcodePrintQueryPage from './index'

const rows = vi.hoisted(() => [
  { recordId: 1, category: 'inbound', inboundTaskId: 1, bizNo: 'IT-1', latestJob: { statusKey: 'failed' } },
  { recordId: 2, category: 'inbound', inboundTaskId: 2, bizNo: 'IT-2', latestJob: { statusKey: 'failed' } },
  { recordId: 3, category: 'inbound', inboundTaskId: 2, bizNo: 'IT-2', latestJob: { statusKey: 'timeout' } },
  { recordId: 4, category: 'inbound', inboundTaskId: 1, bizNo: 'IT-1', latestJob: { statusKey: 'queued' } },
])
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: { list: rows, pagination: { total: rows.length } }, isLoading: false }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))
vi.mock('@/api/print-jobs', () => ({ getBarcodePrintRecordsApi: vi.fn(), reprintBarcodeRecordApi: vi.fn() }))
vi.mock('@/store/workspaceStore', () => ({ useWorkspaceStore: () => vi.fn() }))
vi.mock('@/hooks/useActiveWorkspaceTab', () => ({ useActiveWorkspaceTab: () => true }))
vi.mock('@/components/shared/DataTable', () => ({ default: () => null }))
vi.mock('./BarcodePrintQueryDialog', () => ({ default: () => null }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const host = document.createElement('div')
let root: ReturnType<typeof createRoot>
function render(query = '') {
  root = createRoot(host)
  act(() => root.render(<MemoryRouter initialEntries={[`/settings/barcode-print-query${query}`]}><BarcodePrintQueryPage /></MemoryRouter>))
}
afterEach(() => act(() => root.unmount()))

test('普通全量列表不把首条记录的收货单当成当前链路', () => {
  render()
  expect(host.textContent).not.toContain('当前正在处理收货打印链路')
  expect(host.textContent).not.toContain('返回收货详情')
})

test.each(['-1', '1.5', 'abc', '0'])('非法收货单参数 %s 不生成当前链路', id => {
  render(`?inboundTaskId=${id}`)
  expect(host.textContent).not.toContain('当前正在处理收货打印链路')
})

test('显式收货单上下文只统计该单，不能混入其他单失败和超时', () => {
  render('?inboundTaskId=1')
  expect(host.textContent).toContain('当前正在处理收货打印链路')
  expect(host.textContent).toContain('IT-1')
  const count = (label: string) => Array.from(host.querySelectorAll('p')).find(p => p.textContent === label)?.nextElementSibling?.textContent
  expect(count('打印失败')).toBe('1')
  expect(count('超时待确认')).toBe('0')
  expect(count('仍在排队 / 打印中')).toBe('1')
})
