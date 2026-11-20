/**
 * PdaSection — PDA 带标题的内容区块
 *
 * 示例：
 *   商品列表
 *   ─────────────────
 *   内容
 */
import type { ReactNode } from 'react'

interface PdaSectionProps {
  /** 区块标题（可选） */
  title?: string
  children: ReactNode
  className?: string
}

export default function PdaSection({ title, children, className = '' }: PdaSectionProps) {
  return (
    <div className={`space-y-2 ${className}`}>
      {title && (
        <p className="text-xs font-semibold text-muted-foreground px-1">
          {title}
        </p>
      )}
      <div className="rounded-2xl border border-border bg-card text-card-foreground overflow-hidden">
        {children}
      </div>
    </div>
  )
}
