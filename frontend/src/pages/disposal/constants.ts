/**
 * 滞销库存处理 — 模块内共享状态常量
 * 列表页、查询弹窗、详情弹窗共用，避免三处各自定义一份导致漂移。
 */
import type { StatusTone } from '@/lib/statusTone'
import { DISPOSAL_STATUS_NAME, DISPOSAL_STATUS_OPTIONS as GENERATED_STATUS_OPTIONS } from '@/generated/status'

export const DISPOSAL_STATUS_TONE: Record<number, StatusTone> = {
  1: 'draft',   // 草稿
  2: 'active',  // 待审批
  3: 'warning', // 已批准（待处置）
  4: 'success', // 已处置
  5: 'danger',  // 已驳回
  6: 'danger',  // 已取消
}

export const DISPOSAL_STATUS_LABEL: Record<number, string> = DISPOSAL_STATUS_NAME

export const DISPOSAL_STATUS_OPTIONS: Array<{ value: string; label: string }> = [...GENERATED_STATUS_OPTIONS]
