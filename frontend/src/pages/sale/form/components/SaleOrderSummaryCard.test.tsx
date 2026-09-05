// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SaleOrderSummaryCard } from './SaleOrderSummaryCard'
import type { DraftItem } from '../validate'

it('新建和改单汇总将录入单位折算后分组，不混加件与米', () => {
  const items = [
    { _key: 1, productId: 1, unit: '件', entryUnit: '箱', quantity: 2, units: [{ unitName: '箱', conversionRate: 12 }] },
    { _key: 2, productId: 2, unit: '米', quantity: 1.25 },
    { _key: 3, productId: 0, unit: '件', quantity: 99 },
  ] as DraftItem[]
  const html = renderToStaticMarkup(<SaleOrderSummaryCard items={items} total={100} discount={10} discountedTotal={90} discountAmount="10" />)
  expect(html).toContain('24 件 / 1.25 米')
  expect(html).toContain('2 行')
  expect(html).toContain('¥90.00')
})
