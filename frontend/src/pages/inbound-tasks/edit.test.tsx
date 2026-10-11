// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { getRoutePatternByPath } from '@/router/routeRegistry'
import Page from './edit'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { useAuthStore } from '@/store/authStore'
import { useDirtyGuardStore } from '@/store/dirtyGuardStore'
import { PERMISSIONS } from '@/lib/permission-codes'
import type { InboundTaskEditContext, InboundPurchaseCandidate } from '@/types/inbound-tasks'
import type { User } from '@/types'
const state = vi.hoisted(() => ({ contexts: {} as Record<number, InboundTaskEditContext>, error: null as unknown, fetched: true, fetching: false, retry: vi.fn(), put: vi.fn(), receipt: vi.fn(), verify: vi.fn(), active: true }))
vi.mock('@/hooks/useInboundTasks', async original => ({ ...await original<typeof import('@/hooks/useInboundTasks')>(), useInboundTaskEditContext: (id: number) => ({ data: state.contexts[id], error: state.error, isLoading: false, isError: !!state.error, isFetching: state.fetching, isPaused: false, isFetchedAfterMount: state.fetched, refetch: state.retry }) }))
vi.mock('@/api/inbound-tasks', async original => ({ ...await original<typeof import('@/api/inbound-tasks')>(), updateInboundTaskApi: state.put, verifyInboundEditPurchaseSelection: state.verify }))
vi.mock('@/api/operation-requests', () => ({ getOperationRequestStatusApi: state.receipt }))
vi.mock('@/hooks/useActiveWorkspaceTab', () => ({ useActiveWorkspaceTab: () => state.active }))
vi.mock('@/hooks/useWorkspaceTabTitle', () => ({ useWorkspaceTabTitle: () => {} }))
vi.mock('./PurchaseItemPickerDialog', () => ({ PurchaseItemPickerDialog: ({ open, initialSelection, onConfirm }: { open: boolean; initialSelection: Record<number, { item: InboundPurchaseCandidate; qty: number }>; onConfirm: (rows: object[]) => void }) => open ? <div><button onClick={() => onConfirm([...Object.values(initialSelection), { item: state.contexts[21].candidates[0], qty: 3 }, { item: state.contexts[21].candidates[1], qty: 4 }])}>替换来源选择</button></div> : null }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const candidate = (id: number): InboundPurchaseCandidate => ({ purchaseItemId: id, purchaseOrderId: id, purchaseOrderNo: `PO${id}`, supplierId: 1, supplierName: '供应商', warehouseId: 1, warehouseName: '固定仓', productId: 8, productCode: 'G8', productName: '同商品', articleNumber: '型号', spec: '规格', color: '黑', unit: '个', orderedQty: 10, assignedQty: 0, remainingQty: 10, receivedQty: 0, unitPrice: 3.4567 })
function context(id = 21): InboundTaskEditContext { return { supplierId: 1, expectedEditFingerprint: `baseline-${id}`, candidates: [candidate(41), candidate(42)], task: { id, taskNo: `IN-${id}`, status: 1, statusName: '待收货', draftEditable: true, submittedAt: null, supplierName: '固定供应商', warehouseId: 1, warehouseName: '固定仓', remark: '原备注', freightType: 2, freightAmount: 0, purchaseOrderId: null, purchaseOrderNo: null, operatorId: null, operatorName: null, createdAt: '2026-10-09', updatedAt: '2026-10-09', items: [{ id: id + 100, taskId: id, purchaseOrderId: 41, purchaseOrderNo: 'PO41', purchaseItemId: 41, productId: 8, productCode: 'G8', productName: '同商品', articleNumber: '型号', spec: '规格', color: '黑', unit: '个', orderedQty: 2, receivedQty: 0, putawayQty: 0, unitPrice: 3.4567 }] } } }
let host: HTMLDivElement, root: ReturnType<typeof createRoot>, cache: QueryClient
beforeEach(() => { localStorage.clear(); state.contexts = { 21: context(), 22: context(22) }; state.error = null; state.fetched = true; state.fetching = false; state.active = true; state.put.mockReset().mockRejectedValue({ status: 400, data: { inboundEditNotExecuted: true }, message: '数量变化' }); state.receipt.mockReset().mockResolvedValue({ status: 'not_found', data: null }); state.retry.mockReset(); state.verify.mockReset().mockResolvedValue([candidate(42)]); useAuthStore.getState().login('test', null, { id: 71, roleId: 99, permissions: [PERMISSIONS.INBOUND_ORDER_UPDATE, PERMISSIONS.INBOUND_ORDER_VIEW] } as User); vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} }); host = document.createElement('div'); document.body.append(host); root = createRoot(host); cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }) })
afterEach(async () => { await act(async () => root.unmount()); host.remove(); cache.clear(); useAuthStore.getState().logout(); useDirtyGuardStore.setState({ dirtyTabs: {}, pendingConfirm: null }); vi.unstubAllGlobals() })
const savedRequests = () => JSON.stringify(Object.keys(localStorage).filter(key => key.startsWith('flowcube-inbound-edit-v1:request:')).sort().map(key => [key, localStorage.getItem(key)]))
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
async function render(ids = [21]) { await act(async () => root.render(<QueryClientProvider client={cache}><MemoryRouter>{ids.map(id => { const path = `/inbound-tasks/${id}/edit`; return <section key={id} data-view={id}><TabPathContext.Provider value={path}><Page /></TabPathContext.Provider></section> })}</MemoryRouter></QueryClientProvider>)); await settle() }
const view = (id = 21) => host.querySelector<HTMLElement>(`[data-view="${id}"]`)!
const field = (name: string, id = 21) => { const label = [...view(id).querySelectorAll('label')].find(l => l.textContent === name)!; return document.getElementById(label.htmlFor) as HTMLInputElement }
const fill = async (el: HTMLInputElement, value: string) => act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
const button = (name: string, id = 21) => [...view(id).querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === name || b.getAttribute('aria-label') === name)!
const click = async (name: string, id = 21) => act(async () => button(name, id).click())
test('独立编辑路由要求UPDATE，完整回填固定头、采购行身份、单价及空0运费', async () => {
  expect(getRoutePatternByPath('/inbound-tasks/21/edit')?.permission).toBe(PERMISSIONS.INBOUND_ORDER_UPDATE)
  await render(); expect(field('供应商').value).toBe('固定供应商'); expect(field('供应商').readOnly).toBe(true); expect(field('仓库').readOnly).toBe(true); expect(field('备注').value).toBe('原备注'); expect(field('运费金额').value).toBe('0'); expect(view().textContent).toContain('到付'); expect(view().textContent).toContain('¥3.4567')
  expect(view().querySelector('tr[data-inbound-item-id="121"]')).not.toBeNull(); expect(view().querySelector<HTMLInputElement>('[data-purchase-item-id="41"]')!.value).toBe('2')
})
test('编辑采购来源去重同来源，不合并同商品不同来源，原行ID保持', async () => {
  await render(); await click('选择商品'); await click('替换来源选择')
  expect([...view().querySelectorAll<HTMLInputElement>('[data-purchase-item-id]')].map(i => [i.dataset.purchaseItemId, i.value])).toEqual([['41', '3'], ['42', '4']]); expect(view().querySelector('tr[data-inbound-item-id="121"]')).not.toBeNull()
})
test('保存mock只传备注/来源数量/运费/原指纹，失败输入保持、明确拒绝可纠正换key', async () => {
  await render(); await fill(field('备注'), '改后'); await fill(field('运费金额'), '12.34'); await fill(view().querySelector<HTMLInputElement>('[data-purchase-item-id="41"]')!, '3'); await click('保存修改')
  expect(state.put.mock.calls[0][1]).toEqual({ remark: '改后', freightType: 2, freightAmount: 12.34, expectedEditFingerprint: 'baseline-21', items: [{ purchaseItemId: 41, qty: 3 }] }); const key = state.put.mock.calls[0][2]
  expect(field('备注').value).toBe('改后'); await fill(field('运费金额'), '0'); await click('保存修改'); expect(state.put.mock.calls[1][2]).not.toBe(key); expect(state.put.mock.calls[1][1].freightAmount).toBe(0)
})
test('取消登记dirty，两个编辑标签基线和输入独立；外部数据不覆盖dirty', async () => {
  await render([21, 22]); await fill(field('备注'), 'A草稿'); await fill(field('备注', 22), 'B草稿'); await click('取消编辑'); expect(useDirtyGuardStore.getState().pendingConfirm).not.toBeNull()
  state.contexts[21] = { ...context(), task: { ...context().task, remark: '轮询新备注' } }; await render([21, 22]); expect(field('备注').value).toBe('A草稿'); expect(field('备注', 22).value).toBe('B草稿'); await click('保存修改', 22); expect(state.put.mock.calls.at(-1)?.[1].expectedEditFingerprint).toBe('baseline-22')
})
test.each(['permission', 'submitted', 'received', 'container', 'read-error', 'fingerprint'])('%s变化保留草稿并禁止保存', async change => {
  await render(); await fill(field('备注'), '保留')
  if (change === 'permission') act(() => useAuthStore.getState().updateUser({ permissions: [] }))
  if (change === 'submitted') state.contexts[21].task.submittedAt = '2026-10-09'
  if (change === 'received') state.contexts[21].task.items![0].receivedQty = 1
  if (change === 'container') state.contexts[21].task.draftEditable = false
  if (change === 'read-error') state.error = { status: 503 }
  if (change === 'fingerprint') state.contexts[21].expectedEditFingerprint = 'external-change'
  await render(); expect(field('备注').value).toBe('保留'); expect(button('保存修改').disabled).toBe(true); await click('保存修改'); expect(state.put).not.toHaveBeenCalled()
})
test('unknown冻结输入，重挂恢复原运费body查询，非草稿仍允许查询原结果', async () => {
  await render(); await fill(field('运费金额'), '12.34'); state.put.mockRejectedValue({ status: 504 }); await click('保存修改'); expect(field('备注').disabled).toBe(true); expect(button('保存修改').disabled).toBe(true)
  await act(async () => root.unmount()); root = createRoot(host); state.contexts[21].task.draftEditable = false; state.contexts[21].task.submittedAt = '2026-10-09'; await render(); expect(state.put).toHaveBeenCalledTimes(1); expect(view().textContent).toContain('查询原保存结果'); await click('查询原保存结果'); expect(state.receipt).toHaveBeenCalledTimes(1); expect(state.put).toHaveBeenCalledTimes(1)
})
test('运费空值按null，金额三位或负数阻止保存并保持原输入', async () => {
  await render(); for (const value of ['1.001', '-1']) { await fill(field('运费金额'), value); await click('保存修改'); expect(field('运费金额').value).toBe(value); expect(state.put).not.toHaveBeenCalled() }
  await fill(field('运费金额'), ''); await click('保存修改'); expect(state.put.mock.calls[0][1].freightAmount).toBeNull()
})

