import { describe, it, expect } from 'vitest'
import { summarizeSaleQuantities, getSaleAttention } from './salePresentation'
import type { SaleOrder } from '@/types/sale'
describe('销售展示语义', () => {
  it('按单位汇总并消除小数误差', () => {
    const rows = [
      { unit: '件', quantity: 0.1, reservedQty: 0.1 },
      { unit: '件', quantity: 0.2, reservedQty: 0.2 },
      { unit: '米', quantity: 3, reservedQty: 1 },
    ]
    expect(summarizeSaleQuantities(rows)).toEqual([
      { unit: '件', ordered: 0.3, reserved: 0.3, dispatched: 0, shipped: 0 },
      { unit: '米', ordered: 3, reserved: 1, dispatched: 0, shipped: 0 },
    ])
  })
  it('未占量不冒充库存缺货，取消单不提示补占', () => {
    const order = {
      status: 6,
      quantitySummary: [
        { unit: '件', ordered: 100, reserved: 60, dispatched: 0, shipped: 0 },
      ],
    } as SaleOrder
    expect(getSaleAttention(order).label).toContain('待占 40 件')
    expect(getSaleAttention({ ...order, status: 5 }).label).toBe('订单已取消')
  })
  it('尚未生成应收的订单不冒充已有逾期账款', () => {
    const order = {status: 3, receivableStatus: null, receivableOverdue: true} as SaleOrder
    expect(getSaleAttention(order).label).toBe('')
    expect(getSaleAttention({...order, receivableStatus: 1}).label).toBe('存在逾期未收款')
  })
  it('等待归还优先于普通履约和应收提示', () => {
    expect(
      getSaleAttention({
        status: 3,
        pendingAdjustment: true,
        receivableOverdue: true,
      } as SaleOrder).label,
    ).toBe('改单待实物归还')
  })
})
