import { describe, it, expect } from 'vitest'
import { getSaleWorkflowStatus } from './saleWorkflowStatus'
import type { SaleOrder } from '@/types/sale'

/**
 * 前端纯逻辑单元测试（审计 4.3 起步）。
 * saleWorkflowStatus：销售单状态推导（含拣货退回中/部分发货/仓库作业进度分支）。
 */

// ── saleWorkflowStatus.ts 状态推导 ─────────────────────────────────────────────
describe('getSaleWorkflowStatus', () => {
  const base = (over: Partial<SaleOrder> = {}): SaleOrder => ({
    id: 1, orderNo: 'SO-1', status: 1, customerName: '客户',
    warehouseTaskStatus: null, isMultiWarehouse: false,
    shippedTotalQty: 0, orderedTotalQty: 0, taskNo: null,
    ...over,
  } as SaleOrder)

  it('拣货退回中（status=5 + cancelRequestedAt）→ 待归还 danger', () => {
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
