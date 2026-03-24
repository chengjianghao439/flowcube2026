/**
 * SectionCard — 内容区块卡片
 *
 * 页面内各功能区块的通用容器。
 * 支持可选标题行（左侧标题 + 右侧操作按钮区）。
 *
 * 使用示例：
 * ```tsx
 * // 无标题
 * <SectionCard>
 *   <p>内容</p>
 * </SectionCard>
 *
 * // 有标题 + 右侧操作
 * <SectionCard
 *   title="商品明细"
 *   actions={<Button size="sm" variant="outline">+ 添加行</Button>}
 * >
 *   <table>...</table>
 * </SectionCard>
 *
 * // 无内边距（自定义内容区）
 * <SectionCard title="数据列表" noPadding>
 *   <DataTable ... />
 * </SectionCard>
 * ```
 */

import { cn } from '@/lib/utils'

export interface SectionCardProps {
  /** 卡片标题（可选） */
  title?: string
  /** 标题右侧操作区（Button、Badge 等） */
  actions?: React.ReactNode
  /** Body 内容 */
  children: React.ReactNode
  /**
   * 是否去掉 Body 内边距。
   * DataTable 等已自带内边距的组件推荐使用。
   */
  noPadding?: boolean
  /** 额外 className（作用于卡片根节点） */
  className?: string
}

export function SectionCard({
  title,
  actions,
  children,
  noPadding = false,
  className,
}: SectionCardProps) {
  const hasHeader = title || actions

  return (
    <div className={cn('rounded-xl border border-border bg-card shadow-sm', className)}>
      {/* 标题行 */}
      {hasHeader && (
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          {title && (
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          )}
          {actions && (
            <div className="flex items-center gap-2">{actions}</div>
          )}
        </div>
      )}

      {/* Body */}
      <div className={cn(!noPadding && 'p-5')}>
        {children}
      </div>
    </div>
  )
}