test('成功mock保存完成原标签并刷新可查看原单；不把旧body重新应用', async () => {
  act(() => useAuthStore.getState().updateUser({ permissions: [PERMISSIONS.INBOUND_ORDER_UPDATE, PERMISSIONS.INBOUND_ORDER_VIEW] })); await render()
  state.put.mockResolvedValue({ taskId: 21, taskNo: 'IN-21', expectedEditFingerprint: 'saved-21' }); await click('保存修改')
  expect(useWorkspaceStore.getState().tabs.some(tab => tab.path === '/inbound-tasks/21')).toBe(true)
  expect(savedRequests()).toBe('[]')
})

test('800行原明细完整回填并保存末行，虚拟展示不裁掉载荷或来源ID', async () => {
  const original = context(); original.candidates = Array.from({ length: 800 }, (_, i) => candidate(i + 1000)); original.task.items = original.candidates.map((c, i) => ({ ...original.task.items![0], id: i + 2000, purchaseItemId: c.purchaseItemId, purchaseOrderId: c.purchaseOrderId, purchaseOrderNo: c.purchaseOrderNo }))
  state.contexts[21] = original; await render(); await click('保存修改'); const sent = state.put.mock.calls[0][1]
  expect(sent.items).toHaveLength(800); expect(sent.items[799]).toEqual({ purchaseItemId: 1799, qty: 2 }); expect(view().textContent).toContain('商品明细：800 行')
})

