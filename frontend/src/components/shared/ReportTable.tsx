import type { TableHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

/** 财务、统计与配置表：保留原有语义表头、合计、编辑器及事件。外层负责横向滚动。 */
export function ReportTable({ className, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn(
    'w-full text-sm tabular-nums [&_th]:whitespace-nowrap [&_th]:font-medium [&_th]:text-muted-foreground [&_th]:leading-5 [&_td]:leading-6 [&_td]:align-middle [&_tbody_tr]:border-b [&_tbody_tr]:border-border/60 [&_tbody_tr:last-child]:border-0 [&_tbody_tr:hover]:bg-muted/20 [&_tfoot]:bg-muted/30 [&_tfoot]:font-semibold',
    className,
  )} {...props} />
}
