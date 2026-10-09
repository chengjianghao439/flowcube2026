// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test } from 'vitest'
import { SaleOrderOverview } from './SaleOrderOverview'
import type { SaleOrder } from '@/types/sale'

test.each([
  { model: 'kit-v1', targets: [1, 1, 1, 2], label: '商品明细', count: 4 },
  { model: 'kit-v1', targets: [1, 1, 1, 2, 0], label: '商品明细', count: 4 },
  { model: undefined, targets: [1, 1, 1, 2], label: '商品明细', count: 2 }
])(
  'overview counts $model current rows while preserving ordinary and amount cards',
  ({ model, targets, label, count }) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const host = document.createElement('div'),
      root = createRoot(host)
    const order = {
      customerName: '测试客户',
      warehouseName: '测试仓',
      totalAmount: 130,
      discountAmount: 6.55,
      commercialModel: model,
      commercialGroups: targets.map((targetQty, i) => ({ id: i + 1, kind: i < 2 ? 'kit' : 'ordinary', targetQty })),
      items: [{ productId: 11 }, { productId: 12 }]
    } as unknown as SaleOrder
    try {
      act(() => root.render(<SaleOrderOverview order={order} />))
      const caption = Array.from(host.querySelectorAll('p')).find((p) => p.textContent === label)
      expect(caption?.nextElementSibling?.textContent).toBe(`${count} 行`)
      expect(host.textContent).toContain('测试客户')
      expect(host.textContent).toContain('测试仓')
      expect(host.textContent).toContain('订单金额¥123.45')
      expect(order.commercialGroups).toHaveLength(targets.length)
    } finally {
      act(() => root.unmount())
    }
  }
)
