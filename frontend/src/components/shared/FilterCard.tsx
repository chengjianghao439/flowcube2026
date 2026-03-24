/**
 * FilterCard — 筛选区容器卡片
 *
 * 用于包裹筛选条件（搜索框、下拉、日期等）。
 * 已内置 rounded-xl + border + bg-card + shadow-sm，
 * 调用方只需传入筛选内容，无需关心外层卡片样式。
 *
 * 使用示例：
 * ```tsx
 * <FilterCard>
 *   <Input placeholder="搜索..." className="w-56" />
 *   <select ...>...</select>
 *   <Button size="sm">搜索</Button>
 * </FilterCard>
 *
 * // 折叠模式（可展开/收起）
 * <FilterCard collapsible label="高级筛选">
 *   ...
 * </FilterCard>
 * ```
 */

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface FilterCardProps {
  /** 筛选内容，inline 横向排列 */
  children: React.ReactNode
  /** 额外 className */
  className?: string
  /** 是否支持折叠（默认展开） */
  collapsible?: boolean
  /** collapsible=true 时的折叠标签文字 */
  label?: string
  /** collapsible=true 时初始是否展开，默认 true */
  defaultOpen?: boolean
}

export function FilterCard({
  children,
  className,
  collapsible = false,
  label = '筛选条件',
  defaultOpen = true,
}: FilterCardProps) {
  const [open, setOpen] = useState(defaultOpen)

  if (!collapsible) {
    return (
      <div className={cn('rounded-xl border border-border bg-card px-4 py-3 shadow-sm', className)}>
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      </div>
    )
  }

  return (
    <div className={cn('rounded-xl border border-border bg-card shadow-sm', className)}>
      {/* 折叠触发器 */}
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-foreground"
        onClick={() => setOpen(v => !v)}
      >
        <span>{label}</span>
        <ChevronDown
          className={cn('h-4 w-4 text-muted-foreground transition-transform duration-200', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="border-t border-border px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">{children}</div>
        </div>
      )}
    </div>
  )
}
