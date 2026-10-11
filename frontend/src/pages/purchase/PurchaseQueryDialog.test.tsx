// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import Page, { type PurchaseQueryValues } from './PurchaseQueryDialog'
vi.mock('@/components/finder', () => ({ SupplierFinder: () => null, ProductFinder: () => null }))
vi.mock('@/components/shared/OperatorSelectField', () => ({ default: () => <button>全部经办人</button> }))
vi.mock('@/components/shared/WarehouseSelect', () => ({ WarehouseSelect: () => <button>全部仓库</button> }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
HTMLElement.prototype.scrollIntoView = vi.fn()
const initial: PurchaseQueryValues = { keyword: '', remark: '', operatorId: null, operatorName: '', status: '', productId: null, productName: '', productCode: '', supplierId: null, supplierName: '', warehouseId: null, warehouseName: '', startDate: '2026-10-03', endDate: '2026-10-09' }
afterEach(() => { document.body.innerHTML = ''; localStorage.clear() })
test('查询采购状态含列表已有的待审批，重置保持本页日期', async () => {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host), onApply = vi.fn()
  try {
    await act(async () => root.render(<Page open initial={initial} resetValues={{ startDate: '2026-10-03', endDate: '2026-10-09' }} onClose={() => {}} onApply={onApply} />))
    await act(async () => document.querySelector<HTMLElement>('[role=combobox]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect([...document.querySelectorAll('[role=option]')].map(n => n.textContent)).toContain('待审批')
    await act(async () => document.querySelector<HTMLElement>('[role=listbox]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    const buttons = () => [...document.querySelectorAll('button')]
    await act(async () => buttons().find(b => b.textContent === '重置')!.click())
    await act(async () => buttons().find(b => b.textContent === '查询')!.click())
    expect(onApply).toHaveBeenLastCalledWith(initial)
  } finally { await act(async () => root.unmount()); host.remove() }
})
