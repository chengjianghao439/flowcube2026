import * as Dialog from '@radix-ui/react-dialog'
import { ArrowUpRight, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useSaleDetail } from '@/hooks/useSale'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { Button } from '@/components/ui/button'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { getSaleWorkflowStatus } from '@/lib/saleWorkflowStatus'
import {
  getSaleAttention,
  summarizeSaleQuantities,
} from '@/lib/salePresentation'
import { getReceivableStatus } from '@/lib/receivableStatus'
import { formatDisplayDateTime } from '@/lib/dateTime'
import type { SaleOrder } from '@/types/sale'

export default function SaleOrderPreview({
  id,
  onClose,
  onDetail,
  onReserve,
  navigation,
}: {
  navigation?: {ids: number[]; onSelect:(id:number)=>void}
  id: number | null
  onClose: () => void
  onDetail: (order: SaleOrder) => void
  onReserve: (id: number) => void
}) {
  const { data: order, isLoading, error, refetch } = useSaleDetail(id ?? 0)
  const { can } = usePermission()
  const workflow = order ? getSaleWorkflowStatus(order) : null
  const attention = order ? getSaleAttention(order) : null
  const quantities = order
    ? (order.quantitySummary ?? summarizeSaleQuantities(order.items ?? []))
    : []
  const position = navigation?.ids.indexOf(id ?? 0) ?? -1
  return (
    <Dialog.Root
      open={id != null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      modal={false}
    >
      <Dialog.Portal>
        <Dialog.Content className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-border bg-card shadow-2xl outline-none sm:w-[560px] motion-reduce:animate-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right-4 data-[state=open]:duration-200">
          <div className="border-b border-border px-6 py-5 pr-14">
            <Dialog.Description className="text-xs text-muted-foreground">
              订单快速预览 · 保留列表位置
            </Dialog.Description>
            <Dialog.Title className="mt-2 text-xl font-semibold">
              {order?.orderNo ?? '销售订单'}
            </Dialog.Title>
            {workflow && (
              <div className="mt-2">
                <SoftStatusLabel label={workflow.label} tone={workflow.tone} />
              </div>
            )}
            <Dialog.Close
              className="absolute right-5 top-5 rounded p-1 text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
              aria-label="关闭订单预览"
            >
              <X className="h-5 w-5" />
            </Dialog.Close>
          </div>
          {navigation && <nav aria-label="连续浏览订单" className="flex items-center justify-between border-b px-6 py-2">
            <Button size="sm" variant="ghost" disabled={position <= 0} onClick={()=>navigation.onSelect(navigation.ids[position-1])}><ChevronLeft className="h-4 w-4"/>上一单</Button>
            <span className="text-xs text-muted-foreground" aria-live="polite">当前页 {position < 0 ? '—' : position + 1} / {navigation.ids.length}</span>
            <Button size="sm" variant="ghost" disabled={position < 0 || position >= navigation.ids.length-1} onClick={()=>navigation.onSelect(navigation.ids[position+1])}>下一单<ChevronRight className="h-4 w-4"/></Button>
          </nav>}
          <div key={id} className="min-h-0 flex-1 overflow-y-auto">
            {isLoading && (
              <div className="space-y-4 p-6" aria-label="加载订单">
                <div className="h-24 animate-pulse rounded bg-muted" />
                <div className="h-48 animate-pulse rounded bg-muted" />
              </div>
            )}
            {error && (
              <QueryErrorState
                error={error}
                onRetry={() => void refetch()}
                compact
              />
            )}
            {order && !error && (
              <>
                <section className="border-b border-border p-6">
                  <dl className="grid grid-cols-2 gap-5 text-sm">
                    <div>
                      <dt className="mb-1 text-xs text-muted-foreground">
                        客户
                      </dt>
                      <dd>{order.customerName}</dd>
                    </div>
                    <div>
                      <dt className="mb-1 text-xs text-muted-foreground">
                        折后金额
                      </dt>
                      <dd className="font-semibold tabular-nums">
                        ¥
                        {Math.max(
                          0,
                          order.totalAmount - (order.discountAmount ?? 0),
                        ).toFixed(2)}
                      </dd>
                    </div>
                    <div>
                      <dt className="mb-1 text-xs text-muted-foreground">
                        发货仓库
                      </dt>
                      <dd>
                        {order.warehouseName}
                        {order.isMultiWarehouse ? ' · 多仓发货' : ''}
                      </dd>
                    </div>
                    <div>
                      <dt className="mb-1 text-xs text-muted-foreground">
                        回款状态
                      </dt>
                      <dd>{getReceivableStatus(order).label}</dd>
                    </div>
                  </dl>
                  {attention?.label && (
                    <div className="mt-5 rounded-md bg-muted/50 p-3">
                      <SoftStatusLabel
                        label={attention.label}
                        tone={attention.tone}
                      />
                    </div>
                  )}
                  {order.remark && (
                    <p className="mt-3 whitespace-pre-wrap break-words text-xs text-muted-foreground">
                      备注：{order.remark}
                    </p>
                  )}
                </section>
                <section className="border-b border-border p-6">
                  <h3 className="mb-4 text-sm font-semibold">履约数量</h3>
                  {quantities.map((q) => (
                    <div key={q.unit} className="mb-3">
                      <p className="mb-2 text-xs text-muted-foreground">
                        基本单位：{q.unit}
                      </p>
                      <div className="grid grid-cols-4 gap-2">
                        {[
                          ['订单', q.ordered],
                          ['已占库', q.reserved],
                          ['已派发', q.dispatched],
                          ['已出库', q.shipped],
                        ].map(([label, value]) => (
                          <div key={label}>
                            <p className="text-xs text-muted-foreground">
                              {label}
                            </p>
                            <p className="mt-1 text-xl font-semibold tabular-nums">
                              {value}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  <p className="mt-3 text-xs text-muted-foreground">
                    已派发表示已创建仓库任务，不代表实物已出库。
                  </p>
                </section>
                <section className="border-b border-border p-6">
                  <h3 className="text-sm font-semibold">
                    商品明细{' '}
                    <span className="font-normal text-muted-foreground">
                      ({order.items?.length ?? 0})
                    </span>
                  </h3>
                  {order.items?.map((item) => (
                    <div
                      key={item.id}
                      className="border-b border-border py-4 last:border-0 last:pb-0"
                    >
                      <p className="text-sm font-medium">{item.productName}</p>
                      <div className="mt-2 grid grid-cols-2 gap-1.5 text-xs text-muted-foreground">
                        <span>编码 {item.productCode}</span>
                        <span>供应商型号 {item.articleNumber || '—'}</span>
                        <span>型号 {item.spec || '—'}</span>
                        <span>颜色 {item.color || '—'}</span>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {item.warehouseName || order.warehouseName}
                      </p>
                      <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs tabular-nums">
                        <span>
                          订购 {item.quantity} {item.unit}
                        </span>
                        <span>
                          已占 {item.reservedQty ?? 0} · 已派发{' '}
                          {item.dispatchedQty ?? 0} · 已出库{' '}
                          {item.shippedQty ?? 0}
                        </span>
                      </div>
                    </div>
                  ))}
                </section>
                <section className="p-6">
                  <h3 className="mb-3 text-sm font-semibold">仓库任务</h3>
                  {!order.tasks?.length ? (
                    <p className="text-xs text-muted-foreground">
                      尚未创建出库任务。占库不会自动创建仓库任务。
                    </p>
                  ) : (
                    order.tasks.map((task) => (
                      <div
                        key={task.taskId}
                        className="flex justify-between gap-3 border-b border-border py-3 text-xs"
                      >
                        <div>
                          <p className="font-medium">{task.taskNo}</p>
                          <p className="mt-1 text-muted-foreground">
                            {task.warehouseName}
                          </p>
                        </div>
                        <span>
                          {task.adjustmentRequestedAt
                            ? '改单待确认'
                            : task.cancelRequestedAt
                              ? '取消待归还'
                              : task.statusName}
                        </span>
                      </div>
                    ))
                  )}
                  <p className="mt-4 text-xs text-muted-foreground">
                    创建于 {formatDisplayDateTime(order.createdAt)} ·{' '}
                    {order.operatorName}
                  </p>
                </section>
              </>
            )}
          </div>
          {order && !error && (
            <div className="flex justify-end gap-2 border-t border-border bg-muted/10 p-4">
              <Button
                variant="outline"
                onClick={() => {
                  onClose()
                  onDetail(order)
                }}
              >
                完整详情
                <ArrowUpRight className="h-4 w-4" />
              </Button>
              {[1, 6].includes(order.status) &&
                can(PERMISSIONS.SALE_ORDER_RESERVE) && (
                  <Button
                    onClick={() => {
                      onClose()
                      onReserve(order.id)
                    }}
                  >
                    {order.status === 6 ? '继续占库' : '占用库存'}
                  </Button>
                )}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
