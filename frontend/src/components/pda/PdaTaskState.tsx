/**
 * PdaTaskState — PDA 作业页「任务态/无可选任务」提示卡
 *
 * 原在 pack.tsx / check.tsx 内各自复制一份（逐字相同），抽为共享组件。
 * 用于展示「该作业无可执行任务」时的占位态，带回到工作台的入口。
 */
import { Button } from '@/components/ui/button'
import PdaHeader from '@/components/pda/PdaHeader'
import { TriangleAlert } from 'lucide-react'

export function PdaTaskState({
  title,
  description,
  actionText,
  onAction,
  secondaryText,
  onSecondary,
}: {
  title: string
  description: string
  actionText: string
  onAction: () => void
  secondaryText?: string
  onSecondary?: () => void
}) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PdaHeader title={title} onBack={onAction} />
      <div className="flex-1 px-4 py-10">
        <div className="mx-auto max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
          <TriangleAlert className="mx-auto mb-4 h-14 w-14 text-amber-500" />
          <h2 className="text-lg font-bold text-foreground">{title}</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
          <div className="mt-6 flex gap-3">
            {secondaryText && onSecondary ? (
              <Button variant="outline" className="flex-1" onClick={onSecondary}>
                {secondaryText}
              </Button>
            ) : null}
            <Button className="flex-1" onClick={onAction}>
              {actionText}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
