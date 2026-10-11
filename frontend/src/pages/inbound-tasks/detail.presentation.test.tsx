// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { PERMISSIONS } from '@/lib/permission-codes'
import type { InboundTask, InboundTaskItem } from '@/types/inbound-tasks'
import Page from './detail'
import { useWorkspaceStore } from '@/store/workspaceStore'

const fixture = vi.hoisted(() => ({ task: undefined as InboundTask | undefined, permissions: null as Set<string> | null, write: vi.fn() }))
vi.mock('@/hooks/useInboundTasks', () => ({
  useInboundTaskDetail: () => ({ data: fixture.task, error: null, isLoading: false, refetch: vi.fn() }),
  ...Object.fromEntries(['useSubmitInboundTask', 'useCancelInbound', 'useVoidInboundReceipt'].map(name => [name, () => ({ mutate: fixture.write })])),
}))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: (permission: string) => fixture.permissions === null || fixture.permissions.has(permission) }) }))
vi.mock('@/hooks/useWorkspaceTabTitle', () => ({ useWorkspaceTabTitle: () => {} }))
vi.mock('@/hooks/useActiveWorkspaceTab', () => ({ useActiveWorkspaceTab: () => true }))
vi.mock('@/components/shared/DocumentActivityPanel', () => ({ DocumentActivityPanel: ({ view }: { view: string }) => <p>活动 {view}</p> }))
vi.mock('./CloseReceivingDialog', () => ({ default: () => null }))
vi.mock('@/components/print/OrderPrintOverlay', () => ({ OrderPrintOverlay: () => null }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const line: InboundTaskItem = { id: 1, taskId: 21, purchaseOrderId: 31, purchaseOrderNo: 'PO-31', purchaseItemId: 41, productId: 51, productCode: 'G-51', productName: '商品甲', articleNumber: '型号A', spec: '规格A', color: '黑色', unit: '个', orderedQty: 2, receivedQty: 2, putawayQty: 1, unitPrice: 3.4567 }
function task(status: InboundTask['status'] = 1, items = [line]): InboundTask {
  return { id: 21, taskNo: 'IN-21', purchaseOrderId: null, purchaseOrderNo: null, supplierName: '供应商甲', warehouseId: 1, warehouseName: '仓库甲', status, statusName: '收货状态', operatorId: 1, operatorName: '经办人甲', remark: '备注甲', createdAt: '2026-10-09T09:00:00Z', updatedAt: '2026-10-09T09:00:00Z', receiptStatus: { key: status === 1 ? 'draft' : 'receiving', label: status === 1 ? '草稿' : '收货中' }, items }
}
beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }) })
let cleanup: (() => Promise<void>) | undefined
async function setup() {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  const draw = () => act(async () => root.render(<MemoryRouter><TabPathContext.Provider value="/inbound-tasks/21"><Page /></TabPathContext.Provider></MemoryRouter>))
  cleanup = async () => { await act(async () => root.unmount()); host.remove() }
  await draw(); return { host, draw }
}
afterEach(async () => { await cleanup?.(); fixture.task = undefined; fixture.permissions = null; expect(fixture.write).not.toHaveBeenCalled(); vi.clearAllMocks(); vi.unstubAllGlobals() })

test('基础信息和准确采购来源保留，四标签切回仍为同一详情', async () => {
  fixture.task = task(); const { host } = await setup()
  expect(host.querySelector('h1')?.textContent).toBe('IN-21')
  for (const text of ['供应商甲', '仓库甲', '混合采购', '2026-10-09 17:00', '经办人甲', '备注甲', '¥3.4567']) expect(host.textContent).toContain(text)
  expect([...host.querySelectorAll('button')].some(button => button.textContent === 'PO-31')).toBe(true)
  const tabs = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
  expect(tabs.map(tab => tab.textContent)).toEqual(['收货信息', '收货进度', '库存条码', '操作记录'])
  for (const tab of [...tabs.slice(1), tabs[0]]) { await act(async () => tab.click()); expect(tab.getAttribute('aria-selected')).toBe('true') }
  expect(host.querySelector('[role="tabpanel"]:not([hidden])')?.textContent).toContain('备注甲')
})

