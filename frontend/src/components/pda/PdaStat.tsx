/**
 * PdaStat — PDA 统计数值卡片
 *
 * 示例：
 *   ┌───────────┐
 *   📦
 *   拣货任务
 *   6
 *   └───────────┘
 */
import type { ReactNode } from 'react'

interface PdaStatProps {
  /** 图标（emoji 字符串或 ReactNode） */
  icon?: ReactNode
  /** 标签文字 */
  label: string
  /** 数值 */
  value: string | number
  /** 高亮主色 */
  accent?: boolean
}

export default function PdaStat({ icon, label, value, accent = false }: PdaStatProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-2xl border border-border bg-white px-3 py-4 text-center">
      {icon && <span className="text-2xl leading-none">{icon}</span>}
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={`text-2xl font-bold tabular-nums leading-none ${
          accent ? 'text-primary' : 'text-foreground'
        }`}
      >
        {value}
      </p>
    </div>
  )
}

/**
 * PdaStatGrid — 等宽统计网格容器
 */
export function PdaStatGrid({
  children,
  cols = 3,
}: {
  children: ReactNode
  cols?: 2 | 3 | 4
}) {
  const colClass = { 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4' }[cols]
  return <div className={`grid gap-3 ${colClass}`}>{children}</div>
}
