import * as React from 'react'
import { cn } from '@/lib/utils'

interface LimitedInputProps extends React.ComponentProps<'input'> {
  maxLength: number
}

/**
 * 带字符计数的 Input，右侧显示 "当前/最大" 计数。
 * 超出 maxLength 后浏览器原生禁止继续输入。
 */
export const LimitedInput = React.forwardRef<HTMLInputElement, LimitedInputProps>(
  ({ maxLength, value = '', className, ...props }, ref) => {
    const len = String(value).length
    const near = len >= Math.floor(maxLength * 0.8)
    return (
      <div className="relative">
        <input
          ref={ref}
          maxLength={maxLength}
          value={value}
          className={cn(
            'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 pr-14 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
            className,
          )}
          {...props}
        />
        <span
          className={cn(
            'pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs tabular-nums',
            near ? 'text-orange-500' : 'text-muted-foreground',
          )}
        >
          {len}/{maxLength}
        </span>
      </div>
    )
  },
)
LimitedInput.displayName = 'LimitedInput'
