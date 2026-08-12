/**
 * PDA 收货任务列表
 * 路由：/pda/inbound
 */
import { Inbox } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getInboundTasksApi } from '@/api/inbound-tasks'
import type { InboundTask } from '@/types/inbound-tasks'
import { Button } from '@/components/ui/button'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import type { StatusTone } from '@/lib/statusTone'
import PdaHeader, { PdaRefreshButton } from '@/components/pda/PdaHeader'
import PdaCard from '@/components/pda/PdaCard'
import { PdaEmptyCard, PdaLoading } from '@/components/pda/PdaEmptyState'
/** 1待收货 2收货中 3待上架 4已完成 5已取消 */
const STATUS_TONE: Record<number, StatusTone> = {
  1:'draft', 2:'active', 3:'active', 4:'success', 5:'danger'
}

function InboundCard({ task, onTap }: { task:InboundTask; onTap:()=>void }) {
  const totalOrdered  = task.orderedQty ?? task.items?.reduce((s,i)=>s+i.orderedQty,0) ?? 0
  const totalReceived = task.receivedQty ?? task.items?.reduce((s,i)=>s+i.receivedQty,0) ?? 0
  const pct = totalOrdered > 0 ? Math.min(100, Math.round(totalReceived/totalOrdered*100)) : 0
  const isReady = task.putawayStatus?.key === 'waiting' || task.putawayStatus?.key === 'putting_away'

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
          <SoftStatusLabel label={task.receiptStatus?.label ?? task.statusName} tone={STATUS_TONE[task.status] ?? 'draft'} />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">应到 {totalOrdered}，已收 {totalReceived}</p>
          <p className="text-xs text-muted-foreground mt-1">打印 {task.printStatus?.label ?? '—'} · 上架 {task.putawayStatus?.label ?? '—'}</p>
        </div>
        {task.status !== 1 && (
          <div>
            <div className="flex justify-between text-xs text-muted-foreground mb-1"><span>收货进度</span><span>{pct}%</span></div>
            <div className="h-1.5 rounded-full bg-muted"><div className="h-1.5 rounded-full transition-all" style={{width:`${pct}%`,background:'hsl(var(--primary))'}} /></div>
          </div>
        )}
        <Button size="pda" className="w-full" variant={isReady ? 'outline' : 'default'} onClick={onTap}>
          {isReady ? '扫码上架' : '开始收货'}
        </Button>
      </div>
    </PdaCard>
  )
}

export default function PdaInboundPage() {
  const navigate = useNavigate()
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['pda-inbound-tasks'],
    // 待收货/收货中/待上架三种状态走服务端过滤，不再拉全量历史订单回来前端筛
    queryFn: () => getInboundTasksApi({ page:1, pageSize:500, status:[1,2,3] }).then(r => r?.list ?? []),
    refetchInterval: 30_000,
  })
  const tasks = (data ?? []).filter((t:InboundTask) => !!t.submittedAt)

  return (
    <div className="min-h-screen bg-background">
      <PdaHeader title="收货订单" onBack={() => navigate('/pda')} right={<PdaRefreshButton onRefresh={() => refetch()} />} />
      <div className="max-w-md mx-auto px-4 py-5 space-y-4">
        <p className="text-xs text-muted-foreground">{tasks.length} 个待处理任务</p>
        {isLoading && <PdaLoading className="h-32" />}
        {!isLoading && tasks.length===0 && (
          <PdaEmptyCard icon={<Inbox className="h-12 w-12 text-muted-foreground" />} title="暂无收货任务" />
        )}
        {tasks.map((t:InboundTask) => (
          <InboundCard key={t.id} task={t}
            onTap={() => navigate((t.putawayStatus?.key === 'waiting' || t.putawayStatus?.key === 'putting_away') ? `/pda/putaway/${t.id}` : `/pda/receive/${t.id}`)} />
        ))}
      </div>
    </div>
  )
}
