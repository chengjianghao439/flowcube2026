import TableActionsMenu from '@/components/shared/TableActionsMenu'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { useCompanyQueryKey } from '@/hooks/useCompanyQueryKey'
/**
 * 会计期间 / 期末结转（增强② · 2026-08-09）
 * 期间列表 + 结转状态；结账/反结账/生成结转凭证。
 * 前端不算会计（结账前置校验、结转金额一律以接口为准）。
 */
import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import ListSummary from '@/components/shared/ListSummary'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { confirmAction as confirm } from '@/lib/confirm'
import { toast } from '@/lib/toast'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { downloadExport } from '@/lib/exportDownload'
import { getPeriodsApi, generateClosingVouchersApi, closePeriodApi, reopenPeriodApi } from '@/api/accounting'
import { CLOSING_STATUS_LABELS } from '@/types/accounting'
import type { AccountingPeriod } from '@/types/accounting'
import type { TableColumn } from '@/types'

const closingTone = (s: AccountingPeriod['closingStatus']) =>
  s === 'current' ? 'success' : s === 'not_required' ? 'info' : s === 'stale' ? 'warning' : 'danger'

function fmtPeriod(p: string): string {
  return `${p.slice(0, 4)} 年 ${p.slice(4, 6)} 月`
}

