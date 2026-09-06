// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ProcurementSupplyDetails from './ProcurementSupplyDetails'
import { prepareProcurementTransfer, type ProcurementSupply } from '@/api/procurement-supply'
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => false }) }))
const supply: ProcurementSupply = { id: '1-2', productId: 1, productCode: 'P1', productName: '测试商品', unit: '件', warehouseId: 2, warehouseName: '目标仓', supplierId: null, supplierName: null, onHand: 0, reserved: 0, confirmedDemand: 73, draftSalesDemand: 73, forecastDemand: 0, residualForecast: 0, grossDemand: 73, safetyStock: 0, targetStock: 0, inTransit: 0, expectedBound: 0, provisionalCoverage: 0, netRequirement: 73, suggestedQty: 108, excessQty: 35, packMultiple: 12, minimumOrderQty: 100, entryUnit: '件', conversionRate: 1, transferCandidates: [] }
let host: HTMLDivElement, root: Root
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })
describe('procurement supply explanation', () => {
  it('explains net requirement, package overbuy and draft demand without treating unknown arrival as on time', () => {
    act(() => root.render(<MemoryRouter><QueryClientProvider client={new QueryClient()}><ProcurementSupplyDetails supply={supply} /></QueryClientProvider></MemoryRouter>))
    act(() => host.querySelector('button')!.click())
    expect(document.body.textContent).toContain('73 件')
    expect(document.body.textContent).toContain('108 件')
    expect(document.body.textContent).toContain('多购 35')
    expect(document.body.textContent).toContain('其中销售草稿')
    expect(document.body.textContent).toContain('最早销售交期：待确认')
  })
  it('hands candidate to a distinct editable transfer form without creating any transfer', () => {
    const path = prepareProcurementTransfer(supply, { warehouseId: 3, warehouseName: '来源仓', quantity: 20, arrivalCondition: '需人工确认', expectedArrival: null })
    expect(path.startsWith('/transfer/new?procurement=')).toBe(true)
    const key = new URLSearchParams(path.split('?')[1]).get('procurement')!
    const payload = JSON.parse(sessionStorage.getItem(key)!)
    expect(payload.fromWarehouseId).toBe(3)
    expect(payload.toWarehouseId).toBe(2)
    expect(payload.items[0].quantity).toBe(20)
    sessionStorage.removeItem(key)
  })
})
