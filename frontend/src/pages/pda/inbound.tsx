/**
 * PDA 收货任务列表
 * 路由：/pda/inbound
 */
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getInboundTasksApi } from '@/api/inbound-tasks'
import { INBOUND_STATUS_LABEL } from '@/types/inbound-tasks'
import type { InboundTask } from '@/types/inbound-tasks'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import PdaHeader, { PdaRefreshButton } from '@/components/pda/PdaHeader'
import PdaCard from '@/components/pda/PdaCard'
import { PdaEmptyCard, PdaLoading } from '@/components/pda/PdaEmptyState'

const STATUS_VARIANT: Record<number,'default'|'secondary'|'outline'|'destructive'> = {
  1:'outline', 2:'default', 3:'secondary', 4:'secondary', 5:'destructive'
}

function InboundCard({ task, onTap }: { task:InboundTask; onTap:()=>void }) {
  const totalOrdered  = task.items?.reduce((s,i)=>s+i.orderedQty,0) ?? 0
  const totalReceived = task.items?.reduce((s,i)=>s+i.receivedQty,0) ?? 0
  const pct = totalOrdered > 0 ? Math.min(100, Math.round(totalReceived/totalOrdered*100)) : 0
  const isReady = task.status === 3

  return (
    <PdaCard>
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-xs text-muted-foreground">{task.taskNo}</p>
            <p className="font-semibold text-foreground truncate">{task.supplierName ?? '未知供应商'}</p>
            <p className="text-sm text-muted-foreground mt-0.5">{task.warehouseName} · {task.items?.length ?? 0} 种商品</p>
            <p className="text-xs text-muted-foreground">采购单：{task.purchaseOrderNo ?? '—'}</p>
          </div>
          <Badge variant={STATUS_VARIANT[task.status]}>{INBOUND_STATUS_LABEL[task.status]}</Badge>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">应到 {totalOrdered}，已收 {totalReceived}</p>
        </div>
        {task.status !== 1 && (
          <div>
            <div className="flex justify-between text-xs text-muted-foreground mb-1"><span>收货进度</span><span>{pct}%</span></div>
            <div className="h-1.5 rounded-full bg-muted"><div className="h-1.5 rounded-full transition-all" style={{width:`${pct}%`,background:'hsl(var(--primary))'}} /></div>
          </div>
        )}
        <Button size="lg" className="w-full" variant={isReady ? 'outline' : 'default'} onClick={onTap}>
          {isReady ? '📤 开始上架' : '📥 开始收货'}
        </Button>
      </div>
    </PdaCard>
  )
}

export default function PdaInboundPage() {
  const navigate = useNavigate()
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['pda-inbound-tasks'],
    queryFn: () => getInboundTasksApi({ page:1, pageSize:50, status:undefined }).then(r => r.data.data?.list ?? []),
    refetchInterval: 30_000,
  })
  const tasks = (data ?? []).filter((t:InboundTask) => [1,2,3].includes(t.status))

  return (
    <div className="min-h-screen bg-background">
      <PdaHeader title="收货订单" onBack={() => navigate('/pda')} right={<PdaRefreshButton onRefresh={() => refetch()} />} />
      <div className="max-w-md mx-auto px-4 py-5 space-y-4">
        <p className="text-xs text-muted-foreground">{tasks.length} 个待处理任务</p>
        {isLoading && <PdaLoading className="h-32" />}
        {!isLoading && tasks.length===0 && (
          <PdaEmptyCard icon="📥" title="暂无收货任务" />
        )}
        {tasks.map((t:InboundTask) => (
          <InboundCard key={t.id} task={t}
            onTap={() => navigate(t.status===3 ? `/pda/putaway/${t.id}` : `/pda/receive/${t.id}`)} />
        ))}
      </div>
    </div>
  )
}
