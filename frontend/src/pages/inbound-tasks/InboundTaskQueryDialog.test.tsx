// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import Page, { type InboundTaskQueryValues } from './InboundTaskQueryDialog'
vi.mock('@/components/finder', () => ({ SupplierFinder: () => null, ProductFinder: () => null }))
vi.mock('@/components/shared/OperatorSelectField', () => ({ default: () => <button>全部经办人</button> }))
vi.mock('@/components/shared/WarehouseSelect', () => ({ WarehouseSelect: () => <button>全部仓库</button> }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
HTMLElement.prototype.scrollIntoView = vi.fn()
const initial: InboundTaskQueryValues = { keyword: '', remark: '', operatorId: null, operatorName: '', status: '', productId: null, productName: '', productCode: '', supplierId: null, supplierName: '', warehouseId: null, warehouseName: '', startDate: '2026-10-03', endDate: '2026-10-09' }
afterEach(() => { document.body.innerHTML = ''; localStorage.clear() })
test('轮询的新 initial 对象不覆盖本次打开的草稿；重开/重置才初始化，查询才应用', async () => {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host), onApply = vi.fn()
  const draw = (open = true, values = { ...initial }) => act(async () => root.render(<Page open={open} initial={values} resetValues={{ startDate: initial.startDate, endDate: initial.endDate }} onClose={() => {}} onApply={onApply} />))
  const click = async (text: string) => act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === text)!.click())
  try {
    await draw(); const input = document.querySelector<HTMLInputElement>('input[placeholder="任务单号 / 采购单号…"]')!
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '未确认草稿'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    await draw(); expect(input.value).toBe('未确认草稿'); expect(onApply).not.toHaveBeenCalled()
    await click('查询'); expect(onApply.mock.calls[0][0].keyword).toBe('未确认草稿')
    await draw(false); await draw(); expect(document.querySelector<HTMLInputElement>('input[placeholder="任务单号 / 采购单号…"]')!.value).toBe('')
    await click('重置'); await click('查询'); expect(onApply).toHaveBeenLastCalledWith(initial)
  } finally { await act(async () => root.unmount()); host.remove() }
})
