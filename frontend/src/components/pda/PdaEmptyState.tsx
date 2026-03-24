/**
 * PdaEmptyState — PDA 空状态组件
 *
 * 规格：居中布局 · min-h-[60vh] · icon + title + description + 可选按钮
 */
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'

// ─── 主空态组件 ────────────────────────────────────────────────────────────────

interface PdaEmptyStateProps {
  /** 标题文字 */
  title: string
  /** 副文字说明 */
  description?: string
  /** 图标节点（emoji 字符串或 ReactNode），默认 📦 */
  icon?: ReactNode
  /** 操作按钮文案 */
  actionText?: string
  /** 操作按钮回调 */
  onAction?: () => void
  /** 外层额外 className */
  className?: string
}

export default function PdaEmptyState({
  title,
  description,
  icon = '📦',
  actionText,
  onAction,
  className = '',
}: PdaEmptyStateProps) {
  return (
    <div
      className={`flex min-h-[60vh] flex-col items-center justify-center px-6 text-center ${className}`}
    >
      {/* 图标 */}
      <div className="text-5xl mb-4 select-none">
        {icon}
      </div>

      {/* 标题 */}
      <p className="text-base font-semibold text-foreground">{title}</p>

      {/* 副文字 */}
      {description && (
        <p className="mt-1.5 text-sm text-muted-foreground max-w-xs">{description}</p>
      )}

      {/* 操作按钮 */}
      {actionText && onAction && (
        <Button
          variant="outline"
          className="mt-6 w-full max-w-[200px]"
          onClick={onAction}
        >
          {actionText}
        </Button>
      )}
    </div>
  )
}

// ─── 带虚线边框的卡片版（列表区域占位用）────────────────────────────────────

interface PdaEmptyCardProps extends Omit<PdaEmptyStateProps, 'className'> {
  dashed?: boolean
}

export function PdaEmptyCard({ dashed = true, ...rest }: PdaEmptyCardProps) {
  return (
    <div
      className={`rounded-2xl border ${
        dashed ? 'border-dashed border-border bg-muted/20' : 'border-border bg-muted/10'
      }`}
    >
      <PdaEmptyState {...rest} className="min-h-[240px]" />
    </div>
  )
}

// ─── 加载 Spinner ─────────────────────────────────────────────────────────────

interface PdaLoadingProps {
  /** spinner 尺寸 px，默认 28 */
  size?: number
  className?: string
}

export function PdaLoading({ size = 28, className = '' }: PdaLoadingProps) {
  return (
    <div className={`flex items-center justify-center ${className}`}>
      <div
        className="animate-spin rounded-full border-2 border-primary border-t-transparent"
        style={{ width: size, height: size }}
      />
    </div>
  )
}
