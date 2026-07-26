/**
 * PDA 调拨任务列表
 * 路由：/pda/transfer
 *
 * 两段：待出库（status=2，调出仓扫码出库） / 待入库（status=3，调入仓扫码入库）。
 * 库存变动全部经 PDA 扫码，ERP 端不再直接执行调拨。
 */
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getTransferListApi } from '@/api/transfer'
import type { TransferOrder } from '@/api/transfer'
import { Button } from '@/components/ui/button'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import PdaHeader, { PdaRefreshButton } from '@/components/pda/PdaHeader'
import PdaCard from '@/components/pda/PdaCard'
import { PdaEmptyCard, PdaLoading } from '@/components/pda/PdaEmptyState'

function TransferCard({ order, phase, onTap }: { order: TransferOrder; phase: 'out' | 'in'; onTap: () => void }) {
  const lineCount = order.items?.length ?? 0
  const planned  = order.items?.reduce((s, i) => s + (i.quantity ?? 0), 0) ?? 0
  const deducted = order.items?.reduce((s, i) => s + (i.deductedQty ?? 0), 0) ?? 0
  const received = order.items?.reduce((s, i) => s + (i.receivedQty ?? 0), 0) ?? 0
  return (
    <PdaCard>
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-xs text-muted-foreground">{order.orderNo}</p>
            <p className="font-semibold text-foreground truncate">{order.fromWarehouseName} → {order.toWarehouseName}</p>
            <p className="text-sm text-muted-foreground mt-0.5">{lineCount} 种商品 · 计划 {planned}</p>
          </div>
          <SoftStatusLabel label={phase === 'out' ? '待出库' : '在途'} tone={phase === 'out' ? 'active' : 'warning'} />
        </div>
        {phase === 'out'
          ? <p className="text-xs text-muted-foreground">已出库 {deducted}</p>
          : <p className="text-xs text-muted-foreground">已出库 {deducted} · 已入库 {received}</p>}
        <Button size="pda" className="w-full" variant={phase === 'out' ? 'default' : 'outline'} onClick={onTap}>
          {phase === 'out' ? '📤 调出仓扫码出库' : '📥 调入仓扫码入库'}
        </Button>
      </div>
    </PdaCard>
  )
}

export default function PdaTransferPage() {
  const navigate = useNavigate()
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['pda-transfers'],
    queryFn: () => getTransferListApi({ page: 1, pageSize: 99999 }).then(r => r?.list ?? []),
    refetchInterval: 30_000,
  })
  const list = (data ?? []) as TransferOrder[]
  const outbound = list.filter(o => o.status === 2)
  const inbound  = list.filter(o => o.status === 3)

  return (
    <div className="min-h-screen bg-background">
      <PdaHeader title="调拨执行" onBack={() => navigate('/pda')} right={<PdaRefreshButton onRefresh={() => refetch()} />} />
      <div className="max-w-md mx-auto px-4 py-5 space-y-5">
        {isLoading && <PdaLoading className="h-32" />}

        {!isLoading && (
          <section className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground">待出库（调出仓扫码）· {outbound.length}</p>
            {outbound.length === 0
              ? <PdaEmptyCard icon="📤" title="暂无待出库调拨" />
              : outbound.map(o => <TransferCard key={o.id} order={o} phase="out" onTap={() => navigate(`/pda/transfer-out/${o.id}`)} />)}
          </section>
        )}

        {!isLoading && (
          <section className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground">待入库（调入仓扫码）· {inbound.length}</p>
            {inbound.length === 0
              ? <PdaEmptyCard icon="📥" title="暂无待入库调拨" />
              : inbound.map(o => <TransferCard key={o.id} order={o} phase="in" onTap={() => navigate(`/pda/transfer-in/${o.id}`)} />)}
          </section>
        )}
      </div>
    </div>
  )
}
