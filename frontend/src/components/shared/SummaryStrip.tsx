import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** 列表上方的同口径汇总；金额来源仍由页面查询提供。 */
export function SummaryStrip({ items }: { items: { label: string; value: ReactNode; tone?: string }[] }) {
  return <dl className="flex flex-wrap divide-x divide-border rounded-lg border border-border bg-card">
    {items.map(item => <div key={item.label} className="min-w-[180px] flex-1 px-5 py-3">
      <dt className="text-xs leading-5 text-muted-foreground">{item.label}</dt>
      <dd className={cn('mt-1 break-words text-xl font-semibold tabular-nums', item.tone)}>{item.value}</dd>
    </div>)}
  </dl>
}