export default function AccountingPeriodsPage() {
  const qc = useQueryClient()
  const { can } = usePermission()
  const canManage = can(PERMISSIONS.ACCOUNTING_PERIOD_MANAGE)
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: useCompanyQueryKey(['accounting-periods']), queryFn: getPeriodsApi })
  const allowed = useRef(false)
  allowed.current = canManage && !isError && !!data
  const [generating, setGenerating] = useState<AccountingPeriod | null>(null)
  const [closing, setClosing] = useState<AccountingPeriod | null>(null)

  const invalidate = () => qc.invalidateQueries({ queryKey: ['accounting-periods'] })

  const genMut = useMutation({
    mutationFn: (period: string) => generateClosingVouchersApi(period, { skipGlobalError: true }),
    onSuccess: (res) => {
      const detail = res.results.map(r => `${r.kind}${r.created ? ' 已生成' : r.updated ? ' 已更新' : ''}`).join('；') || '本期无损益，无需结转'
      toast.success(`结转完成：${detail}`)
      setGenerating(null)
      invalidate()
    },
    onError: (e) => toast.error(e instanceof Error && e.message ? e.message : '生成失败'),
  })

  const closeMut = useMutation({
    mutationFn: (period: string) => closePeriodApi(period, { skipGlobalError: true }),
    onSuccess: () => { toast.success('已结账'); setClosing(null); invalidate() },
  })

  const reopenMut = useMutation({
    mutationFn: (period: string) => reopenPeriodApi(period, { skipGlobalError: true }),
    onSuccess: () => { toast.success('已反结账'); invalidate() },
    onError: (e) => toast.error(e instanceof Error && e.message ? e.message : '反结账失败'),
  })

  function onReopen(row: AccountingPeriod) {
    confirm({
      title: '反结账',
      description: `确认反结账 ${fmtPeriod(row.period)}？已结账期间的凭证将恢复可变动，请确保只在确有调整需要时使用。`,
      variant: 'destructive',
      confirmText: '反结账',
      onConfirm: () => { if (allowed.current) reopenMut.mutate(row.period) },
    })
  }

  const columns: TableColumn<AccountingPeriod>[] = [
    { key: 'period', title: '会计期间', width: 120, render: v => <span className="font-semibold">{fmtPeriod(v as string)}</span> },
    {
      key: 'closed', title: '状态', width: 100,
      render: (_, r) => r.closed
        ? <SoftStatusLabel label="已结账" tone="success" />
        : <SoftStatusLabel label="未结账" tone="active" />,
    },
    {
      key: 'closingStatus', title: '损益结转', width: 120,
      render: (_, r) => <SoftStatusLabel label={CLOSING_STATUS_LABELS[r.closingStatus] ?? r.closingStatus} tone={closingTone(r.closingStatus)} />,
    },
    {
      key: 'yearClosingStatus', title: '年度结转', width: 120,
      render: (_, r) => r.yearClosingStatus
        ? <SoftStatusLabel label={CLOSING_STATUS_LABELS[r.yearClosingStatus] ?? r.yearClosingStatus} tone={closingTone(r.yearClosingStatus)} />
        : <span className="text-muted-foreground">—</span>,
    },
    { key: 'closedByName', title: '结账人', width: 100, render: v => (v as string) || '—' },
    { key: 'closedAt', title: '结账时间', width: 160, render: v => v ? formatDisplayDateTime(v) : '—' },
    {
      key: 'id', title: '操作', width: 148,
      render: (_, row) => {
        if (!canManage || isError) return null
        if (row.closed) return <TableActionsMenu primaryLabel="反结账" primaryVariant="outline" rowLabel={fmtPeriod(row.period)} onPrimaryClick={() => onReopen(row)} items={[]} />
        const openClosing = () => { closeMut.reset(); setClosing(row) }
        if (row.closingStatus === 'not_required' && (row.yearClosingStatus == null || row.yearClosingStatus === 'not_required')) {
          return <TableActionsMenu primaryLabel="结账" primaryVariant="outline" rowLabel={fmtPeriod(row.period)} primaryDisabled={closeMut.isPending} onPrimaryClick={openClosing} items={[]} />
        }
        return <TableActionsMenu primaryLabel="生成结转" primaryVariant="outline" rowLabel={fmtPeriod(row.period)}
          onPrimaryClick={() => setGenerating(row)}
          items={[{ label: '结账', disabled: closeMut.isPending, afterMenuClose: true, onClick: openClosing }]} />
      },
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="会计期间与结转"
        description="按月生成结转凭证并结账；已结账期间凭证锁定。"
        actions={<Button variant="outline" onClick={() => downloadExport('/export/accounting-periods').catch(e => toast.error((e as Error).message))}>导出 Excel</Button>}
      />


      {isError ? <div role="alert"><QueryErrorState title="会计期间加载失败" error={error} onRetry={() => void refetch()} /></div> :
        <DataTable fluid virtualized scrollLabel="会计期间表格" columnStorageKey="acct-periods" columns={columns} data={data ?? []} loading={isLoading} rowKey="period" />}
      {!isError && data && !isLoading && <ListSummary total={data.length} unit="个" />}

      {/* 生成结转确认 */}
      <Dialog open={!!generating} onOpenChange={v => !v && setGenerating(null)}>
        <DialogContent className="fc-form-dialog sm:max-w-xl">
          <DialogHeader description={<>{<>
            确认 {generating && fmtPeriod(generating.period)} 的期末结转凭证
            {generating?.closingStatus === 'current' ? '重新生成（结转后又有新发生额时会更新金额）' : '？'} 按本期损益或年终结转所需金额生成凭证。
          </>}</>}><DialogTitle>生成结转凭证</DialogTitle></DialogHeader>

          <DialogFooter>
            <Button variant="outline" onClick={() => setGenerating(null)} disabled={genMut.isPending}>取消</Button>
            <Button onClick={() => generating && genMut.mutate(generating.period)} disabled={!canManage || isError || genMut.isPending}>{genMut.isPending ? '生成中…' : '生成'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 结账确认 */}
      <Dialog open={!!closing} onOpenChange={v => !v && !closeMut.isPending && setClosing(null)}>
        <DialogContent className="fc-form-dialog sm:max-w-xl">
          <DialogHeader description={<>{<>
            确认结账 {closing && fmtPeriod(closing.period)}？结账后该期间凭证锁定，账面视为已确认；如需调整须反结账。
          </>}</>}><DialogTitle>结账</DialogTitle></DialogHeader>

          {closeMut.isError && (
            <div className="fc-form-dialog-body">
              <p role="alert" className="text-sm text-destructive-ink">
                {closeMut.error instanceof Error && closeMut.error.message ? closeMut.error.message : '结账失败，请刷新期间状态后重试。'}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setClosing(null)} disabled={closeMut.isPending}>取消</Button>
            <Button onClick={() => closing && closeMut.mutate(closing.period)} disabled={!canManage || isError || closeMut.isPending}>{closeMut.isPending ? '结账中…' : '确认结账'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