test.each([2, 3, 4, 5] as const)('初始状态%s非草稿不开放编辑或保存', async status => {
  state.contexts[21].task.status = status; state.contexts[21].task.draftEditable = false; await render()
  expect(view().querySelector('[data-purchase-item-id]')).toBeNull(); expect(button('保存修改').disabled).toBe(true); await click('保存修改'); expect(state.put).not.toHaveBeenCalled()
})
test('初始无UPDATE不回填或保存；旧缓存未本次成功读取不建立基线', async () => {
  act(() => useAuthStore.getState().updateUser({ permissions: [] })); await render(); expect(view().querySelector('[data-purchase-item-id]')).toBeNull(); expect(button('保存修改').disabled).toBe(true)
  await act(async () => root.unmount()); root = createRoot(host); act(() => useAuthStore.getState().updateUser({ permissions: [PERMISSIONS.INBOUND_ORDER_UPDATE] })); state.fetched = false; await render(); expect(view().querySelector('[data-purchase-item-id]')).toBeNull()
  state.fetched = true; await render(); expect(view().querySelector('[data-purchase-item-id]')).not.toBeNull()
})

test('unknown新增来源刷新仅原A context时，精确核对B并恢复原body备注/null0运费，不自动PUT', async () => {
  state.contexts[21].task.freightType = null; await render(); await fill(field('备注'), '待确认备注'); await click('选择商品'); await click('替换来源选择'); state.put.mockRejectedValue({ status: 504 }); await click('保存修改')
  const stored = savedRequests(); await act(async () => root.unmount()); root = createRoot(host); state.contexts[21] = context(); state.contexts[21].candidates = [candidate(41)]; await render()
  expect(state.verify).toHaveBeenCalledWith(21, [42], expect.objectContaining({ automaticReplay: false, _erpApiFallbackTried: true }))
  expect(field('备注').value).toBe('待确认备注'); expect(field('运费金额').value).toBe('0'); expect(view().textContent).toContain('请选择')
  expect([...view().querySelectorAll<HTMLInputElement>('[data-purchase-item-id]')].map(i => [i.dataset.purchaseItemId, i.value])).toEqual([['41', '3'], ['42', '4']])
  expect(state.put).toHaveBeenCalledTimes(1); expect(savedRequests()).toBe(stored)
})
test('unknown新增来源核对失败保留完整请求和回执入口，不造来源或PUT', async () => {
  await render(); await click('选择商品'); await click('替换来源选择'); state.put.mockRejectedValue({ status: 504 }); await click('保存修改'); const stored = savedRequests()
  await act(async () => root.unmount()); root = createRoot(host); state.contexts[21].candidates = [candidate(41)]; state.verify.mockResolvedValue([]); await render()
  expect(view().textContent).toContain('原采购明细身份不完整'); expect(view().querySelector('[data-purchase-item-id="42"]')).toBeNull(); await click('查询原保存结果')
  expect(state.receipt).toHaveBeenCalledTimes(1); expect(state.put).toHaveBeenCalledTimes(1); expect(savedRequests()).toBe(stored)
})

