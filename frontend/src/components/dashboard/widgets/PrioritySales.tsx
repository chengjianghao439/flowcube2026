import { lazy, Suspense, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSaleList } from '@/hooks/useSale'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { getSaleAttention } from '@/lib/salePresentation'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { ArrowUpRight, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
const Preview = lazy(() => import('@/pages/sale/components/SaleOrderPreview'))

export default function PrioritySales() {
  const { can } = usePermission()
  return can(PERMISSIONS.SALE_ORDER_VIEW) ? (
    <Queue />
  ) : (
    <p className="py-6 text-sm text-muted-foreground">
      暂无销售查看权限，可切换状态总览查看其他业务。
    </p>
  )
}
function Queue() {
  const { data, error, isLoading, refetch } = useSaleList({
    page: 1,
    pageSize: 5,
    focus: 'pending',
  }, true)
  const [id, setId] = useState<number | null>(null)
  const navigate = useNavigate()
  const addTab = useWorkspaceStore((s) => s.addTab)
  function open(path: string, title: string) {
    setId(null)
    addTab({ key: path, path, title })
    navigate(path)
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <p className="mb-2 shrink-0 text-xs leading-5 text-muted-foreground">
        待归还、待审批优先，其余按创建时间 · 最多 5 单
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <QueryErrorState error={error} onRetry={() => void refetch()} compact />
        ) : isLoading ? (
          <div role="status" aria-label="正在加载待办" className="space-y-3 py-2">
            {Array.from({ length: 5 }, (_, i) => <div key={i} className="h-10 rounded bg-muted/60 motion-safe:animate-pulse" />)}
          </div>
        ) : data?.list.length ? (
          data.list.map((order) => {
            const attention = getSaleAttention(order)
            return (
              <button
                key={order.id}
                onClick={() => setId(order.id)}
                className={`dashboard-row-action dashboard-priority-row flex w-full items-center gap-3 border-b border-border px-2 py-1.5 text-left ${id === order.id ? 'bg-primary/5' : ''}`}
              >
                <span className="dashboard-priority-identity min-w-0 flex-1">
                  <span className="block break-words text-sm font-medium leading-4 tabular-nums text-primary">
                    {order.orderNo}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground" title={order.customerName}>
                    {order.customerName}
                  </span>
                </span>
                {attention.label ? (
                  <SoftStatusLabel
                    label={attention.label}
                    tone={attention.tone}
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">待跟进</span>
                )}
                <span className="dashboard-priority-date shrink-0 text-right text-xs leading-4 text-muted-foreground">
                  <span className="block">创建于</span>
                  <span className="block tabular-nums">{formatDisplayDateTime(order.createdAt)}</span>
                </span>
              </button>
            )
          })
        ) : (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <CheckCircle2 className="h-6 w-6 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium">暂无待处理销售订单</p>
            <p className="text-xs text-muted-foreground">新的销售待办会显示在这里。</p>
          </div>
        )}
      </div>
      <Button
        variant="ghost" size="sm" className="mt-1 h-8 w-full shrink-0 justify-between px-2 text-xs text-primary"
        onClick={() => open('/sale?focus=pending&range=all', '销售待办')}
      >
        查看全部 {data?.pagination.total ?? '—'} 单
        <ArrowUpRight aria-hidden />
      </Button>
      {id != null && (
        <Suspense fallback={null}>
          <Preview
            id={id}
            navigation={{
              ids: (data?.list ?? []).map((o) => o.id),
              onSelect: setId,
            }}
            onClose={() => setId(null)}
            onReserve={(orderId) => open(`/sale/${orderId}`, '销售单详情')}
            onDetail={(order) => open(`/sale/${order.id}`, order.orderNo)}
          />
        </Suspense>
      )}
    </div>
  )
}
