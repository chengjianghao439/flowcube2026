/**
 * 分拣格管理 — 模块内共享状态常量
 * 列表页与查询弹窗共用，避免两处各自定义一份导致漂移。
 */
import type { StatusTone } from '@/lib/statusTone'

export const SORTING_BIN_STATUS_TONE: Record<number, StatusTone> = {
  1: 'draft',  // 空闲
  2: 'active', // 占用
}

export const SORTING_BIN_STATUS_LABEL: Record<number, string> = {
  1: '空闲',
  2: '占用',
}

/** 不含「全部状态」项，查询弹窗的 __all__ 占位由弹窗自身维护 */
export const SORTING_BIN_STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '1', label: '空闲' },
  { value: '2', label: '占用' },
]
