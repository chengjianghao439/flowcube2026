import { cn } from '@/lib/utils'

/** 仅用于可进入详情的总览辅助文字；编码及详情正文不使用此组件。 */
export default function PdaOverviewText({ children, className }: { children: string; className?: string }) {
  return <span className={cn('block min-w-0 truncate text-xs text-muted-foreground', className)} title={children}>{children}</span>
}
