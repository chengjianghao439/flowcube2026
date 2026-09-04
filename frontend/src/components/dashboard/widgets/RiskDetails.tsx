import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import Pagination from '@/components/shared/Pagination'
import { Button } from '@/components/ui/button'
import { getLowStockPageApi, getCreditRiskPageApi } from '@/api/dashboard'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { money } from '../chartTheme'

export default function RiskDetails({
  kind,
  onClose,
}: {
  kind: 'stock' | 'credit'
  onClose: () => void
}) {
  const [page, setPage] = useState(1)
  const stock = useQuery({
    queryKey: ['dashboard-low-stock-page', page],
    queryFn: () => getLowStockPageApi(page),
    enabled: kind === 'stock',
  })
  const credit = useQuery({
    queryKey: ['dashboard-credit-risk-page', page],
    queryFn: () => getCreditRiskPageApi(page),
    enabled: kind === 'credit',
  })
  const query = kind === 'stock' ? stock : credit
  const { can } = usePermission()
  const navigate = useNavigate()
  const addTab = useWorkspaceStore((s) => s.addTab)
  function open(path: string, title: string) {
    onClose()
    addTab({ key: path, path, title })
    navigate(path)
  }
  const total = query.data?.pagination.total ?? 0
  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value) onClose()
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {kind === 'stock' ? '低库存明细' : '授信超限客户'}
          </DialogTitle>
          <DialogDescription>
            {kind === 'stock'
              ? '按商品和仓库合计实物库存，筛选数量 ≤ 10；不是可承诺库存判断。'
              : '仅列出当前占用额度超过授信限额的客户；全量结果分页展示。'}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[65vh] overflow-y-auto">
          {query.error ? (
            <QueryErrorState
              error={query.error}
              onRetry={() => void query.refetch()}
            />
          ) : query.isLoading ? (
            <p className="py-8 text-sm">正在加载…</p>
          ) : (
            <>
              <p className="mb-3 text-xs text-muted-foreground">
                共 {total} {kind === 'stock' ? '项' : '家'} · 本页{' '}
                {query.data?.list.length ?? 0} {kind === 'stock' ? '项' : '家'}
              </p>
              {kind === 'stock'
                ? stock.data?.list.map((row) => (
                    <div
                      key={`${row.id}:${row.warehouseId}`}
                      className="flex items-center gap-4 border-b py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{row.name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {row.code} · 型号 {row.spec || '—'} · 颜色{' '}
                          {row.color || '—'}
                        </p>
                        <p className="mt-1 text-xs">{row.warehouseName}</p>
                      </div>
                      <strong className="text-sm tabular-nums">
                        {row.quantity} {row.unit}
                      </strong>
                      {can(PERMISSIONS.INVENTORY_VIEW) && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            open(
                              `/inventory?keyword=${encodeURIComponent(row.code)}&warehouseId=${row.warehouseId}`,
                              '库存管理',
                            )
                          }
                        >
                          查看库存
                        </Button>
                      )}
                    </div>
                  ))
                : credit.data?.list.map((row) => (
                    <div
                      key={row.customerId}
                      className="flex items-center gap-4 border-b py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">
                          {row.customerName}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          额度 {money(row.creditLimit)} · 已用 {money(row.used)}
                        </p>
                      </div>
                      <strong className="text-sm text-destructive">
                        超出 {money(row.used - row.creditLimit)}
                      </strong>
                      {can(PERMISSIONS.SALE_ORDER_VIEW) && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            open(
                              `/sale?customerId=${row.customerId}&customerName=${encodeURIComponent(row.customerName)}&range=all`,
                              '客户销售订单',
                            )
                          }
                        >
                          查看订单
                        </Button>
                      )}
                    </div>
                  ))}
              {total === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  当前没有符合条件的风险项。
                </p>
              )}
              <Pagination
                page={page}
                totalPages={Math.max(1, Math.ceil(total / 10))}
                total={total}
                onPageChange={setPage}
              />
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
