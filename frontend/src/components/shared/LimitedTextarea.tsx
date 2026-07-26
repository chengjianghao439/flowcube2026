import * as React from 'react'
import { cn } from '@/lib/utils'

interface LimitedTextareaProps extends React.ComponentProps<'textarea'> {
  maxLength: number
  /** 单行模式（配合 rows=1 使用）：计数角标改为上下居中，而不是贴底部 */
  singleLine?: boolean
}

/**
 * 带字符计数的 Textarea，右下角显示 "当前/最大" 计数。
 */
export const LimitedTextarea = React.forwardRef<HTMLTextAreaElement, LimitedTextareaProps>(
  ({ maxLength, value = '', className, rows = 3, singleLine = false, ...props }, ref) => {
    const len = String(value).length
    const near = len >= Math.floor(maxLength * 0.8)
    return (
      <div className="relative">
        <textarea
          ref={ref}
          maxLength={maxLength}
          value={value}
          rows={rows}
          className={cn(
            'w-full resize-none rounded-md border border-input bg-background px-3 py-2 pb-6 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
          {...props}
        />
        <span
          className={cn(
            'pointer-events-none absolute right-2.5 text-xs tabular-nums',
            singleLine ? 'top-1/2 -translate-y-1/2' : 'bottom-1.5',
            near ? 'text-orange-500' : 'text-muted-foreground',
          )}
        >
          {len}/{maxLength}
        </span>
      </div>
    )
  },
)
LimitedTextarea.displayName = 'LimitedTextarea'
