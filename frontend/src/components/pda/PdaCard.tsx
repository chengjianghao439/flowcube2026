/**
 * PdaCard — PDA 通用卡片容器
 *
 * 替代各页面重复的 `rounded-2xl border border-border bg-card p-4` 结构。
 */
import type { ReactNode } from 'react'

interface PdaCardProps {
  children: ReactNode
  className?: string
  /** 激活状态：蓝色边框高亮（如「装箱中」「当前步骤」） */
  active?: boolean
  /** 完成状态：绿色浅背景（如已核验、已完成） */
  done?: boolean
  /** 点击回调（作为可交互卡片时使用） */
  onClick?: () => void
  /** 内边距，默认 p-4 */
  padding?: 'sm' | 'md' | 'lg'
}

const PADDING = { sm: 'p-3', md: 'p-4', lg: 'p-5' }

export default function PdaCard({
  children,
  className = '',
  active = false,
  done = false,
  onClick,
  padding = 'md',
}: PdaCardProps) {
  const base = 'rounded-2xl border transition-all'
  const state = active
    ? 'border-primary bg-primary/5'
    : done
      ? 'border-green-200 bg-green-50/40'
      : 'border-border bg-card'
  const interact = onClick ? 'cursor-pointer active:scale-[0.98] hover:shadow-sm' : ''

  const Tag = onClick ? 'button' : 'div'

  return (
    <Tag
      className={`${base} ${state} ${interact} ${PADDING[padding]} ${className}`}
      onClick={onClick}
      // 仅按钮需要 type 属性
      {...(onClick ? { type: 'button' as const } : {})}
    >
      {children}
    </Tag>
  )
}
