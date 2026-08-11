import { describe, it, expect } from 'vitest'
import { formatQtyWithUnits } from './units'
import { getSaleWorkflowStatus } from './saleWorkflowStatus'
import type { SaleOrder } from '@/types/sale'

/**
 * 前端纯逻辑单元测试（审计 4.3 起步）。
 * units：多计量单位友好展示（纯展示，绝不参与库存/结算计算）。
 * saleWorkflowStatus：销售单状态推导（含取消收尾中/部分发货/仓库作业进度分支）。
 */

// ── units.ts 多单位展示 ────────────────────────────────────────────────────────
describe('formatQtyWithUnits', () => {
  const units = [
    { id: 1, unitName: '件', isBase: true, conversionRate: 1 },
    { id: 2, unitName: '箱', isBase: false, conversionRate: 12 },
    { id: 3, unitName: '托', isBase: false, conversionRate: 60 },
  ]

  it('能整除时显示最大辅助单位', () => {
    expect(formatQtyWithUnits(60, units)).toBe('60 件（1 托）')
    expect(formatQtyWithUnits(12, units)).toBe('12 件（1 箱）')
    expect(formatQtyWithUnits(120, units)).toBe('120 件（2 托）')
  })

  it('不能整除退回只显示基本单位', () => {
    expect(formatQtyWithUnits(13, units)).toBe('13 件')
    expect(formatQtyWithUnits(7, units)).toBe('7 件')
  })

  it('无辅助单位/单单位时只显示基本单位', () => {
    expect(formatQtyWithUnits(5, undefined)).toBe('5')
    expect(formatQtyWithUnits(5, null)).toBe('5')
    expect(formatQtyWithUnits(5, [units[0]])).toBe('5 件')
  })

  it('非数字数量安全处理（不崩溃，返回原始拼接）', () => {
    // 有 units 时 head = "NaN 件"，Number.isFinite 检查在 units 判断之前 return head
    expect(formatQtyWithUnits(NaN, units)).toBe('NaN 件')
  })
})

// ── saleWorkflowStatus.ts 状态推导 ─────────────────────────────────────────────
describe('getSaleWorkflowStatus', () => {
  const base = (over: Partial<SaleOrder> = {}): SaleOrder => ({
    id: 1, orderNo: 'SO-1', status: 1, customerName: '客户',
    warehouseTaskStatus: null, isMultiWarehouse: false,
    shippedTotalQty: 0, orderedTotalQty: 0, taskNo: null,
    ...over,
  } as SaleOrder)

  it('取消收尾中（status=5 + cancelRequestedAt）→ 待归还 danger', () => {
    const r = getSaleWorkflowStatus(base({ status: 5, warehouseTaskCancelRequestedAt: '2026-01-01' }))
    expect(r.label).toBe('待归还')
    expect(r.tone).toBe('danger')
  })

  it('已取消（status=5 无收尾中）→ 已取消 danger', () => {
    const r = getSaleWorkflowStatus(base({ status: 5 }))
    expect(r.label).toBe('已取消')
    expect(r.tone).toBe('danger')
  })

  it('部分发货（status=3 + 多仓或已发>0）→ 部分发货 active + 进度 detail', () => {
    const r = getSaleWorkflowStatus(base({ status: 3, isMultiWarehouse: true, shippedTotalQty: 2, orderedTotalQty: 5 }))
    expect(r.label).toBe('部分发货')
    expect(r.tone).toBe('active')
    expect(r.detail).toBe('已发 2/5')
  })

  it('单仓履约中（taskNo + warehouseTaskStatus）→ 用仓库作业状态', () => {
    const r = getSaleWorkflowStatus(base({ status: 3, taskNo: 'WT-1', warehouseTaskStatus: 2 }))
    // warehouseTaskStatus 2 = 拣货中
    expect(r.label).toBeTruthy()
    expect(r.tone).toBe('active')
  })

  it('仓库任务已出库（wt=7）→ success', () => {
    const r = getSaleWorkflowStatus(base({ status: 3, taskNo: 'WT-1', warehouseTaskStatus: 7 }))
    expect(r.tone).toBe('success')
  })

  it('仓库任务已取消（wt=8）→ 已取消 danger', () => {
    const r = getSaleWorkflowStatus(base({ status: 3, taskNo: 'WT-1', warehouseTaskStatus: 8 }))
    expect(r.label).toBe('已取消')
    expect(r.tone).toBe('danger')
  })

  it('无仓库任务时兜底用销售单状态（草稿 1）', () => {
    const r = getSaleWorkflowStatus(base({ status: 1 }))
    expect(r.label).toBeTruthy() // 草稿状态名
    expect(r.className).toContain('text-') // 有 tone class
  })
})
