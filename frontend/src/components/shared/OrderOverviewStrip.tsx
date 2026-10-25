import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

/** 单据摘要的共同五格；字段与状态的含义仍由各单据原有数据决定。 */
export function OrderOverviewStrip({ label = '订单摘要', cells, children }: {
  label?: string
  cells: readonly { label: string; value: ReactNode; icon: LucideIcon }[]
  children: ReactNode
}) {
  return <section className="fc-order-overview overflow-hidden rounded-xl border border-border bg-card" aria-label={label}>
    <div className="grid divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-[1.25fr_1fr_.75fr_1fr_1fr]">
      {cells.map(({ label: name, value, icon: Icon }) => <div key={name} className="flex min-w-0 items-center gap-2.5 px-4 py-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><Icon className="h-3.5 w-3.5" aria-hidden /></span>
        <div className="min-w-0"><p className="text-[11px] text-muted-foreground">{name}</p><p className="mt-0.5 min-w-0 whitespace-normal [overflow-wrap:anywhere] text-sm font-semibold text-foreground" title={typeof value === 'string' ? value : undefined}>{value}</p></div>
      </div>)}
      <div className="flex min-w-0 items-center justify-between gap-3 px-4 py-2.5">{children}</div>
    </div>
  </section>
}
