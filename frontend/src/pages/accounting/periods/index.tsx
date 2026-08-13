/**
 * 会计期间 / 期末结转（增强② · 2026-08-09）
 * 期间列表 + 结转状态；结账/反结账/生成结转凭证。
 * 前端不算会计（结账前置校验、结转金额一律以接口为准）。
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Lock, Unlock, RefreshCcw, CalendarCheck } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { confirmAction as confirm } from '@/lib/confirm'
import { toast } from '@/lib/toast'
import { formatDisplayDateTime } from '@/lib/dateTime'
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
  const { data, isLoading } = useQuery({ queryKey: ['accounting-periods'], queryFn: getPeriodsApi })
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
    onError: (e) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '生成失败'),
  })

  const closeMut = useMutation({
    mutationFn: (period: string) => closePeriodApi(period, { skipGlobalError: true }),
    onSuccess: () => { toast.success('已结账'); setClosing(null); invalidate() },
    onError: (e) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '结账失败'),
  })

  const reopenMut = useMutation({
    mutationFn: (period: string) => reopenPeriodApi(period, { skipGlobalError: true }),
    onSuccess: () => { toast.success('已反结账'); invalidate() },
    onError: (e) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '反结账失败'),
  })

  function onReopen(row: AccountingPeriod) {
    confirm({
      title: '反结账',
      description: `确认反结账 ${fmtPeriod(row.period)}？已结账期间的凭证将恢复可变动，请确保只在确有调整需要时使用。`,
      variant: 'destructive',
      confirmText: '反结账',
      onConfirm: () => reopenMut.mutate(row.period),
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
      key: 'id', title: '操作', width: 240,
      render: (_, r) => (
        <div className="flex gap-2">
          {!r.closed && r.closingStatus !== 'not_required' && (
            <Button size="sm" variant="outline" onClick={() => setGenerating(r)} title={r.closingStatus === 'current' ? '结转凭证已为最新，重新生成仅更新金额' : '生成/更新本期损益结转凭证'}>
              <RefreshCcw className="mr-1 h-3.5 w-3.5" />生成结转
            </Button>
          )}
          {!r.closed ? (
            <Button size="sm" variant="outline" disabled={closeMut.isPending} onClick={() => setClosing(r)} title="结账后该期间凭证不可变动">
              <Lock className="mr-1 h-3.5 w-3.5" />结账
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => onReopen(r)}>
              <Unlock className="mr-1 h-3.5 w-3.5" />反结账
            </Button>
          )}
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader title="会计期间 / 期末结转" description="期间结账后该期间凭证锁定；结账前需先生成损益结转凭证（12 月含年度利润结转）。本系统是正式账，请按月结账。" />

      <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
        <CalendarCheck className="h-4 w-4" />
        结账顺序：生成本期业务凭证 → 生成损益结转凭证（状态为「已最新」）→ 结账。期间已结账后再有凭证变动必须先反结账。
      </div>

      <DataTable columns={columns} data={data ?? []} loading={isLoading} rowKey="period" />

      {/* 生成结转确认 */}
      <Dialog open={!!generating} onOpenChange={v => !v && setGenerating(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>生成结转凭证</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            确认 {generating && fmtPeriod(generating.period)} 的损益结转凭证
            {generating?.closingStatus === 'current' ? '重新生成（结转后又有新发生额时会更新金额）' : '？'} 结转后损益科目清零、差额计入「本年利润」。
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenerating(null)} disabled={genMut.isPending}>取消</Button>
            <Button onClick={() => generating && genMut.mutate(generating.period)} disabled={genMut.isPending}>{genMut.isPending ? '生成中…' : '生成'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 结账确认 */}
      <Dialog open={!!closing} onOpenChange={v => !v && setClosing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>结账</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            确认结账 {closing && fmtPeriod(closing.period)}？结账后该期间凭证锁定，账面视为已确认；如需调整须反结账。
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClosing(null)} disabled={closeMut.isPending}>取消</Button>
            <Button onClick={() => closing && closeMut.mutate(closing.period)} disabled={closeMut.isPending}>{closeMut.isPending ? '结账中…' : '确认结账'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
