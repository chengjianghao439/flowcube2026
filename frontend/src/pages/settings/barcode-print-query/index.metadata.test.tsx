// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { getByRole, queryByRole } from '@testing-library/dom'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import BarcodePrintQueryPage from './index'
import type { BarcodePrintJobInfo, BarcodePrintRecord } from '@/types/print-jobs'

const state = vi.hoisted(() => ({ rows: [] as BarcodePrintRecord[] }))
vi.mock('@tanstack/react-query', async original => ({ ...await original<typeof import('@tanstack/react-query')>(), useQuery: () => ({ data: { list: state.rows, pagination: { total: state.rows.length } }, isLoading: false }), useMutation: () => ({ mutate: vi.fn(), isPending: false }), useQueryClient: () => ({ invalidateQueries: vi.fn() }) }))
vi.mock('@/api/print-jobs', () => ({ getBarcodePrintRecordsApi: vi.fn(), reprintBarcodeRecordApi: vi.fn() }))
vi.mock('@/store/workspaceStore', () => ({ useWorkspaceStore: () => vi.fn() }))
vi.mock('@/hooks/useActiveWorkspaceTab', () => ({ useActiveWorkspaceTab: () => true }))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }))
vi.mock('./BarcodePrintQueryDialog', () => ({ default: () => null }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: ReturnType<typeof createRoot> | null = null
const host = document.createElement('div')
const job = { id: 31, status: 2, statusKey: 'success', printStateLabel: '已打印', printerId: 3, printerCode: 'SYNTHETIC', printerName: '测试标签机', errorMessage: null, dispatchReason: 'manual_reprint', createdAt: '2026-10-10 08:00:00', updatedAt: '2026-10-10 08:01:00' } satisfies BarcodePrintJobInfo
function draw() {
  act(() => root!.render(<MemoryRouter><BarcodePrintQueryPage /></MemoryRouter>))
}
function render(patch: Partial<BarcodePrintJobInfo> | null = {}) {
  state.rows = [{ category: 'inbound', recordId: 11, barcode: 'I-TEST', barcodeLabel: '入库条码', barcodeKind: '库存条码', bizNo: null, title: '测试商品', subtitle: null, extraInfo: null, warehouseName: '测试仓', locationCode: null, qty: 2, createdAt: '2026-10-10 07:00:00', latestJob: patch === null ? null : { ...job, ...patch }, canReprint: true }]
  document.body.append(host)
  root = createRoot(host)
  draw()
}
afterEach(() => { if (root) act(() => root!.unmount()); root = null; state.rows = []; host.remove() })

async function openHistory() {
  const trigger = getByRole(host, 'button', { name: '查看打印记录 I-TEST' })
  trigger.focus()
  await act(async () => userEvent.keyboard('{Enter}'))
  return { trigger, dialog: getByRole(document.body, 'dialog', { name: '打印记录' }) }
}

test('补打摘要与详情分开，键盘开关后回到原行', async () => {
  render({ requestPurpose: 'reprint', createdById: 7, createdByName: '排队时姓名', requestedCopies: 3, acknowledgedAt: '2026-10-10 08:01:00', sourcePrintJobId: 30 })
  expect(getByRole(host, 'columnheader', { name: /打印任务状态/ })).toBeTruthy()
  expect(getByRole(host, 'columnheader', { name: /业务状态/ })).toBeTruthy()
  expect(queryByRole(document.body, 'dialog')).toBeNull()
  expect(host.textContent).not.toContain('请求份数')
  expect(host.querySelector('[data-print-purpose="reprint"]')?.textContent).toBe('补打')
  expect([...host.querySelectorAll('button')].some(button => button.textContent === '重新打印')).toBe(true)
  const { dialog, trigger } = await openHistory()
  expect(dialog.textContent).toContain('条码 I-TEST')
  expect(dialog.textContent).toContain('记录 ID#31')
  expect(dialog.textContent).toContain('请求人排队时姓名（#7）')
  expect(dialog.textContent).toContain('请求份数3 份')
  expect(dialog.textContent).toContain('客户端回报时间')
  expect(dialog.textContent).toContain('来源打印记录#30')
  expect(dialog.textContent).toContain('打印任务状态客户端回报成功')
  expect(dialog.textContent).toContain('请现场核对标签纸张')
  expect(host.textContent).not.toContain('请求份数')
  expect(dialog.textContent).not.toMatch(/实际(?:打印|出纸)(?:份|张)数|已出纸3/)
  await act(async () => userEvent.keyboard('{Escape}'))
  await vi.waitFor(() => expect(document.activeElement).toBe(trigger))
})

test.each([{}, { requestPurpose: null, createdByName: null, requestedCopies: null }])('旧记录缺字段时仍显示未记录', async patch => {
  render(patch)
  expect(host.querySelector('[data-print-purpose="reprint"]')).toBeNull()
  const { dialog } = await openHistory()
  expect(dialog.textContent).toContain('请求目的未记录')
  expect(dialog.textContent).toContain('请求人未记录')
  expect(dialog.textContent).toContain('请求份数未记录')
  expect(dialog.textContent).not.toContain('初打')
  expect(dialog.textContent).not.toContain('1 份')
  expect(dialog.textContent).not.toContain('来源打印记录')
})

test('失败记录在弹窗显示原错误和关联业务', async () => {
  render({ requestPurpose: 'initial', requestedCopies: 1, refType: 'inventory_container', refId: 11, refCode: 'I-TEST', errorMessage: '标签渲染失败', statusKey: 'failed', acknowledgedAt: null })
  expect(host.textContent).toContain('打印失败')
  expect(host.textContent).not.toContain('标签渲染失败')
  expect(host.querySelector('[data-print-purpose="reprint"]')).toBeNull()
  const { dialog } = await openHistory()
  expect(dialog.textContent).toContain('请求目的初打')
  expect(dialog.textContent).toContain('错误标签渲染失败')
  expect(dialog.textContent).toContain('客户端回报时间未记录')
  expect(dialog.textContent).toContain('关联条码I-TEST')
  expect(dialog.textContent).toContain('关联业务库存条码记录 #11')
})

test('no job does not manufacture request counts or request records', () => {
  render(null)
  expect(host.textContent).toContain('无打印任务')
  expect(queryByRole(host, 'button', { name: '查看打印记录 I-TEST' })).toBeNull()
  expect(host.textContent).not.toContain('请求份数')
})

test('轮询更新同一任务并保持焦点，新的任务不覆盖已打开的任务', async () => {
  render({ statusKey: 'queued' })
  expect(host.textContent).toContain('待派发')
  const { dialog } = await openHistory()
  const close = getByRole(dialog, 'button', { name: '关闭' })
  expect(document.activeElement).toBe(close)
  expect(dialog.textContent).toContain('等待打印客户端领取')
  const row = state.rows[0]
  state.rows = [{ ...row, latestJob: { ...job, statusKey: 'failed', errorMessage: '原任务更新后的错误' } }]
  draw()
  expect(dialog.textContent).toContain('原任务更新后的错误')
  expect(document.activeElement).toBe(close)

  state.rows = [{ ...row, latestJob: { ...job, id: 32, statusKey: 'queued' } }]
  draw()
  expect(dialog.textContent).toContain('列表已有更新的打印任务')
  expect(dialog.textContent).toContain('记录 ID#31')
  expect(dialog.textContent).toContain('原任务更新后的错误')
  expect(dialog.textContent).not.toContain('记录 ID#32')
  expect(document.activeElement).toBe(close)
})

test('列表不再返回该条记录时，关闭后回到查询', async () => {
  render()
  const { dialog } = await openHistory()
  state.rows = []
  draw()
  expect(dialog.textContent).toContain('当前查询结果中已找不到这条打印记录')
  await act(async () => userEvent.keyboard('{Escape}'))
  await vi.waitFor(() => expect(document.activeElement).toBe(getByRole(host, 'button', { name: '查询' })))
})
