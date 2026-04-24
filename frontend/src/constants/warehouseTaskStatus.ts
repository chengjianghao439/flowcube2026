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

const TONE_CLASS = {
  draft: 'bg-secondary text-secondary-foreground border-secondary',
  active: 'bg-primary/10 text-primary border-primary/20',
  success: 'bg-success/10 text-success border-success/20',
  danger: 'bg-destructive/10 text-destructive border-destructive/20',
} as const

export const WT_STATUS_CLASS = Object.fromEntries(
  Object.entries(WT_STATUS_TONE).map(([status, tone]) => [Number(status), TONE_CLASS[tone]]),
) as Record<WtStatus, string>

export function isValidTransition(from: WtStatus, to: WtStatus): boolean {
  const allowed = WT_TRANSITIONS[String(from) as keyof typeof WT_TRANSITIONS] ?? []
  return (allowed as readonly number[]).includes(to)
}
