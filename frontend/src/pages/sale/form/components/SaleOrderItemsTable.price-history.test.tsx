// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { SaleOrderItemsTable } from './SaleOrderItemsTable'
import type { DraftItem } from '../validate'

const getCustomerPriceHistoryMock = vi.fn()

vi.mock('@/api/sale', () => ({
  getCustomerPriceHistoryApi: (...args: unknown[]) => getCustomerPriceHistoryMock(...args),
}))

vi.mock('@/hooks/useProductQtyPolicies', () => ({
  useProductQtyPolicies: () => () => true,
}))

const sampleItem: DraftItem = {
  _key: 1,
  productId: 101,
  productCode: 'P001',
  productName: '测试商品',
  articleNumber: null,
  spec: null,
  color: null,
  unit: '件',
  entryUnit: '件',
  units: [],
  quantity: 2,
  unitPrice: 100,
  remark: '',
  priceSource: 'default',
  priceExplanation: { kind: 'default' },
  resolvedPrice: null,
  resolvedPriceLevel: null,
  costPrice: 60,
}

describe('SaleOrderItemsTable 历史成交价', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    getCustomerPriceHistoryMock.mockReset()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => { root.unmount() })
    host.remove()
  })

  it('展示客户历史成交价，不展示毛利参考，点击后填入单价', async () => {
    getCustomerPriceHistoryMock.mockResolvedValue([
      { orderId: 12, orderNo: 'SL20261127002', orderDate: '2026-11-27', unitPrice: 118.5, quantity: 2, unit: '件' },
      { orderId: 9, orderNo: 'SL20261120001', orderDate: '2026-11-20', unitPrice: 120, quantity: 5, unit: '件' },
    ])
    const updateItem = vi.fn()
    const refs = createRef<Map<number, HTMLInputElement>>() as React.MutableRefObject<Map<number, HTMLInputElement>>
    refs.current = new Map()

    await act(async () => {
      root.render(
        <MemoryRouter>
          <SaleOrderItemsTable
            customerId={8}
            items={[sampleItem]}
            invalidItemKeys={new Set()}
            quantityRefs={refs}
            priceLoading={{}}
            setFinderItemKey={vi.fn()}
            setFinderOpen={vi.fn()}
            updateItem={updateItem}
            removeItem={vi.fn()}
          />
        </MemoryRouter>,
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    const buttons = Array.from(host.querySelectorAll('button'))
    const btn118 = buttons.find(b => b.textContent?.trim() === '¥118.5')
    const btn120 = buttons.find(b => b.textContent?.trim() === '¥120')
    expect(btn118).toBeTruthy()
    expect(btn120).toBeTruthy()
    expect(host.textContent).not.toMatch(/毛利|低于进价/)

    act(() => { btn118!.click() })
    expect(updateItem).toHaveBeenCalledWith(1, 'unitPrice', 118.5)
  })
})
