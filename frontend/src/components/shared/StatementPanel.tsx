import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import { useState, forwardRef, useImperativeHandle } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import DataTable from '@/components/shared/DataTable'
import TableActionsMenu, { type TableActionItem } from '@/components/shared/TableActionsMenu'
import { Button } from '@/components/ui/button'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import type { StatusTone } from '@/lib/statusTone'
import { toast } from '@/lib/toast'
import { formatDisplayDate } from '@/lib/dateTime'
import { downloadExport } from '@/lib/exportDownload'
import {
  getStatementsApi, confirmStatementApi, unlockStatementApi,
  type ReconciliationStatement,
} from '@/api/payments'
import { PaymentQueryDialog, PaymentQueryBar, EMPTY_PAYMENT_QUERY, type PaymentQueryValues } from '@/components/shared/PaymentQueryDialog'
import { CreateStatementDialog } from '@/components/shared/payments/CreateStatementDialog'
import { StatementDetailDialog } from '@/components/shared/payments/StatementDetailDialog'
import type { TableColumn } from '@/types'

/** 1草稿 = 还能改 · 2已确认 = 锁定可发对方 · 3已核销 = 收完款 */
const ST_TONE: Record<number, StatusTone> = { 1: 'draft', 2: 'active', 3: 'success' }
const money = (n: number) => `¥${Number(n).toFixed(2)}`

interface Props {
  /** 1=供应商对账（应付）2=客户对账（应收） */
  type: 1 | 2
  /** 隐藏面板自带工具条按钮，交由父级 PageHeader 渲染（与「全部账款」tab 对齐）；筛选标签仍留在面板内 */
  hideToolbar?: boolean
}

/** 父级（PageHeader）驱动面板动作的句柄 */
export interface StatementPanelHandle {
  openQuery: () => void
  openCreate: () => void
  exportExcel: () => void
}

/**
 * 汇总对账：把一段期间的多笔月结账款汇总成一张对账单，确认锁定后发对方核对，
 * 对方汇款后在「收款核销」里冲抵这张单。
 *
 * 已确认的单可以解锁回草稿继续改，但**已核销过的不允许解锁**——服务端也会拦，
 * 否则改完明细后已收的钱对不上任何账款。
 */
