import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** 查询弹窗共用网格：字段从顶部排布，内容独立滚动，底部操作由 AppDialog 固定。 */
export function QueryFormLayout({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('grid h-full content-start grid-cols-2 gap-x-5 gap-y-4 overflow-y-auto px-5 py-4', className)}>{children}</div>
}
