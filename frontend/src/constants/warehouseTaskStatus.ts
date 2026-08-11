import {
  WT_ACTION_RULES,
  WT_KANBAN_COLUMNS,
  WT_STATUS,
  WT_STATUS_ACTIVE,
  WT_STATUS_NAME,
  WT_STATUS_OPTIONS,
  WT_STATUS_PICK_POOL,
  WT_STATUS_TERMINAL,
  WT_STATUS_TONE,
  WT_TRANSITIONS,
  type WtStatus,
} from '@/generated/status'
import { STATUS_TONE_CLASS, type StatusTone } from '@/lib/statusTone'

export {
  WT_ACTION_RULES,
  WT_KANBAN_COLUMNS,
  WT_STATUS,
  WT_STATUS_ACTIVE,
  WT_STATUS_NAME,
  WT_STATUS_OPTIONS,
  WT_STATUS_PICK_POOL,
  WT_STATUS_TERMINAL,
  WT_STATUS_TONE,
  WT_TRANSITIONS,
  type WtStatus,
}

export const WT_STATUS_CLASS = Object.fromEntries(
  Object.entries(WT_STATUS_TONE).map(([status, tone]) => [Number(status), STATUS_TONE_CLASS[tone]]),
) as Record<WtStatus, string>

/** 仓库任务优先级 → 状态 tone：1紧急 2普通 3低。PDA 拣货/复核/打包共用。 */
export const WT_PRIORITY_TONE: Record<number, StatusTone> = { 1: 'danger', 2: 'active', 3: 'draft' }
