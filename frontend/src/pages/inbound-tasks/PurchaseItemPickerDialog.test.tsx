// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { captureInboundEditOwner, type InboundEditOwner } from '@/hooks/useInboundTaskEditRecovery'
import { useAuthStore } from '@/store/authStore'
import type { User } from '@/types'
import { PERMISSIONS } from '@/lib/permission-codes'
import { PurchaseItemPickerDialog, type PickedPurchaseItem } from './PurchaseItemPickerDialog'
import type { InboundPurchaseCandidate } from '@/types/inbound-tasks'
const fixture = vi.hoisted(() => ({ rows: [] as InboundPurchaseCandidate[], error: null as unknown, fetching: false, verify: vi.fn(), verifyEdit: vi.fn(), refetch: vi.fn(), hiddenRetry: null as null | (() => void) }))
vi.mock('@/hooks/useInboundTasks', () => ({ useInboundPurchaseCandidates: (_id: number, keyword: string) => ({ data: { list: fixture.rows.filter(row => !keyword || row.productCode.includes(keyword)), pagination: { total: fixture.rows.length } }, error: fixture.error, isFetching: fixture.fetching, isLoading: false, refetch: fixture.refetch }) }))
vi.mock('@/api/inbound-tasks', () => ({ verifyInboundPurchaseSelection: fixture.verify, verifyInboundEditPurchaseSelection: fixture.verifyEdit }))
vi.mock('@/components/shared/QueryErrorState', () => ({ QueryErrorState: ({ error, onRetry }: { error: Error; onRetry: () => void }) => { fixture.hiddenRetry = onRetry; return <p>{error.message}<button onClick={onRetry}>重试</button></p> } }))
vi.mock('@/components/shared/AppDialog', () => ({ AppDialog: ({ open, children, footer }: { open: boolean; children: React.ReactNode; footer: React.ReactNode }) => open ? <section>{children}{footer}</section> : null }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const row = (id: number): InboundPurchaseCandidate => ({ purchaseItemId: id, purchaseOrderId: id, purchaseOrderNo: `PO${id}`, supplierId: 1, supplierName: '供应商', warehouseId: 1, warehouseName: '仓库', productId: 1, productCode: String(id), productName: '同商品不同采购来源', unit: id === 1 ? '个' : '米', spec: '', color: '', articleNumber: '', orderedQty: 10, assignedQty: 0, receivedQty: 0, remainingQty: 10, unitPrice: 3.4567 })
let cleanup: (() => Promise<void>) | undefined
afterEach(async () => { await cleanup?.(); fixture.verify.mockReset(); fixture.verifyEdit.mockReset(); useAuthStore.getState().logout(); fixture.error = null; fixture.fetching = false })
async function setup(initialSelection: Record<number, PickedPurchaseItem> = {}, editTaskId?: number, readOwner?: InboundEditOwner) {
  fixture.rows = [row(1), row(2)]; fixture.verify.mockImplementation(async (_supplier: number, ids: number[]) => fixture.rows.filter(row => ids.includes(row.purchaseItemId)))
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); const confirm = vi.fn(), cancel = vi.fn()
  const draw = (open = true) => act(async () => root.render(<PurchaseItemPickerDialog open={open} editTaskId={editTaskId} readOwner={readOwner} supplierId={1} initialSelection={initialSelection} onClose={cancel} onConfirm={confirm} />))
  cleanup = async () => { await act(async () => root.unmount()); host.remove() }
  await draw()
  const click = async (text: string) => act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === text)!.click())
  const fill = async (selector: string, value: string) => act(async () => { const input = host.querySelector<HTMLInputElement>(selector)!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
  return { host, confirm, cancel, draw, click, fill }
}
test('跨搜索确认包含完整稳定采购明细身份；替换/零数量不重复，同商品不同来源不合并', async () => {
  const ui = await setup()
  await ui.fill('input[data-purchase-item-id="1"]', '2'); await ui.fill('[aria-label="搜索采购单或商品"]', '2'); await ui.click('搜索')
  await ui.fill('input[data-purchase-item-id="2"]', '3'); expect(ui.host.textContent).toContain('已选 2 项'); await ui.click('确定')
  expect(ui.confirm.mock.calls[0][0].map((entry: PickedPurchaseItem) => [entry.item.purchaseItemId, entry.qty])).toEqual([[1, 2], [2, 3]])
  await ui.click('清空'); await ui.fill('input[data-purchase-item-id="1"]', '4'); await ui.fill('input[data-purchase-item-id="2"]', '0'); await ui.click('确定')
  expect(ui.confirm.mock.calls[1][0].map((entry: PickedPurchaseItem) => [entry.item.purchaseItemId, entry.qty])).toEqual([[1, 4]])
  expect(ui.host.textContent).toContain('¥3.4567')
})
test('取消与重开恢复原表单；读取失败/在途刷新不能确认，重试恢复', async () => {
  const ui = await setup({ 1: { item: row(1), qty: 1 } })
  await ui.fill('input[data-purchase-item-id="1"]', '2'); await ui.click('取消'); expect(ui.confirm).not.toHaveBeenCalled()
  await ui.draw(false); await ui.draw(); expect(ui.host.querySelector<HTMLInputElement>('input[data-purchase-item-id="1"]')!.value).toBe('1')
  fixture.error = new Error('候选503'); await ui.draw(); expect(ui.host.textContent).toContain('候选503'); expect(ui.host.textContent).not.toContain('暂无可用采购明细'); expect([...ui.host.querySelectorAll('button')].find(button => button.textContent === '确定')!.disabled).toBe(true)
  fixture.error = null; fixture.fetching = true; await ui.draw(); expect([...ui.host.querySelectorAll('button')].find(button => button.textContent === '确定')!.disabled).toBe(true)
  fixture.fetching = false; await ui.draw(); await ui.click('确定'); expect(ui.confirm).toHaveBeenCalledTimes(1)
})
test('确认核实失效或余量变化保持草稿，核对失败不交付残缺行', async () => {
  const ui = await setup({ 1: { item: row(1), qty: 2 }, 2: { item: row(2), qty: 3 } })
  fixture.verify.mockResolvedValue([row(1)]); await ui.click('确定'); expect(ui.confirm).not.toHaveBeenCalled(); expect(ui.host.textContent).toContain('已选 2 项'); expect(ui.host.textContent).toContain('已失效')
  fixture.verify.mockResolvedValue([row(1), { ...row(2), remainingQty: 1 }]); await ui.click('确定'); expect(ui.confirm).not.toHaveBeenCalled(); expect(ui.host.querySelector<HTMLInputElement>('input[data-purchase-item-id="2"]')!.value).toBe('3')
  fixture.verify.mockResolvedValue([row(1), row(2)]); await ui.click('确定'); expect(ui.confirm).toHaveBeenCalledTimes(1)
})

test('编辑选择器按原任务原端点核对完整IDs并保留原行身份', async () => {
  useAuthStore.getState().login('test', null, { id: 71, roleId: 99, permissions: [PERMISSIONS.INBOUND_ORDER_UPDATE] } as User); const owner = captureInboundEditOwner()
  const ui = await setup({ 1: { item: row(1), qty: 2, inboundItemId: 121 } }, 21, owner); fixture.verifyEdit.mockResolvedValue([row(1)]); await ui.click('确定')
  expect(fixture.verify).not.toHaveBeenCalled(); expect(fixture.verifyEdit).toHaveBeenCalledWith(21, [1], expect.objectContaining({ baseURL: owner.baseURL, automaticReplay: false }))
  expect(ui.confirm.mock.calls[0][0][0].inboundItemId).toBe(121)
})
test('选择器隐藏后旧重读回调不能绕过enabled发原查询', async () => {
  const ui = await setup(); fixture.error = new Error('503'); await ui.draw(); const retry = fixture.hiddenRetry!
  await ui.draw(false); await act(async () => retry()); expect(fixture.refetch).not.toHaveBeenCalled()
})

// 每一键都从受控DOM当前值继续插入/退格，并分别派发键盘和input事件；不一次fill完整小数。
async function key(input: HTMLInputElement, pressed: string) {
  await act(async () => {
    input.focus()
    input.dispatchEvent(new KeyboardEvent('keydown', { key: pressed, bubbles: true }))
    const start = input.selectionStart ?? input.value.length, end = input.selectionEnd ?? start
    const backspace = pressed === 'Backspace', from = backspace && start === end ? Math.max(0, start - 1) : start
    const raw = input.value.slice(0, from) + (backspace ? '' : pressed) + input.value.slice(end)
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, raw)
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: backspace ? 'deleteContentBackward' : 'insertText', data: backspace ? null : pressed }))
    input.setSelectionRange(from + (backspace ? 0 : pressed.length), from + (backspace ? 0 : pressed.length))
    input.dispatchEvent(new KeyboardEvent('keyup', { key: pressed, bubbles: true }))
  })
}
async function keys(input: HTMLInputElement, value: string) { for (const pressed of value) await key(input, pressed) }
async function blur(input: HTMLInputElement) { await act(async () => input.blur()) }
const pickerInput = (host: HTMLElement, id = 1) => host.querySelector<HTMLInputElement>(`input[data-purchase-item-id="${id}"]`)!

