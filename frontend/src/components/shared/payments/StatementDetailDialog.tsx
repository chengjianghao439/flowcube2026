import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { money } from '@/lib/format'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import { AppDialog } from '@/components/shared/AppDialog'
import { Button } from '@/components/ui/button'
import { ReportTable } from '@/components/shared/ReportTable'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import type { StatusTone } from '@/lib/statusTone'
import { getStatementDetailApi, removeStatementItemApi } from '@/api/payments'
import { downloadExport } from '@/lib/exportDownload'
import { toast } from '@/lib/toast'
import { formatDisplayDate } from '@/lib/dateTime'

/** 1草稿 = 还能改 · 2已确认 = 锁定可发对方 · 3已核销 = 收完款 */
const ST_TONE: Record<number, StatusTone> = { 1: 'draft', 2: 'active', 3: 'success' }

interface Props {
  open: boolean
  onClose: () => void
  /** 要查看的对账单 ID（关闭期间调用方仍会保留上一次的值，查询由 open 控制） */
  statementId: number | null
  /** 1=供应商对账（应付）2=客户对账（应收） */
  type: 1 | 2
}

/**
 * 对账单明细：汇总金额、下属账款逐笔，以及草稿态下把某笔移出对账单。
 *
 * 明细行数随对账期间变化，故按工作区弹窗承载（2026-09-18 弹窗重构，原先内联在
 * StatementPanel.tsx 里）。移出后失效的 query key 与原实现一致，列表随之刷新。
 */
export function StatementDetailDialog({ open, onClose, statementId, type }: Props) {
  const qc = useQueryClient()
  const active = useActiveWorkspaceTab()
  const isPayable = type === 1

  const { data: detail } = useQuery({
    queryKey: ['payment-statement-detail', statementId],
    queryFn: () => getStatementDetailApi(statementId!),
    enabled: active && open && statementId != null,
  })
  const removeItemMut = useMutation({
    mutationFn: ({ id, recordId }: { id:number; recordId:number }) => removeStatementItemApi(id, recordId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payment-statements'] })
      qc.invalidateQueries({ queryKey: ['payment-statement-detail'] })
      qc.invalidateQueries({ queryKey: ['reconciliation'] })
      toast.success('已移出对账单')
    },
  })

  return (
    <AppDialog
      open={open}
      onOpenChange={v => { if (!v) onClose() }}
      dialogId="payment-statement-detail"
      title={<>对账单 — <span className="text-doc-code-strong">{detail?.statementNo}</span></>}
      defaultWidth={1000}
      defaultHeight={620}
      minWidth={720}
      minHeight={440}
      footer={
        <div className="flex justify-end gap-2">
          {detail && detail.status !== 1 && (
            <Button variant="outline"
              onClick={() => downloadExport(`/export/statements/${detail.id}`, {}).catch(e => toast.error((e as Error).message))}>
              导出对账单（发对方核对）
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>关闭</Button>
        </div>
      }
    >
      <div className="flex h-full flex-col gap-3 p-5">
        {detail && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{detail.partyName}</span>
            <SoftStatusLabel label={detail.statusName} tone={ST_TONE[detail.status] ?? 'draft'} />
            <span>· 汇总 <span className="font-medium text-foreground">{money(detail.totalAmount)}</span></span>
            <span>· 已核销 <span className="text-success">{money(detail.settledAmount)}</span></span>
            {detail.balance > 0 && <span>· 未核销 <span className="font-medium text-destructive">{money(detail.balance)}</span></span>}
            {detail.confirmedByName && <span>· 确认人 {detail.confirmedByName}</span>}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
          <ReportTable className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 text-left">关联单号</th>
                <th className="px-2 py-1.5 text-right">金额</th>
                <th className="px-2 py-1.5 text-right">已{isPayable ? '付' : '收'}</th>
                <th className="px-2 py-1.5 text-right">余额</th>
                <th className="px-2 py-1.5 text-left">到期日</th>
                {detail?.status === 1 && <th className="px-2 py-1.5"></th>}
              </tr>
            </thead>
            <tbody>
              {detail?.items?.map(it => (
                <tr key={it.recordId} className="border-t">
                  <td className="px-2 py-1.5 text-doc-code">{it.orderNo}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{money(it.totalAmount)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-success">{money(it.paidAmount)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {it.balance > 0 ? <span className="text-destructive">{money(it.balance)}</span> : <span className="text-success">已结清</span>}
                  </td>
                  <td className="px-2 py-1.5 text-xs text-muted-foreground">{it.dueDate ? formatDisplayDate(it.dueDate) : '—'}</td>
                  {detail.status === 1 && (
                    <td className="px-2 py-1.5 text-right">
                      <Button size="sm" variant="ghost"
                        onClick={() => removeItemMut.mutate({ id: detail.id, recordId: it.recordId })}>
                        移出
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </ReportTable>
        </div>
      </div>
    </AppDialog>
  )
}
