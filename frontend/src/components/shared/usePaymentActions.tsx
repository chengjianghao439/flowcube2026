import { useState } from 'react'
import { EmptyState } from './EmptyState'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import TableActionsMenu from '@/components/shared/TableActionsMenu'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { getEntriesApi } from '@/api/payments'
import type { PaymentRecord, PaymentEntry } from '@/api/payments'
import { RegisterPaymentDialog } from '@/components/shared/payments/RegisterPaymentDialog'
import { SettlementConfirmDialog } from '@/components/shared/payments/SettlementConfirmDialog'

/**
 * 账款的三个写操作（登记付款/收款、应付结算确认、查看流水）。
 *
 * 账款页按「即时结算」筛、对账页按「月结」筛，两边看的是同一张 payment_records 的
 * 不同子集，但都需要这整套操作——月结客户同样要收付款。因此抽到这里共用，
 * 不在两个页面各写一遍（写两遍必然漂移，而这几个操作是直接改钱的）。
 *
 * 返回的 `dialogs` 需要页面渲染出来，`renderActions` 挂到表格的操作列。
 *
 * 2026-09-18 弹窗重构：登记收付款与应付结算确认拆成
 * `components/shared/payments/` 下的独立专用弹窗（AppDialog 工作区外壳），
 * 本 hook 只保留选中行、打开状态、操作列与只读的流水小弹窗。
 */
export function usePaymentActions(type: 1 | 2) {
  const isPayable = type === 1
  const [selected, setSelected] = useState<PaymentRecord | null>(null)
  const [payOpen, setPayOpen] = useState(false)
  const [entriesOpen, setEntriesOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const actionLabel = isPayable ? '登记付款' : '登记收款'

  const { data: entries } = useQuery({
    queryKey: ['payment-entries', selected?.id],
    queryFn: () => getEntriesApi(selected!.id).then(r => r || []),
    enabled: !!selected && entriesOpen,
  })

  function renderActions(r: PaymentRecord) {
    const needsConfirm = isPayable && r.confirmStatus === 0
    if (r.status === 3) {
      return <Button size="sm" variant="outline" onClick={() => { setSelected(r); setEntriesOpen(true) }}>流水</Button>
    }
    if (needsConfirm) {
      return (
        <TableActionsMenu
          primaryLabel="确认结算"
          onPrimaryClick={() => { setSelected(r); setConfirmOpen(true) }}
          items={[{ label: '流水', onClick: () => { setSelected(r); setEntriesOpen(true) } }]}
        />
      )
    }
    return (
      <TableActionsMenu
        primaryLabel={actionLabel}
        primaryVariant="outline"
        onPrimaryClick={() => { setSelected(r); setPayOpen(true) }}
        items={[{ label: '流水', onClick: () => { setSelected(r); setEntriesOpen(true) } }]}
      />
    )
  }

  const dialogs = (
    <>
      {/* 登记付款 / 收款：专用工作区弹窗 */}
      <RegisterPaymentDialog
        open={payOpen}
        onClose={() => setPayOpen(false)}
        type={type}
        record={selected}
      />

      {/* 应付结算确认：核对「实际上架量 × 采购单价 − 退货冲减」后确认，确认后才能付款 */}
      {isPayable && (
        <SettlementConfirmDialog
          open={confirmOpen}
          onClose={() => setConfirmOpen(false)}
          record={selected}
        />
      )}

      {/* 付款 / 收款流水 */}
      <Dialog open={entriesOpen} onOpenChange={setEntriesOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{isPayable ? '付款流水' : '收款流水'} — <span className="text-doc-code-strong">{selected?.orderNo}</span></DialogTitle></DialogHeader>
          {!entries?.length && <EmptyState variant="no-data" title="暂无流水记录" compact />}
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {entries?.map((e: PaymentEntry) => (
              <div key={e.id} className="flex justify-between items-center border-b pb-2 text-sm">
                <div><p className="font-medium">¥{e.amount.toFixed(2)}</p><p className="text-xs text-muted-foreground">{e.paymentDate} · {e.method} · {e.operatorName}</p></div>
                {e.remark && <p className="text-xs text-muted-foreground max-w-32 text-left">{e.remark}</p>}
              </div>
            ))}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setEntriesOpen(false)}>关闭</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )

  return { renderActions, dialogs }
}
