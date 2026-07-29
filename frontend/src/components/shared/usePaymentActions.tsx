import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DatePicker } from '@/components/shared/DatePicker'
import TableActionsMenu from '@/components/shared/TableActionsMenu'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { payApi, getEntriesApi, confirmPaymentApi, getSettlementDetailApi } from '@/api/payments'
import type { PaymentRecord, PaymentEntry } from '@/api/payments'
import { getActiveAccountsApi } from '@/api/finance'
import { createRequestKey } from '@/lib/requestKey'
import { toast } from '@/lib/toast'
import { confirmAction } from '@/lib/confirm'

/**
 * 账款的三个写操作（登记付款/收款、应付结算确认、查看流水）。
 *
 * 账款页按「即时结算」筛、对账页按「月结」筛，两边看的是同一张 payment_records 的
 * 不同子集，但都需要这整套操作——月结客户同样要收付款。因此抽到这里共用，
 * 不在两个页面各写一遍（写两遍必然漂移，而这几个操作是直接改钱的）。
 *
 * 返回的 `dialogs` 需要页面渲染出来，`renderActions` 挂到表格的操作列。
 */
export function usePaymentActions(type: 1 | 2) {
  const qc = useQueryClient()
  const isPayable = type === 1
  const [selected, setSelected] = useState<PaymentRecord | null>(null)
  const [payOpen, setPayOpen] = useState(false)
  const [entriesOpen, setEntriesOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [payAmount, setPayAmount] = useState('')
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10))
  const [payMethod, setPayMethod] = useState('转账')
  const [payRemark, setPayRemark] = useState('')
  const [payAccountId, setPayAccountId] = useState('')

  const actionLabel = isPayable ? '登记付款' : '登记收款'

  // 账款页与对账页读的是两个不同的 query key，改完钱两边都要失效，
  // 否则在对账页登记完付款，切回账款页看到的还是旧余额。
  const invalidateBoth = () => {
    qc.invalidateQueries({ queryKey: ['payments'] })
    qc.invalidateQueries({ queryKey: ['reconciliation'] })
    // 收付款会改变应收/应付余额，账龄与敞口随之变化，看板缓存一并失效
    qc.invalidateQueries({ queryKey: ['finance-dashboard'] })
    // 按单登记现在会写资金账户流水，账户余额随之变化，账户页/下拉一并失效
    qc.invalidateQueries({ queryKey: ['finance-accounts'] })
  }

  const { data: entries } = useQuery({
    queryKey: ['payment-entries', selected?.id],
    queryFn: () => getEntriesApi(selected!.id).then(r => r || []),
    enabled: !!selected && entriesOpen,
  })
  const { data: settlement } = useQuery({
    queryKey: ['payment-settlement', selected?.id],
    queryFn: () => getSettlementDetailApi(selected!.id),
    enabled: !!selected && confirmOpen && isPayable,
  })
  // 收/付款账户下拉：仅在登记弹窗打开时拉取启用账户
  const { data: activeAccounts } = useQuery({
    queryKey: ['finance-accounts', 'active'],
    queryFn: () => getActiveAccountsApi().then(r => r || []),
    enabled: payOpen,
  })
  const payMut = useMutation({
    mutationFn: ({ id, d }: { id: number; d: object }) => payApi(id, d, createRequestKey()),
    onSuccess: () => { invalidateBoth(); setPayOpen(false); setPayAmount(''); setPayRemark(''); setPayAccountId('') },
  })
  const confirmMut = useMutation({
    mutationFn: (id: number) => confirmPaymentApi(id),
    onSuccess: () => { invalidateBoth(); setConfirmOpen(false); toast.success('应付结算已确认，可登记付款') },
  })

  const handlePay = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selected || !payAmount) return
    if (!payAccountId) { toast.error('请选择资金账户'); return }
    const doPay = () => payMut.mutate({ id: selected.id, d: { amount: +payAmount, paymentDate: payDate, method: payMethod, accountId: +payAccountId, remark: payRemark || undefined } })
    // 付款(应付)从账户支出，透支前二次确认——后端仍允许「先记账后到账」，此处只做软性提示
    const acc = (activeAccounts || []).find(a => String(a.id) === payAccountId)
    if (isPayable && acc && +payAmount > acc.currentBalance + 1e-6) {
      confirmAction({
        title: '账户余额不足',
        description: `账户「${acc.name}」当前余额 ¥${acc.currentBalance.toFixed(2)}，本次付款 ¥${(+payAmount).toFixed(2)} 将形成负余额。确认继续？`,
        variant: 'destructive',
        confirmText: '仍然付款',
        onConfirm: doPay,
      })
      return
    }
    doPay()
  }

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
      {/* 登记付款 / 收款 */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{actionLabel}</DialogTitle></DialogHeader>
          {selected && (
            <div className="text-sm text-muted-foreground mb-2 space-y-1">
              <p>关联单号：<span className="text-doc-code-strong">{selected.orderNo}</span> &nbsp;·&nbsp; {isPayable ? '供应商' : '客户'}：{selected.partyName}</p>
              <p>余额：<span className="font-medium text-destructive">¥{selected.balance.toFixed(2)}</span></p>
            </div>
          )}
          <form onSubmit={handlePay} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1 col-span-2"><Label>资金账户 *</Label>
                <Select value={payAccountId} onValueChange={setPayAccountId}>
                  <SelectTrigger className="h-10 w-full"><SelectValue placeholder={`选择${isPayable ? '付款' : '收款'}账户`} /></SelectTrigger>
                  <SelectContent>
                    {(activeAccounts || []).map(a => (
                      <SelectItem key={a.id} value={String(a.id)}>{a.name}（¥{a.currentBalance.toFixed(2)}）</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label>金额 *</Label><Input type="number" min="0.01" step="0.01" value={payAmount} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPayAmount(e.target.value)} required /></div>
              <div className="space-y-1"><Label>日期 *</Label><DatePicker value={payDate} onChange={setPayDate} /></div>
              <div className="space-y-1"><Label>方式</Label>
                <Select value={payMethod} onValueChange={setPayMethod}>
                  <SelectTrigger className="h-10 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="转账">转账</SelectItem>
                    <SelectItem value="现金">现金</SelectItem>
                    <SelectItem value="支票">支票</SelectItem>
                    <SelectItem value="网银">网银</SelectItem>
                    <SelectItem value="其他">其他</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label>备注</Label><Input value={payRemark} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPayRemark(e.target.value)} /></div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPayOpen(false)}>取消</Button>
              <Button type="submit" disabled={payMut.isPending}>确认登记</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 应付结算确认：核对「实际上架量 × 采购单价 − 退货冲减」后确认，确认后才能付款 */}
      {isPayable && (
        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>应付结算确认 — <span className="text-doc-code-strong">{selected?.orderNo}</span></DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">
              该应付由收货上架自动结算生成。请核对以下明细（实际上架量 × 采购单价）后确认；确认后才可登记付款。
              若结算金额后续被重算改变（补收货/退货/撤回收货），会自动打回待确认。
            </p>
            <div className="max-h-80 overflow-y-auto border rounded-md">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr><th className="px-2 py-1.5 text-left">收货单</th><th className="px-2 py-1.5 text-left">商品</th><th className="px-2 py-1.5 text-right">上架量</th><th className="px-2 py-1.5 text-right">采购单价</th><th className="px-2 py-1.5 text-right">金额</th></tr>
                </thead>
                <tbody>
                  {settlement?.lines.map((l, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-2 py-1.5 text-doc-code">{l.taskNo}</td>
                      <td className="px-2 py-1.5">{l.productName}{l.articleNumber ? <span className="text-xs text-muted-foreground"> · {l.articleNumber}</span> : null}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{l.putawayQty}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">¥{l.unitPrice.toFixed(2)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">¥{l.amount.toFixed(2)}</td>
                    </tr>
                  ))}
                  {settlement?.returns.map((r, i) => (
                    <tr key={`ret-${i}`} className="border-t text-destructive">
                      <td className="px-2 py-1.5 text-doc-code">{r.returnNo}</td>
                      <td className="px-2 py-1.5">采购退货冲减</td>
                      <td className="px-2 py-1.5" colSpan={2}></td>
                      <td className="px-2 py-1.5 text-right tabular-nums">¥{r.amount.toFixed(2)}</td>
                    </tr>
                  ))}
                  {!settlement?.lines.length && !settlement?.returns.length && (
                    <tr><td colSpan={5} className="px-2 py-4 text-center text-muted-foreground">加载中…</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-right text-sm">应付合计：<span className="font-bold tabular-nums">¥{selected ? selected.totalAmount.toFixed(2) : '0.00'}</span></p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmOpen(false)}>取消</Button>
              <Button disabled={confirmMut.isPending} onClick={() => { if (selected) confirmMut.mutate(selected.id) }}>
                {confirmMut.isPending ? '确认中…' : '确认结算金额'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* 付款 / 收款流水 */}
      <Dialog open={entriesOpen} onOpenChange={setEntriesOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{isPayable ? '付款流水' : '收款流水'} — <span className="text-doc-code-strong">{selected?.orderNo}</span></DialogTitle></DialogHeader>
          {!entries?.length && <p className="text-sm text-muted-foreground text-center py-6">暂无流水记录</p>}
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
