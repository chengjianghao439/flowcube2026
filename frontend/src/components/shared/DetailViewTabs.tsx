import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

/** 两种既有状态容器共用呈现；Radix/调用方继续负责焦点、选择及保活。 */
export const DetailViewTabsList = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('desktop-detail-tabs fc-detail-view-tabs flex min-w-0 gap-1 overflow-x-auto rounded-lg border border-border bg-muted/30 p-1', className)} {...props} />
)
DetailViewTabsList.displayName = 'DetailViewTabsList'

export const DetailViewTabsTrigger = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, ...props }, ref) => <button ref={ref} type="button" className={cn('flex min-w-max shrink-0 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm motion-reduce:transition-none', className)} {...props} />
)
DetailViewTabsTrigger.displayName = 'DetailViewTabsTrigger'