test.each(['inactive', 'permission', 'owner'])('pending缺失来源核对在途%s变化不回填迟到结果或修改原请求', async change => {
  await render(); await click('选择商品'); await click('替换来源选择'); state.put.mockRejectedValue({ status: 504 }); await click('保存修改'); const stored = savedRequests()
  await act(async () => root.unmount()); root = createRoot(host); state.contexts[21].candidates = [candidate(41)]; let release!: (rows: InboundPurchaseCandidate[]) => void; state.verify.mockImplementation(() => new Promise(resolve => { release = resolve })); await render(); expect(state.verify).toHaveBeenCalledTimes(1)
  if (change === 'inactive') state.active = false
  if (change === 'permission') act(() => useAuthStore.getState().updateUser({ permissions: [] }))
  if (change === 'owner') act(() => useAuthStore.getState().login('other', null, { id: 72, roleId: 99, permissions: [PERMISSIONS.INBOUND_ORDER_UPDATE] } as User))
  await render(); await act(async () => release([candidate(42)])); expect(view().querySelector('[data-purchase-item-id]')).toBeNull(); expect(state.put).toHaveBeenCalledTimes(1); expect(savedRequests()).toBe(stored)
})

test('原回执scope403保持原body/key和冻结输入，不另发PUT', async () => {
  await render(); state.put.mockRejectedValue({ status: 504 }); await click('保存修改'); const raw = savedRequests(); state.receipt.mockRejectedValue(Object.assign(new Error('当前仓库范围已变化'), { status: 403, code: 'WAREHOUSE_SCOPE_DENIED' })); await click('查询原保存结果')
  expect(view().textContent).toContain('当前仓库范围已变化'); expect(savedRequests()).toBe(raw); expect(button('保存修改').disabled).toBe(true); expect(state.put).toHaveBeenCalledTimes(1)
})
test('编辑UPDATE独立可保存；未知后撤VIEW保留输入且不允许查询服务器原回执', async () => {
  act(() => useAuthStore.getState().updateUser({ permissions: [PERMISSIONS.INBOUND_ORDER_UPDATE] })); await render(); state.put.mockRejectedValue({ status: 504 }); await click('保存修改'); const raw = savedRequests(); expect(view().textContent).toContain('联系有权人员'); expect(button('查询原保存结果').disabled).toBe(true); await click('查询原保存结果'); expect(state.receipt).not.toHaveBeenCalled(); expect(savedRequests()).toBe(raw)
})

test('逐键输入1.25/0.25保留中间dot，最终正数两位按原来源保存', async () => {
  state.contexts[21].candidates[0].remainingQty = 20; await render(); const input = view().querySelector<HTMLInputElement>('[data-purchase-item-id="41"]')!
  for (const value of ['1.25', '0.25']) { await fill(input, ''); for (const key of value) await fill(input, input.value + key); expect(input.value).toBe(value); await click('保存修改'); expect(state.put.mock.calls.at(-1)?.[1].items[0]).toEqual({ purchaseItemId: 41, qty: Number(value) }) }
})
test('新edit备注超200完整原文不自动截断且不发PUT', async () => {
  const original = '字'.repeat(201); state.contexts[21].task.remark = original; await render(); expect(field('备注').value).toBe(original); expect(field('备注').maxLength).toBe(200); await click('保存修改'); expect(state.put).not.toHaveBeenCalled(); expect(field('备注').value).toBe(original)
})
