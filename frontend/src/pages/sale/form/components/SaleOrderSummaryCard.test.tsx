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


it('紧凑金额条汇总全部200行并保留原折扣与低进价风险', () => {
  const items = Array.from({ length: 200 }, (_, index) => ({ _key: index + 1, productId: index + 1, unit: '个', quantity: 2, unitPrice: 3, costPrice: 4 })) as DraftItem[]
  const html = renderToStaticMarkup(<SaleOrderSummaryCard compact items={items} total={1200} discount={20} discountedTotal={1180} discountAmount="20" editableDiscount={false} warningText="存在低于进价的销售行，请核对" />)
  expect(html).toContain('aria-label="金额汇总"')
  expect(html).toContain('200 行')
  expect(html).toContain('400 个')
  expect(html).not.toContain('商品金额')
  expect(html).not.toContain('¥1,200.00')
  expect(html).toContain('¥1,180.00')
  expect(html).toContain('¥-20.00')
  expect(html).toContain('改单保留原折扣')
  expect(html).toContain('存在低于进价的销售行，请核对')
  expect(html).not.toContain('type="number"')
})


it('紧凑折扣错误就地提示并保留修改入口', () => {
  const html = renderToStaticMarkup(<SaleOrderSummaryCard compact items={[]} total={0} discount={10} discountedTotal={0} discountAmount="10" discountError="折扣金额不能超过订单合计" />)
  expect(html).toContain('role="alert"')
  expect(html).toContain('aria-invalid="true"')
  expect(html).toContain('折扣金额不能超过订单合计')
  expect(html).toContain('value="10"')
})
