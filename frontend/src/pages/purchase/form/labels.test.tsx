// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import Page from './index'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { useDirtyGuardStore } from '@/store/dirtyGuardStore'

const write = vi.hoisted(() => vi.fn())
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }))
vi.mock('@/hooks/useActiveWorkspaceTab', () => ({ useActiveWorkspaceTab: () => true }))
vi.mock('@/hooks/useWarehouses', () => ({ useWarehousesActive: () => ({ data: [{ id: 1, name: '验收仓' }] }) }))
vi.mock('@/hooks/usePurchase', () => ({
  usePurchaseDetail: () => ({ data: { id: 12, orderNo: 'PO12', status: 1, supplierId: 1, supplierName: '验收供应商', warehouseId: 1, warehouseName: '验收仓', expectedDate: '2026-10-12', remark: '原备注', items: [] } }),
  ...Object.fromEntries(['useCreatePurchase', 'useUpdatePurchase', 'useConfirmPurchase', 'useWithdrawConfirmPurchase', 'useApprovePurchase', 'useRejectPurchase', 'useCancelPurchase'].map(name => [name, () => ({ mutate: write, isPending: false })])),
}))
vi.mock('@/components/finder', () => ({ SupplierFinder: () => null, ProductFinder: () => null }))
vi.mock('@/components/shared/OrderDetailSections', () => ({ OrderDetailSections: ({ children }: { children: React.ReactNode }) => <>{children}</> }))

let cleanup: (() => Promise<void>) | undefined
afterEach(async () => { await cleanup?.(); useDirtyGuardStore.setState({ dirtyTabs: {}, pendingConfirm: null }); expect(write).not.toHaveBeenCalled() })

test('采购编辑与新建同时挂载：四个字段的标签仅关联自己的表单，切换保留标识和独立草稿', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  cleanup = async () => { await act(async () => root.unmount()); host.remove() }
  const draw = (active: number) => act(async () => root.render(<MemoryRouter>{['/purchase/12?edit=1', '/purchase/new'].map((path, index) => <div key={path} data-form={index} hidden={index !== active}><TabPathContext.Provider value={path}><Page /></TabPathContext.Provider></div>)}</MemoryRouter>))
  await draw(0)
  const panels = [...host.querySelectorAll<HTMLElement>('[data-form]')]
  const fieldLabels = () => panels.map(panel => [...panel.querySelectorAll('label')].filter(label => ['供应商 *', '入库仓库 *', '预计到货日期', '备注'].includes(label.textContent ?? '')))
  const check = () => {
    const labels = fieldLabels(); expect(labels.map(group => group.length)).toEqual([4, 4])
    expect(new Set(labels.flat().map(label => label.htmlFor)).size).toBe(8)
    labels.forEach((group, index) => group.forEach(label => {
      expect(label.control, label.textContent ?? '').not.toBeNull()
      expect(panels[index].contains(label.control)).toBe(true)
      expect([...panels[index].querySelectorAll('label')].filter(item => item.control === label.control)).toEqual([label])
    }))
    return labels.flat().map(label => label.htmlFor)
  }
  const ids = check()
  const remarks = fieldLabels().map(group => group.find(label => label.textContent === '备注')!.control as HTMLInputElement)
  for (const [index, input] of remarks.entries()) await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, `草稿${index}`)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  for (const active of [1, 0, 1, 0]) {
    await draw(active); expect(check()).toEqual(ids)
    expect(remarks.map(input => input.value)).toEqual(['草稿0', '草稿1'])
    const date = fieldLabels()[active].find(label => label.textContent === '预计到货日期')!.control!
    await act(async () => date.focus()); expect(document.activeElement).toBe(date)
  }
})
