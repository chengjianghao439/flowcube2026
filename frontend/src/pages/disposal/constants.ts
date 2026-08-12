/**
 * 呆滞库存处置 — 模块内共享状态常量
 * 列表页、查询弹窗、详情弹窗共用，避免三处各自定义一份导致漂移。
 */
import type { StatusTone } from '@/lib/statusTone'

export const DISPOSAL_STATUS_TONE: Record<number, StatusTone> = {
  1: 'draft',   // 草稿
  2: 'active',  // 待审批
  3: 'warning', // 已批准（待处置）
  4: 'success', // 已处置
  5: 'danger',  // 已驳回
  6: 'danger',  // 已取消
}

export const DISPOSAL_STATUS_LABEL: Record<number, string> = {
  1: '草稿', 2: '待审批', 3: '已批准', 4: '已处置', 5: '已驳回', 6: '已取消',
}

export const DISPOSAL_STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '1', label: '草稿' },
  { value: '2', label: '待审批' },
  { value: '3', label: '已批准' },
  { value: '4', label: '已处置' },
  { value: '5', label: '已驳回' },
  { value: '6', label: '已取消' },
]
