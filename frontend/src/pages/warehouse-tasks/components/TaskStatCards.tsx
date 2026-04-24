import { useQuery } from '@tanstack/react-query'
import { getTaskStatsApi } from '@/api/warehouse-tasks'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'

interface StatItem {
  label: string
  value: number
  accentClass: string
}

export function TaskStatCards() {
  const isActiveTab = useActiveWorkspaceTab()
  const { data } = useQuery({
    queryKey: ['warehouse-tasks-stats'],
    queryFn: () => getTaskStatsApi(),
    enabled: isActiveTab,
    staleTime: 10_000,
    refetchInterval: isActiveTab ? 15_000 : false,
  })

  const counts = data ?? { picking: 0, sorting: 0, checking: 0, packing: 0, shipping: 0, done: 0, urgent: 0 }

  const cards: StatItem[] = [
    { label: '拣货中', value: counts.picking, accentClass: 'text-primary' },
    { label: '待分拣', value: counts.sorting, accentClass: 'text-yellow-600' },
    { label: '待复核', value: counts.checking, accentClass: 'text-purple-600' },
    { label: '待打包', value: counts.packing, accentClass: 'text-orange-600' },
    { label: '待出库', value: counts.shipping, accentClass: 'text-cyan-600' },
    { label: '已出库', value: counts.done, accentClass: 'text-success' },
    { label: '紧急任务', value: counts.urgent, accentClass: 'text-destructive' },
  ]

  return (
    <div className="grid grid-cols-7 gap-3">
      {cards.map(c => (
        <div key={c.label} className="card-base p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{c.label}</p>
          <p className={`mt-1.5 text-2xl font-bold tabular-nums ${c.accentClass}`}>{c.value}</p>
        </div>
      ))}
    </div>
  )
}
