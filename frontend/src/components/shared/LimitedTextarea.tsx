import * as React from 'react'
import { cn } from '@/lib/utils'

interface LimitedTextareaProps extends React.ComponentProps<'textarea'> {
  maxLength: number
}

/**
 * 带字符计数的 Textarea，右下角显示 "当前/最大" 计数。
 */
export const LimitedTextarea = React.forwardRef<HTMLTextAreaElement, LimitedTextareaProps>(
  ({ maxLength, value = '', className, rows = 3, ...props }, ref) => {
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
            'pointer-events-none absolute bottom-1.5 right-2.5 text-xs tabular-nums',
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
