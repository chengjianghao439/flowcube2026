import * as React from 'react'
import { cn } from '@/lib/utils'

interface LimitedTextareaProps extends React.ComponentProps<'textarea'> {
  maxLength: number
  /** 单行模式（配合 rows=1 使用）：计数角标改为上下居中，而不是贴底部 */
  singleLine?: boolean
  /** 销售收货地址：按内容和列宽增高，保留短值紧凑高度。 */
  autoGrow?: boolean
}

/**
 * 带字符计数的 Textarea，右下角显示 "当前/最大" 计数。
 */
export const LimitedTextarea = React.forwardRef<HTMLTextAreaElement, LimitedTextareaProps>(
  ({ maxLength, value = '', className, rows = 3, singleLine = false, autoGrow = false, ...props }, ref) => {
    const localRef = React.useRef<HTMLTextAreaElement | null>(null)
    React.useLayoutEffect(() => {
      const node = localRef.current
      if (!autoGrow || !node) return
      const resize = () => {
        node.style.height = 'auto'
        const style = window.getComputedStyle(node)
        const borders = parseFloat(style.borderTopWidth || '0') + parseFloat(style.borderBottomWidth || '0')
        node.style.height = `${Math.max(36, node.scrollHeight + borders)}px`
      }
      resize()
      if (typeof ResizeObserver === 'undefined') {
        window.addEventListener('resize', resize)
        return () => window.removeEventListener('resize', resize)
      }
      let width = node.clientWidth
      const observer = new ResizeObserver(() => { if (node.clientWidth !== width) { width = node.clientWidth; resize() } })
      observer.observe(node)
      return () => observer.disconnect()
    }, [autoGrow, value])
    const len = String(value).length
    const near = len >= Math.floor(maxLength * 0.8)
    return (
      <div className="relative">
        <textarea
          ref={node => {
            localRef.current = node
            if (typeof ref === 'function') ref(node)
            else if (ref) ref.current = node
          }}
          maxLength={maxLength}
          value={value}
          rows={rows}
          className={cn(
            'w-full resize-none rounded-md border border-input bg-background px-3 py-2 pb-6 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
            autoGrow && 'block overflow-hidden pr-20 pb-0',
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
