/**
 * PdaHeader — PDA 页面顶部导航栏
 *
 * 规格：height 56px · bg-white · border-bottom · sticky top
 * 布局：[ ← 返回 ]  [ 页面标题 / 副标题 ]  [ right? ]
 */
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'

interface ProgressProps {
  current: number
  total: number
  label?: string
}

interface PdaHeaderProps {
  /** 页面标题 */
  title: string
  /** 副标题（显示在标题下方） */
  subtitle?: string
  /** 返回按钮文本，默认「← 返回」 */
  backLabel?: string
  /** 点击返回回调；不传则左侧留空 */
  onBack?: () => void
  /** 右侧插槽（按钮、徽章等） */
  right?: ReactNode
  /** 可选进度条（显示在标题行下方） */
  progress?: ProgressProps
}

export default function PdaHeader({
  title,
  subtitle,
  backLabel = '← 返回',
  onBack,
  right,
  progress,
}: PdaHeaderProps) {
  const pct = progress
    ? Math.min(100, progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0)
    : 0

  return (
    <div className="sticky top-0 z-10 border-b border-border bg-white" style={{ minHeight: 56 }}>
      <div className="max-w-md mx-auto px-4 flex items-center" style={{ height: 56 }}>

        {/* 左：返回按钮（固定宽度保证标题居中） */}
        <div className="w-16 shrink-0">
          {onBack && (
            <button
              onClick={onBack}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
            >
              {backLabel}
            </button>
          )}
        </div>

        {/* 中：标题 + 副标题 */}
        <div className="flex-1 text-center min-w-0 px-1">
          <p className="font-semibold text-foreground text-sm leading-tight truncate">{title}</p>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{subtitle}</p>
          )}
        </div>

        {/* 右：插槽（固定宽度，右对齐） */}
        <div className="w-16 shrink-0 flex justify-end">
          {right}
        </div>

      </div>

      {/* 进度条（可选，显示在主行下方） */}
      {progress && (
        <div className="max-w-md mx-auto px-4 pb-2">
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>{progress.label ?? '进度'}</span>
            <span>{progress.current.toFixed(0)}/{progress.total.toFixed(0)} ({pct}%)</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted">
            <div
              className="h-1.5 rounded-full transition-all"
              style={{
                width: `${pct}%`,
                background: pct >= 100
                  ? 'hsl(var(--success, 142 71% 45%))'
                  : 'hsl(var(--primary))',
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

/** 刷新按钮快捷帮助器（常用 right 插槽） */
export function PdaRefreshButton({ onRefresh }: { onRefresh: () => void }) {
  return <Button variant="outline" size="sm" onClick={onRefresh}>刷新</Button>
}
