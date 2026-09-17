/**
 * EditModeBadge / UnsavedBadge — 「编辑中」「未保存」标识
 *
 * 背景（2026-09-18）：编辑已有记录时，页面与默认（新建/只读）态此前只差标题一行字，
 * 用户分不清自己是否处于编辑态、也看不出哪些改动还没保存。现约定：
 *
 * - 凡是编辑已有记录的页面/弹窗，标题旁显示 `<EditModeBadge />`，并尽量带上编辑对象
 *   （单号、编码或名称），主操作按钮统一叫「保存修改」，与默认态的「创建 / 保存草稿」区分。
 * - 编辑态下表单有未保存改动时显示 `<UnsavedBadge />`，与未改动的默认态区分。
 *
 * 配色沿用 `@/lib/statusTone` 的档位（浅底 + 同色描边 + 同色文字），不另起炉灶。
 */
import { Pencil } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { STATUS_TONE_CLASS } from '@/lib/statusTone'
import { cn } from '@/lib/utils'

interface BadgeProps {
  className?: string
  /** 自定义文案，默认「编辑中」 */
  label?: string
}

/** 「编辑中」：当前页面/弹窗正在编辑已有记录 */
export function EditModeBadge({ className, label = '编辑中' }: BadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn('gap-1 text-xs font-medium', STATUS_TONE_CLASS.active, className)}
    >
      <Pencil className="h-3 w-3" aria-hidden="true" />
      {label}
    </Badge>
  )
}

interface UnsavedBadgeProps extends BadgeProps {
  /** 是否显示；false 时渲染 null，便于直接写在 JSX 条件里 */
  show?: boolean
}

/** 「未保存」：编辑态下存在尚未提交的改动 */
export function UnsavedBadge({ show = true, className, label = '未保存' }: UnsavedBadgeProps) {
  if (!show) return null
  return (
    <Badge
      variant="outline"
      className={cn('text-xs font-medium', STATUS_TONE_CLASS.warning, className)}
    >
      {label}
    </Badge>
  )
}
