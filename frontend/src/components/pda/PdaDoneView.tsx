/**
 * PdaDoneView — PDA 作业「全部完成」全屏页
 *
 * 统一 task/check/pack/ship 四处重复的「全屏居中 + 大图标 + 标题 + 副文 + 按钮」完成页结构。
 */
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'

interface PdaDoneViewProps {
  /** 大图标（lucide 组件，建议 h-20 w-20） */
  icon: ReactNode
  /** 主标题，如「拣货完成！」 */
  title: string
  /** 副文案，如「任务已进入待分拣」 */
  description?: string
  /** 主按钮文案 */
  actionText: string
  /** 主按钮回调 */
  onAction: () => void
  /** 次要按钮文案（可选） */
  secondaryText?: string
  /** 次要按钮回调 */
  onSecondary?: () => void
}

export default function PdaDoneView({
  icon,
  title,
  description,
  actionText,
  onAction,
  secondaryText,
  onSecondary,
}: PdaDoneViewProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
      <div className="mx-auto mb-6">{icon}</div>
      <h2 className="text-2xl font-semibold text-foreground mb-2">{title}</h2>
      {description && <p className="text-muted-foreground mb-8">{description}</p>}
      <div className="flex w-full max-w-xs flex-col gap-3">
        {secondaryText && onSecondary && (
          <Button size="lg" variant="outline" onClick={onSecondary}>{secondaryText}</Button>
        )}
        <Button size="lg" onClick={onAction}>{actionText}</Button>
      </div>
    </div>
  )
}
