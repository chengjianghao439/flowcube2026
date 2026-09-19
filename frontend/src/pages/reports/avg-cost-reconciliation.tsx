import { qty } from '@/lib/format'
import { productIdentityColumns } from '@/components/shared/productIdentityColumns'
import { money } from '@/lib/format'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { Button } from '@/components/ui/button'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { useAvgCostReconciliation, type AvgCostRow } from '@/hooks/useAvgCostReconciliation'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { resyncStockApi } from '@/api/inventory'
import { confirmAction } from '@/lib/confirm'
import { toast } from '@/lib/toast'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { TableColumn } from '@/types'

const fmtQty = (v: unknown) => qty(v as number | null | undefined)

export default function AvgCostReconciliationPage() {
  const { data, isLoading, isError, error, refetch } = useAvgCostReconciliation()
  const queryClient = useQueryClient()
  // 「校正账面」是写操作（重算 inventory_stock 与预占账），后端已改为要求 inventory.adjust；
  // 这里同步按权限隐藏按钮，避免只有报表查看权限的用户点出一个静默 403。
  const { can } = usePermission()
  const canAdjustInventory = can(PERMISSIONS.INVENTORY_ADJUST)

  const resyncMut = useMutation({
    mutationFn: () => resyncStockApi(),
    onSuccess: (r) => {
      if (r?.fixed > 0) {
        toast.success(`已校正 ${r.fixed} 项账面差异`)
      } else {
        toast.warning('账面与实际库存一致，无需校正')
      }
      void refetch()
      void queryClient.invalidateQueries({ queryKey: ['avg-cost-reconciliation'] })
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : '校正失败'),
  })

  function handleResync() {
    confirmAction({
      title: '校正账面差异',
      description: '将按实际库存重算账面数量（仅涉及存在差异的 SKU + 仓库）。实际库存为准，此操作只校正账面数字，不影响实物。',
      confirmText: '确认校正',
      onConfirm: () => resyncMut.mutate(),
    })
  }

  const columns: TableColumn<AvgCostRow>[] = [
    ...productIdentityColumns(),
    { key: 'unitCost', title: '单位成本', width: 90, align: 'right', render: v => <span className="tabular-nums">{money(Number(v))}</span> },
    { key: 'cacheQty', title: '账面数量', width: 100, align: 'right', render: v => <span className="tabular-nums">{fmtQty(v)}</span> },
    { key: 'containerQty', title: '实际库存', width: 100, align: 'right', render: v => <span className="tabular-nums">{fmtQty(v)}</span> },
    { key: 'diffQty', title: '数量差异', width: 100, align: 'right', render: (_, r) => <span className={`tabular-nums ${r.diffQty !== 0 ? 'text-destructive font-semibold' : 'text-muted-foreground'}`}>{r.diffQty}</span> },
    { key: 'diffValue', title: '价值差异', width: 110, align: 'right', render: (_, r) => <span className={`tabular-nums ${r.diffValue !== 0 ? 'text-destructive font-semibold' : 'text-muted-foreground'}`}>{money(r.diffValue)}</span> },
    {
      key: 'drifted',
      title: '状态',
      width: 100,
      render: (_, r) => <SoftStatusLabel label={r.drifted ? '账面差异' : '一致'} tone={r.drifted ? 'danger' : 'success'} />,
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="成本对账"
        description="对比实际库存与账面数量的差异，发现差异后可执行校正。"
        actions={
          <div className="flex items-center gap-2">
            {data && (
              <SoftStatusLabel
                label={data.ok ? `一致 · ${data.totalRows} 行` : `${data.driftedCount} 项差异`}
                tone={data.ok ? 'success' : 'danger'}
              />
            )}
            {canAdjustInventory && (
              <Button variant="outline" disabled={!data || data.driftedCount === 0 || resyncMut.isPending} onClick={handleResync}>
                {resyncMut.isPending ? '校正中…' : '校正账面'}
              </Button>
            )}
            <Button variant="outline" onClick={() => refetch()}>刷新</Button>
          </div>
        }
      />

      {data && data.driftedCount > 0 && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive">
          检测到 {data.driftedCount} 项账面差异，总价值差 {money(data.totalDiffValue)}。
          请点击「刷新」重新比对，或联系管理员执行校正。
        </div>
      )}

      {isError && !data ? (
        <QueryErrorState error={error} onRetry={() => void refetch()} title="对账加载失败" compact />
      ) : (
        <DataTable
          columns={columns}
          data={data?.list ?? []}
          loading={isLoading}
          rowKey="rowKey"
          emptyText="无可对账数据"
        />
      )}
    </div>
  )
}
