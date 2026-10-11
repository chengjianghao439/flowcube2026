// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import Page from './create'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { useDirtyGuardStore } from '@/store/dirtyGuardStore'
import type { InboundCreateRecord } from '@/hooks/useInboundTaskCreateRecovery'
import type { InboundPurchaseCandidate } from '@/types/inbound-tasks'
const state = vi.hoisted(() => ({ save: vi.fn(), can: true, pending: null as InboundCreateRecord | null, context: 'original-account-server' }))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => state.can }) }))
vi.mock('@/hooks/useInboundTasks', () => ({ useCreateInboundTask: () => ({ submit: state.save, pendingRecord: state.pending ? JSON.parse(JSON.stringify(state.pending)) : null, contextIdentity: state.context, busy: false, blocked: !!state.pending, error: '', canRetry: false }) }))
vi.mock('@/components/finder', () => ({ SupplierFinder: ({ open, onConfirm }: { open: boolean; onConfirm: (s: object) => void }) => open ? <button onClick={() => onConfirm({ id: 1, name: '供应商' })}>确定供应商</button> : null }))
vi.mock('./PurchaseItemPickerDialog', () => ({ PurchaseItemPickerDialog: ({ open, onConfirm }: { open: boolean; onConfirm: (rows: object[]) => void }) => open ? <button onClick={() => onConfirm([{ item: { purchaseItemId: 41, purchaseOrderNo: 'PO41', productName: '商品', warehouseId: 2, warehouseName: '仓库', remainingQty: 10, unit: '个', unitPrice: 3.4567 } as InboundPurchaseCandidate, qty: 2 }])}>确定来源</button> : null }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let host: HTMLDivElement, root: ReturnType<typeof createRoot>
beforeEach(() => { state.can = true; state.pending = null; state.context = 'original-account-server'; state.save.mockReset(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} }) })
afterEach(async () => { await act(async () => root.unmount()); host.remove(); useDirtyGuardStore.setState({ dirtyTabs: {}, pendingConfirm: null }); vi.unstubAllGlobals() })
const render = () => act(async () => root.render(<MemoryRouter><TabPathContext.Provider value="/inbound-tasks/new"><Page /></TabPathContext.Provider></MemoryRouter>))
const input = (name: string) => { const label = [...host.querySelectorAll('label')].find(l => l.textContent === name)!; return document.getElementById(label.htmlFor) as HTMLInputElement }
const fill = async (name: string, value: string) => act(async () => { const el = input(name); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
const click = async (name: string) => act(async () => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === name)!.click())
async function chosen() { await render(); await act(async () => input('供应商 *').click()); await click('确定供应商'); await click('选择商品'); await click('确定来源') }
test('新建无默认运费方式，空金额传null；0按0保存', async () => {
  await chosen(); expect(host.textContent).toContain('运费方式'); expect(input('运费金额').value).toBe(''); expect(host.textContent).toContain('请选择')
  await click('创建收货订单'); expect(state.save.mock.calls[0][0]).toMatchObject({ freightType: null, freightAmount: null })
  await fill('运费金额', '0'); await click('创建收货订单'); expect(state.save.mock.calls[1][0]).toMatchObject({ freightType: null, freightAmount: 0 })
})
test.each(['-1', '1.001', 'abc'])('新建非法金额%s保留原输入不保存或round', async value => {
  await chosen(); await fill('运费金额', value); await click('创建收货订单'); expect(input('运费金额').value).toBe(value); expect(state.save).not.toHaveBeenCalled()
})
test('只填运费即登记dirty，取消沿用防丢保护；无创建权限无保存入口', async () => {
  await render(); await fill('运费金额', '12.34'); await click('取消新建'); expect(useDirtyGuardStore.getState().pendingConfirm).not.toBeNull()
  state.can = false; await render(); expect([...host.querySelectorAll('button')].some(b => b.textContent?.trim() === '创建收货订单')).toBe(false)
})


test('重挂恢复原创建正文和零运费且冻结，重复render不循环；换账号清除旧显示', async () => {
  state.pending = { version: 1, userId: 11, baseURL: '/original/api', action: 'inbound.create', method: 'post', path: '/inbound-tasks', requestKey: 'original-key', fingerprint: 'a'.repeat(64), warehouseId: 2, createdAt: Date.now(), phase: 'pending', body: { supplierId: 1, supplierName: '原供应商', remark: '原备注', freightAmount: 0, freightType: null, items: [{ purchaseItemId: 41, qty: 1.25 }] }, displayRows: [{ item: { purchaseItemId: 41, purchaseOrderNo: 'PO41', productName: '原商品', warehouseId: 2, warehouseName: '原仓库', remainingQty: 10, unit: '个', unitPrice: 3 } as InboundPurchaseCandidate, qty: 1.25 }] }
  await render(); await render()
  expect(input('备注').value).toBe('原备注'); expect(input('运费金额').value).toBe('0'); expect(input('备注').disabled).toBe(true)
  expect(host.textContent).toContain('原供应商'); expect(host.textContent).toContain('原商品'); expect(host.textContent).toContain('查询原创建结果'); expect(state.save).not.toHaveBeenCalled()
  state.context = 'different-account-server'; state.pending = null; await render()
  expect(input('备注').value).toBe(''); expect(input('运费金额').value).toBe(''); expect(host.textContent).not.toContain('原供应商'); expect(host.textContent).not.toContain('原商品'); expect(state.save).not.toHaveBeenCalled()
})