test('虚拟明细汇总使用完整800行，四位单价及收货与上架基本量分别保真', async () => {
  fixture.task = task(2, Array.from({ length: 800 }, (_, index) => ({ ...line, id: index + 1, putawayQty: index % 2 ? 0 : 1 })))
  const { host } = await setup()
  expect(host.querySelector('strong')?.textContent).toBe('已上架金额合计¥1,382.68')
  expect(host.querySelector('[aria-label="应到"]')?.textContent).toContain('1,600')
  expect(host.querySelector('[aria-label="已收"]')?.textContent).toContain('1,600')
  expect(host.querySelector('[aria-label="已上架"]')?.textContent).toContain('400')
  expect(host.textContent).toContain('此金额不是本次已结算应付或采购结算凭证')
})

test.each([1, 2, 3, 4, 5] as const)('状态%s的管理入口和采购来源仍受权限控制，未确认可编辑资格不提供编辑', async status => {
  fixture.task = task(status); const { host, draw } = await setup()
  const buttons = () => [...host.querySelectorAll('button')].map(button => button.textContent?.trim())
  expect(buttons().includes('提交到 PDA')).toBe(status === 1)
  expect(buttons().includes('取消任务')).toBe(status === 1)
  expect(buttons().includes('结束收货')).toBe(status === 2)
  expect(buttons().includes('撤回收货')).toBe([2, 3, 4].includes(status))
  expect(buttons().includes('编辑')).toBe(false)
  fixture.permissions = new Set([PERMISSIONS.INBOUND_ORDER_VIEW]); await draw()
  for (const label of ['提交到 PDA', '取消任务', '结束收货', '撤回收货', 'PO-31']) expect(buttons()).not.toContain(label)
  expect(host.textContent).toContain('PO-31')
})

test('仅后端确认可编辑草稿且UPDATE提供独立编辑入口，导航原任务标签', async () => {
  fixture.task = { ...task(1, [{ ...line, receivedQty: 0, putawayQty: 0 }]), draftEditable: true, submittedAt: null }; const { host, draw } = await setup()
  const edit = () => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === '编辑')
  expect(edit()).toBeDefined(); await act(async () => edit()!.click()); expect(useWorkspaceStore.getState().tabs.some(tab => tab.path === '/inbound-tasks/21/edit')).toBe(true)
  for (const update of [{ submittedAt: '2026-10-09' }, { draftEditable: false }, { status: 2 as const }]) { fixture.task = { ...fixture.task, ...update }; await draw(); expect(edit()).toBeUndefined() }
  fixture.task = { ...task(1, [{ ...line, receivedQty: 0, putawayQty: 0 }]), draftEditable: true, submittedAt: null }; fixture.permissions = new Set([PERMISSIONS.INBOUND_ORDER_VIEW]); await draw(); expect(edit()).toBeUndefined()
})
test('详情运费方式和空/0金额仅记录，已上架金额汇总不相加', async () => {
  fixture.task = { ...task(2), freightType: 2, freightAmount: 12345 }; const { host, draw } = await setup()
  expect(host.textContent).toContain('运费方式：到付'); expect(host.textContent).toContain('运费金额：¥12,345.00'); expect(host.querySelector('strong')?.textContent).toBe('已上架金额合计¥3.46')
  fixture.task = { ...fixture.task, freightAmount: 0 }; await draw(); expect(host.textContent).toContain('运费金额：¥0.00')
  fixture.task = { ...fixture.task, freightAmount: null, freightType: null }; await draw(); expect(host.textContent).toContain('运费金额：—'); expect(host.textContent).toContain('运费方式：—')
})
