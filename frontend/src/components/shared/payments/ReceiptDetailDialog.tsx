import { useQuery } from '@tanstack/react-query'
import { money } from '@/lib/format'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import { AppDialog } from '@/components/shared/AppDialog'
import { Button } from '@/components/ui/button'
import { ReportTable } from '@/components/shared/ReportTable'
import { getReceiptDetailApi } from '@/api/payments'
import { usePartyLedger } from '@/hooks/usePartyLedger'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { FinanceOrderLink } from './FinanceOrderLink'


interface Props {
  open: boolean
  onClose: () => void
  /** 要看的汇款单 ID（关闭期间调用方仍会保留上一次的值，查询由 open 控制） */
  receiptId: number | null
  /** 1=付款（应付）2=收款（应收） */
  type: 1 | 2
}

/**
 * 核销明细：这笔款冲抵了哪些订单，以及每张订单核销后的剩余余额。
 *
 * 行数随核销笔数增长，故按工作区弹窗承载，表格区自己滚动（2026-09-18 弹窗重构）。
 */
export function ReceiptDetailDialog({ open, onClose, receiptId, type }: Props) {
  const active = useActiveWorkspaceTab()
  const actionLabel = type === 1 ? '付款' : '收款'

  const ledger = usePartyLedger(type)
  const query = useQuery({
    queryKey: ['payment-receipt-detail', receiptId, type],
    staleTime: 0,
    refetchOnMount: 'always',
    queryFn: () => getReceiptDetailApi(receiptId!),
    enabled: active && open && Number.isSafeInteger(receiptId) && Number(receiptId) > 0,
  })

  const detail = query.data?.id === receiptId && query.data.type === type ? query.data : undefined
  const canNavigate = active && open && !!detail && !query.isFetching && !query.isPaused && !query.isError
  const partyId = detail?.partyId
  const canOpenLedger = canNavigate && ledger.canView && Number.isSafeInteger(partyId) && Number(partyId) > 0

  return (
    <AppDialog
      open={open}
      onOpenChange={v => { if (!v) onClose() }}
      dialogId="payment-receipt-detail"
      title={<>核销明细 — <span className="text-doc-code-strong">{detail?.receiptNo}</span></>}
      defaultWidth={1000}
      defaultHeight={620}
      minWidth={720}
      minHeight={440}
      footer={
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>关闭</Button>
        </div>
      }
    >
      <div className="flex h-full flex-col gap-3 p-5">
        {query.isError && <QueryErrorState error={query.error} onRetry={() => void query.refetch()} compact />}
        {query.isPaused ? <p role="status" className="text-sm text-muted-foreground">网络暂停，明细尚未更新</p> : query.isFetching && <p role="status" className="text-sm text-muted-foreground">正在加载核销明细…</p>}
        {query.data && !detail && <p role="alert">明细身份不匹配，请重试核对原汇款单</p>}
        {detail && (
          <div className="text-sm text-muted-foreground">
            {detail.partyName} {canOpenLedger && <Button size="sm" variant="link" onClick={() => { onClose(); ledger.open({ id: partyId!, name: detail.partyName }) }}>往来明细</Button>} · {actionLabel} {money(detail.amount)} · 已核销 <span className="text-success">{money(detail.settledAmount)}</span>
            <> · 未核销 <span className="font-medium text-warning">{money(detail.balance)}</span></>
            {(!Number.isSafeInteger(partyId) || Number(partyId) < 1) && <p>单位归属待核查，无法定位往来明细</p>}
          </div>
        )}
        <p className="text-xs leading-5 text-muted-foreground">汇款金额、已核销和未核销表示这笔款的分配；订单剩余余额是当前订单账款，单位全部欠款请查看往来明细。</p>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
          <ReportTable className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left">关联单号</th>
                <th className="px-4 py-3 text-right">本次核销</th>
                <th className="px-4 py-3 text-right">订单总额</th>
                <th className="px-4 py-3 text-right">剩余余额</th>
              </tr>
            </thead>
            <tbody>
              {detail?.settlements?.map(s => (
                <tr key={s.entryId} className="border-t">
                  <td className="px-4 py-3"><FinanceOrderLink {...s} enabled={canNavigate && s.type === type} onNavigate={onClose} /></td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(s.amount)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{money(s.orderTotal)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {s.orderBalance > 0
                      ? <span className="text-destructive">{money(s.orderBalance)}</span>
                      : <span className="text-success">已结清</span>}
                  </td>
                </tr>
              ))}
              {detail && !detail.settlements?.length && (
                <tr><td colSpan={4} className="px-2 py-6 text-center text-muted-foreground">这笔款尚未核销任何订单</td></tr>
              )}
            </tbody>
          </ReportTable>
        </div>
      </div>
    </AppDialog>
  )
}
