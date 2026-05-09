/**
 * FilterCard — 筛选区容器卡片
 *
 * 用于包裹筛选条件（搜索框、下拉、日期等）。
 * 默认模式无外层卡片包裹，筛选控件直接展示。
 * 折叠模式（collapsible=true）使用小圆角、去阴影的轻量卡片。
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
      <div className={cn('flex flex-wrap items-center gap-2', className)}>
        {children}
      </div>
    )
  }

  return (
    <div className={cn('rounded-lg border border-border bg-card', className)}>
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