test.each(['new', 'edit'] as const)('实际%s选择路径逐键保留1.25、0.25与.25，失焦后确认正确原来源数量', async mode => {
  let owner: InboundEditOwner | undefined
  if (mode === 'edit') {
    useAuthStore.getState().login('test', null, { id: 71, roleId: 99, permissions: [PERMISSIONS.INBOUND_ORDER_UPDATE] } as User)
    owner = captureInboundEditOwner()
  }
  const ui = await setup({}, mode === 'edit' ? 21 : undefined, owner)
  fixture.verifyEdit.mockImplementation(async (_id: number, ids: number[]) => fixture.rows.filter(row => ids.includes(row.purchaseItemId)))
  for (const raw of ['1.25', '0.25', '.25']) {
    const input = pickerInput(ui.host)
    input.select(); await key(input, 'Backspace')
    let prefix = ''
    for (const pressed of raw) { prefix += pressed; await key(input, pressed); expect(input.value).toBe(prefix) }
    await blur(input); expect(input.value).toBe(String(Number(raw)))
    await ui.click('确定')
    expect(ui.confirm.mock.calls.at(-1)?.[0].map((entry: PickedPurchaseItem) => [entry.item.purchaseItemId, entry.qty])).toEqual([[1, Number(raw)]])
  }
  expect(mode === 'edit' ? fixture.verifyEdit : fixture.verify).toHaveBeenCalledTimes(3)
  expect(mode === 'edit' ? fixture.verify : fixture.verifyEdit).not.toHaveBeenCalled()
})
test('逐键退格保留1.中间状态，不吞点；修改到1.05后失焦和跨搜索仍保留完整两条来源', async () => {
  const ui = await setup(), input = pickerInput(ui.host)
  await keys(input, '1.25'); await key(input, 'Backspace'); await key(input, 'Backspace')
  expect(input.value).toBe('1.')
  await keys(input, '05'); await blur(input); expect(input.value).toBe('1.05')
  await ui.fill('[aria-label="搜索采购单或商品"]', '2'); await ui.click('搜索')
  await keys(pickerInput(ui.host, 2), '.25'); await blur(pickerInput(ui.host, 2)); await ui.click('确定')
  expect(ui.confirm.mock.calls[0][0].map((entry: PickedPurchaseItem) => [entry.item.purchaseItemId, entry.qty])).toEqual([[1, 1.05], [2, 0.25]])
  await ui.click('清空'); expect(pickerInput(ui.host).value).toBe('1.05')
})
test.each(['1.251', '-1', '11', '.'])('原始无效数量%s失焦和确认均拒绝，保留输入，不改成另一个数', async raw => {
  const ui = await setup(), input = pickerInput(ui.host)
  await keys(input, raw); await blur(input); expect(input.value).toBe(raw)
  await ui.click('确定'); expect(ui.confirm).not.toHaveBeenCalled(); expect(fixture.verify).not.toHaveBeenCalled()
  expect(input.value).toBe(raw); expect(ui.host.textContent).toContain('核对')
})
test('合法小数确认仍用当前服务端来源余量，不足时不交付或缩小原数量', async () => {
  const ui = await setup(), input = pickerInput(ui.host)
  await keys(input, '0.25'); fixture.verify.mockResolvedValue([{ ...row(1), remainingQty: 0.2 }]); await ui.click('确定')
  expect(ui.confirm).not.toHaveBeenCalled(); expect(input.value).toBe('0.25')
  fixture.verify.mockResolvedValue([row(1)]); await ui.click('确定'); expect(ui.confirm.mock.calls[0][0][0].qty).toBe(0.25)
})
