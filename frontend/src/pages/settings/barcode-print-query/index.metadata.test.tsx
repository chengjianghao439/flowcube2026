// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import BarcodePrintQueryPage from './index'
import type { BarcodePrintJobInfo, BarcodePrintRecord } from '@/types/print-jobs'

const state = vi.hoisted(() => ({ rows: [] as BarcodePrintRecord[] }))
vi.mock('@tanstack/react-query', async original => ({ ...await original<typeof import('@tanstack/react-query')>(), useQuery: () => ({ data: { list: state.rows, pagination: { total: state.rows.length } }, isLoading: false }), useMutation: () => ({ mutate: vi.fn(), isPending: false }), useQueryClient: () => ({ invalidateQueries: vi.fn() }) }))
vi.mock('@/api/print-jobs', () => ({ getBarcodePrintRecordsApi: vi.fn(), reprintBarcodeRecordApi: vi.fn() }))
vi.mock('@/store/workspaceStore', () => ({ useWorkspaceStore: () => vi.fn() }))
vi.mock('@/hooks/useActiveWorkspaceTab', () => ({ useActiveWorkspaceTab: () => true }))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }))
vi.mock('@/components/shared/DataTable', () => ({ default: ({ columns, data }: { columns: Array<{ key: string; render?: (value: unknown, row: BarcodePrintRecord) => React.ReactNode }>; data: BarcodePrintRecord[] }) => <div>{data.map(row => <div key={row.recordId}>{columns.filter(column => ['printer', 'action'].includes(column.key)).map(column => <div key={column.key}>{column.render?.(undefined, row)}</div>)}</div>)}</div> }))
vi.mock('./BarcodePrintQueryDialog', () => ({ default: () => null }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: ReturnType<typeof createRoot> | null = null
const host = document.createElement('div')
const job = { id: 31, status: 2, statusKey: 'success', printStateLabel: '已打印', printerId: 3, printerCode: 'SYNTHETIC', printerName: '测试标签机', errorMessage: null, dispatchReason: 'manual_reprint', createdAt: '2026-10-10 08:00:00', updatedAt: '2026-10-10 08:01:00' } satisfies BarcodePrintJobInfo
function render(patch: Partial<BarcodePrintJobInfo> | null = {}) {
  state.rows = [{ category: 'inbound', recordId: 11, barcode: 'I-TEST', barcodeLabel: '入库条码', barcodeKind: '库存条码', bizNo: null, title: '测试商品', subtitle: null, extraInfo: null, warehouseName: '测试仓', locationCode: null, qty: 2, createdAt: '2026-10-10 07:00:00', latestJob: patch === null ? null : { ...job, ...patch }, canReprint: true }]
  root = createRoot(host)
  act(() => root!.render(<MemoryRouter><BarcodePrintQueryPage /></MemoryRouter>))
}
afterEach(() => { if (root) act(() => root!.unmount()); root = null; state.rows = [] })

test('explicit reprint has a small badge and an initially collapsed request record inside the existing table', () => {
  render({ requestPurpose: 'reprint', createdById: 7, createdByName: '排队时姓名', requestedCopies: 3, acknowledgedAt: '2026-10-10 08:01:00', sourcePrintJobId: 30 })
  const details = host.querySelector('details')!
  expect(details).not.toBeNull(); expect(details.open).toBe(false)
  expect(details.querySelector('summary')?.textContent).toBe('打印记录')
  expect(host.querySelector('[data-print-purpose="reprint"]')?.textContent).toBe('补打')
  expect(details.textContent).toContain('记录 ID#31'); expect(details.textContent).toContain('请求人排队时姓名（#7）')
  expect(details.textContent).toContain('请求份数3 份'); expect(details.textContent).toContain('客户端回报时间')
  expect(details.textContent).toContain('来源打印记录#30'); expect(details.textContent).toContain('状态客户端回报成功')
  expect(host.textContent).toContain('请现场核对标签纸张')
  expect([...host.querySelectorAll('button')].some(button => button.textContent === '重新打印')).toBe(true)
  expect(details.textContent).not.toMatch(/实际(?:打印|出纸)(?:份|张)数|已出纸3/)
})

test.each([{}, { requestPurpose: null, createdByName: null, requestedCopies: null }])('missing or NULL fields remain unrecorded and never infer initial from legacy dispatch', patch => {
  render(patch)
  const details = host.querySelector('details')!
  expect(details).not.toBeNull(); expect(details.open).toBe(false)
  expect(host.querySelector('[data-print-purpose="reprint"]')).toBeNull()
  expect(details.textContent).toContain('请求目的未记录'); expect(details.textContent).toContain('请求人未记录'); expect(details.textContent).toContain('请求份数未记录')
  expect(details.textContent).not.toContain('初打'); expect(details.textContent).not.toContain('1 份')
  expect(details.textContent).not.toContain('来源打印记录')
})

test('known initial remains inside collapsed details, with reported errors and actual references', () => {
  render({ requestPurpose: 'initial', requestedCopies: 1, refType: 'inventory_container', refId: 11, refCode: 'I-TEST', errorMessage: '标签渲染失败', statusKey: 'failed', acknowledgedAt: null })
  const details = host.querySelector('details')!
  expect(details).not.toBeNull(); expect(details.open).toBe(false)
  expect(host.querySelector('[data-print-purpose="reprint"]')).toBeNull()
  expect(details.textContent).toContain('请求目的初打'); expect(details.textContent).toContain('错误标签渲染失败')
  expect(details.textContent).toContain('客户端回报时间未记录'); expect(details.textContent).toContain('关联条码I-TEST')
  expect(details.textContent).toContain('关联业务库存条码记录 #11')
})

test('no job does not manufacture request counts or request records', () => {
  render(null)
  expect(host.textContent).toContain('无打印任务')
  expect(host.querySelector('details')).toBeNull(); expect(host.textContent).not.toContain('请求份数')
})