export const StatementPanel = forwardRef<StatementPanelHandle, Props>(function StatementPanel(
  { type, hideToolbar = false }, ref,
) {
  const qc = useQueryClient()
  const active = useActiveWorkspaceTab()
  const isPayable = type === 1
  const partyLabel = isPayable ? '供应商' : '客户'

  const [query, setQuery] = useState<PaymentQueryValues>(EMPTY_PAYMENT_QUERY)
  const [queryOpen, setQueryOpen] = useState(false)
  const queryLabels = {
    docLabel: '对账单号',
    partyLabel,
    statusText: (v: string) => ({ '1':'草稿', '2':'已确认', '3':'已核销' }[v] ?? v),
    dateLabel: '创建日期',
    amountLabel: '汇总金额',
  }
  const [createOpen, setCreateOpen] = useState(false)
  const [detailId, setDetailId] = useState<number | null>(null)

  const exportParams = {
    type: String(type),
    ...(query.docNo ? { statementNo: query.docNo } : {}),
    ...(query.partyName ? { partyName: query.partyName } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.startDate ? { startDate: query.startDate } : {}),
    ...(query.endDate ? { endDate: query.endDate } : {}),
    ...(query.minAmount ? { minAmount: query.minAmount } : {}),
    ...(query.maxAmount ? { maxAmount: query.maxAmount } : {}),
  }
  const { data, isLoading } = useQuery({
    queryKey: ['payment-statements', { type, query }],
    queryFn: () => getStatementsApi({ ...exportParams, pageSize: 500 }),
    enabled: active,
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['payment-statements'] })
    qc.invalidateQueries({ queryKey: ['payment-statement-detail'] })
    qc.invalidateQueries({ queryKey: ['reconciliation'] })
  }

  const handleExport = () => downloadExport('/export/statements', exportParams)
    .catch(e => toast.error((e as Error).message))
  // 工具条按钮被父级挪进 PageHeader 后，通过 ref 触发面板内部的查询/新建/导出
  useImperativeHandle(ref, () => ({
    openQuery: () => setQueryOpen(true),
    openCreate: () => setCreateOpen(true),
    exportExcel: handleExport,
  }))

  const confirmMut = useMutation({
    mutationFn: (id: number) => confirmStatementApi(id),
    onSuccess: () => { invalidate(); toast.success('对账单已确认，可导出发对方核对') },
  })
  const unlockMut = useMutation({
    mutationFn: (id: number) => unlockStatementApi(id),
    onSuccess: () => { invalidate(); toast.success('已解锁为草稿，可继续调整明细') },
  })
  const columns: TableColumn<ReconciliationStatement>[] = [
    { key: 'statementNo', title: '对账单号', width: 150, render: v => <span className="text-doc-code">{String(v)}</span> },
    { key: 'partyName', title: partyLabel, width: 160 },
    { key: 'periodStart', title: '对账期间', width: 180, render: (_, row) => {
      const r = row as ReconciliationStatement
      return r.periodStart || r.periodEnd
        ? <span className="text-xs">{r.periodStart ? formatDisplayDate(r.periodStart) : '…'} ~ {r.periodEnd ? formatDisplayDate(r.periodEnd) : '…'}</span>
        : <span className="text-muted-foreground">—</span>
    }},
    { key: 'itemCount', title: '笔数', width: 70, render: v => `${v ?? 0} 笔` },
    { key: 'totalAmount', title: '汇总金额', width: 120, render: v => <span className="tabular-nums font-medium">{money(v as number)}</span> },
    { key: 'settledAmount', title: '已核销', width: 110, render: v => <span className="tabular-nums text-success">{money(v as number)}</span> },
    { key: 'balance', title: '未核销', width: 110, render: v => (
      <span className={`tabular-nums ${Number(v) > 0 ? 'font-semibold text-destructive' : 'text-muted-foreground'}`}>{money(v as number)}</span>
    )},
    { key: 'status', title: '状态', width: 90, render: (v, row) => (
      <SoftStatusLabel label={(row as ReconciliationStatement).statusName} tone={ST_TONE[v as number] ?? 'draft'} />
    )},
    { key: 'id', title: '操作', width: 130, render: (_, row) => {
      const r = row as ReconciliationStatement
      // 与「按单登记」tab 一致：主按钮 + 下拉次操作，随状态变化
      const items: TableActionItem[] = [{ label: '明细', onClick: () => setDetailId(r.id) }]
      if (r.status === 2 && r.settledAmount === 0) {
        items.push({ label: '解锁', onClick: () => unlockMut.mutate(r.id), disabled: unlockMut.isPending })
      }
      // 草稿：主操作=确认；已确认/已核销：主操作=导出对账单发对方
      return r.status === 1 ? (
        <TableActionsMenu primaryLabel="确认" onPrimaryClick={() => confirmMut.mutate(r.id)} primaryDisabled={confirmMut.isPending} items={items} />
      ) : (
        <TableActionsMenu
          primaryLabel="导出对账单"
          primaryVariant="outline"
          onPrimaryClick={() => downloadExport(`/export/statements/${r.id}`, {}).catch(e => toast.error((e as Error).message))}
          items={items}
        />
      )
    }},
  ]

  return (
    <div className="space-y-4">
      {hideToolbar ? (
        <PaymentQueryBar query={query} onChange={setQuery} labels={queryLabels} />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <PaymentQueryBar query={query} onChange={setQuery} labels={queryLabels} />
          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={() => setQueryOpen(true)}>查询</Button>
            <Button variant="outline" onClick={handleExport}>导出汇总</Button>
            <Button onClick={() => setCreateOpen(true)}>新建对账单</Button>
          </div>
        </div>
      )}

      <DataTable columns={columns} data={data?.list || []} loading={isLoading} rowKey="id" />

      <PaymentQueryDialog
        open={queryOpen}
        initial={query}
        onClose={() => setQueryOpen(false)}
        onApply={setQuery}
        labels={queryLabels}
        partyType={type}
        statusOptions={[['1','草稿'],['2','已确认'],['3','已核销']] as const}
      />

      <CreateStatementDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        type={type}
        onCreated={() => { invalidate(); setCreateOpen(false) }}
      />

      {/* 对账单明细 */}
      <StatementDetailDialog
        open={detailId != null}
        onClose={() => setDetailId(null)}
        statementId={detailId}
        type={type}
      />
    </div>
  )
})
