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
  })
  const [id, setId] = useState<number | null>(null)
  const navigate = useNavigate()
  const addTab = useWorkspaceStore((s) => s.addTab)
  function open(path: string, title: string) {
    setId(null)
    addTab({ key: path, path, title })
    navigate(path)
  }
  return (
    <>
      <p className="mb-2 text-xs text-muted-foreground">
        待归还 → 待审批 → 创建最早 · 优先显示 5 单
      </p>
      {error ? (
        <QueryErrorState error={error} onRetry={() => void refetch()} compact />
      ) : isLoading ? (
        <p className="py-6 text-sm">正在加载待办…</p>
      ) : data?.list.length ? (
        data.list.map((order) => {
          const attention = getSaleAttention(order)
          return (
            <button
              key={order.id}
              onClick={() => setId(order.id)}
              className={`flex w-full items-center gap-3 border-b py-1.5 text-left hover:bg-muted/30 ${id === order.id ? 'bg-primary/5' : ''}`}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-primary">
                  {order.orderNo}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {order.customerName} · 创建于{' '}
                  {formatDisplayDateTime(order.createdAt)}
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
            </button>
          )
        })
      ) : (
        <p className="py-6 text-sm text-muted-foreground">
          暂无待处理销售订单。
        </p>
      )}
      <button
        className="mt-2 text-xs text-primary"
        onClick={() => open('/sale?focus=pending&range=all', '销售待办')}
      >
        查看全部 {data?.pagination.total ?? '—'} 单
      </button>
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
    </>
  )
}
