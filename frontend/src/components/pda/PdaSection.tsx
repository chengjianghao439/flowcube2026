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
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-1">
          {title}
        </p>
      )}
      <div className="rounded-2xl border border-border bg-white overflow-hidden">
        {children}
      </div>
    </div>
  )
}

/**
 * PdaSectionRow — Section 内的单行条目（带可选分隔线）
 *
 * 示例：
 *   商品名称          数量
 */
interface PdaSectionRowProps {
  label: string
  value?: ReactNode
  children?: ReactNode
  /** 是否显示底部分隔线，默认 true */
  divider?: boolean
}

export function PdaSectionRow({ label, value, children, divider = true }: PdaSectionRowProps) {
  return (
    <div
      className={`flex items-center justify-between px-4 py-3 text-sm ${
        divider ? 'border-b border-border last:border-0' : ''
      }`}
    >
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="font-medium text-foreground text-right">{value ?? children}</span>
    </div>
  )
}
