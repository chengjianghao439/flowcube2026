import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DatePicker } from '@/components/shared/DatePicker'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { getPaymentsApi, getStatementsApi, createReceiptApi, settleReceiptApi,
  type PaymentRecord, type PaymentReceipt, type ReconciliationStatement } from '@/api/payments'
import { getActiveAccountsApi } from '@/api/finance'
import { createRequestKey } from '@/lib/requestKey'
import { toast } from '@/lib/toast'
import { formatDisplayDate } from '@/lib/dateTime'

interface Props {
  open: boolean
  onClose: () => void
  /** 1=付款（应付）2=收款（应收） */
  type: 1 | 2
  /** 限定可核销账款的结算方式，与所在页面一致（现结页只核现结，对账页只核月结） */
  settlementTypes: string
  /** 传入则为「用这张汇款单的剩余余额继续核销」，往来方与金额都已固定 */
  receipt?: PaymentReceipt | null
  /**
   * 核销目标：现结页直接核销账款；月结页核销已确认的对账单
   * （服务端会把对账单金额按明细顺序摊到下属账款上）。
   */
  target?: 'record' | 'statement'
}

const isPayableType = (t: 1 | 2) => t === 1
const money = (n: number) => `¥${Number(n).toFixed(2)}`

/**
 * 收款核销：录入一笔汇款，勾选若干待核销账款并分配金额。
 *
 * 「按单登记」和「多单核销」在这里是同一个界面——只勾一单就是按单登记。允许分配合计
 * 小于汇款额（余额留在汇款单上，即预收款），也允许单笔只核销一部分（账款留部分付）。
 */
export function ReceiptFormDialog({ open, onClose, type, settlementTypes, receipt, target = 'record' }: Props) {
  const byStatement = target === 'statement'
  const qc = useQueryClient()
  const isContinue = !!receipt
  const partyLabel = isPayableType(type) ? '供应商' : '客户'
  const actionLabel = isPayableType(type) ? '付款' : '收款'

  const [partyName, setPartyName] = useState('')
  const [amount, setAmount] = useState('')
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10))
  const [method, setMethod] = useState('转账')
  const [accountId, setAccountId] = useState('')
  const [remark, setRemark] = useState('')
  /** recordId → 分配金额（字符串，便于处理输入中间态） */
  const [alloc, setAlloc] = useState<Record<number, string>>({})

  useEffect(() => {
    if (!open) return
    setPartyName(receipt?.partyName ?? '')
    setAmount(receipt ? String(receipt.balance) : '')
    setPayDate(receipt?.paymentDate?.slice(0, 10) ?? new Date().toISOString().slice(0, 10))
    setMethod(receipt?.method || '转账')
    setAccountId(receipt?.accountId ? String(receipt.accountId) : '')
    setRemark('')
    setAlloc({})
  }, [open, receipt])

  // 往来方确定后才拉候选；status!==3 由前端过滤（接口的 status 只能传单值）
  const { data, isFetching } = useQuery({
    queryKey: ['payments', 'settleable', { type, partyName, settlementTypes, target }],
    // 两个分支返回的 list 元素类型不同，显式收敛成联合类型交给下面的 candidates 归一
    queryFn: async (): Promise<{ list: (PaymentRecord | ReconciliationStatement)[] }> => byStatement
      ? getStatementsApi({ type, pageSize: 99999, keyword: partyName })
      : getPaymentsApi({ type, pageSize: 99999, keyword: partyName, settlementTypes }),
    enabled: open && partyName.trim().length > 0,
  })

  // 收付款必须落到具体账户上，否则账户余额永远不准
  const { data: accounts } = useQuery({
    queryKey: ['finance-accounts', 'active'],
    queryFn: () => getActiveAccountsApi(),
    enabled: open && !isContinue,
  })

  /** 统一成 {key, label, balance, sub} 结构，下方列表不必区分两种目标 */
  const candidates = useMemo(() => {
    const raw = (data?.list ?? []) as (PaymentRecord | ReconciliationStatement)[]
    if (byStatement) {
      return (raw as ReconciliationStatement[])
        // 只有已确认(2)的对账单能核销；草稿还能改明细，核了会对不上账
        .filter(s => s.partyName === partyName.trim() && s.status === 2 && s.balance > 0)
        .map(s => ({ key: s.id, label: s.statementNo, balance: s.balance, total: s.totalAmount,
                     sub: `${s.itemCount ?? 0} 笔明细`, statusName: s.statusName, tone: 'active' as const }))
    }
    return (raw as PaymentRecord[])
      .filter(r => r.partyName === partyName.trim() && r.status !== 3)
      // 应付未经财务确认不能出款，先挡在选择阶段，避免提交时才报错
      .filter(r => !(isPayableType(type) && r.confirmStatus === 0))
      .sort((a, b) => String(a.dueDate ?? '').localeCompare(String(b.dueDate ?? '')))
      .map(r => ({ key: r.id, label: r.orderNo, balance: r.balance, total: r.totalAmount,
                   sub: r.dueDate ? `到期 ${formatDisplayDate(r.dueDate)}` : '', statusName: r.statusName,
                   tone: (r.status === 2 ? 'active' : 'draft') as 'active' | 'draft' }))
  }, [data, partyName, type, byStatement])

  const totalAmount = Number(amount) || 0
  const allocatedTotal = useMemo(
    () => Object.values(alloc).reduce((s, v) => s + (Number(v) || 0), 0),
    [alloc],
  )
  const unallocated = totalAmount - allocatedTotal

  /** 按到期日从早到晚依次填满，最后一笔可能是部分核销 */
  function autoAllocate() {
    let left = totalAmount
    const next: Record<number, string> = {}
    for (const c of candidates) {
      if (left <= 0) break
      const take = Math.min(left, c.balance)
      if (take > 0) { next[c.key] = String(Number(take.toFixed(2))); left -= take }
    }
    setAlloc(next)
    if (left > 0) toast.warning(`账款已全部分配完，仍有 ${money(left)} 未分配，将留作预${actionLabel}`)
  }

  const mut = useMutation({
    mutationFn: async () => {
      const allocations = Object.entries(alloc)
        .map(([id, v]) => ({
          ...(byStatement ? { statementId: Number(id) } : { recordId: Number(id) }),
          amount: Number(v) || 0,
        }))
        .filter(a => a.amount > 0)
      const key = createRequestKey('receipt')
      if (isContinue && receipt) return settleReceiptApi(receipt.id, allocations, key)
      return createReceiptApi({
        type, partyName: partyName.trim(), amount: totalAmount,
        paymentDate: payDate, method, accountId: Number(accountId),
        remark: remark || undefined, allocations,
      }, key)
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['payments'] })
      qc.invalidateQueries({ queryKey: ['reconciliation'] })
      qc.invalidateQueries({ queryKey: ['payment-receipts'] })
      // 核销必经资金账户进出钱（写账户流水并重算余额），账户页/看板是 keepAlive 常驻，
      // 不失效会看到旧余额；账龄敞口也随账款余额变化，一并刷新。
      qc.invalidateQueries({ queryKey: ['finance-accounts'] })
      qc.invalidateQueries({ queryKey: ['finance-dashboard'] })
      const left = Number(res?.balance ?? 0)
      toast.success(left > 0 ? `${actionLabel}登记成功，还有 ${money(left)} 未核销` : `${actionLabel}登记并核销完成`)
      onClose()
    },
  })

  const canSubmit = partyName.trim() && totalAmount > 0 && unallocated >= -1e-6 && !mut.isPending
    && (isContinue || !!accountId)

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {isContinue ? `继续核销 — ${receipt?.receiptNo}` : `登记${actionLabel}并核销`}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-4 gap-3">
          <div className="space-y-1 col-span-2">
            <Label>{partyLabel} *</Label>
            <Input
              value={partyName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setPartyName(e.target.value); setAlloc({}) }}
              placeholder={`输入${partyLabel}名称`}
              disabled={isContinue}
            />
          </div>
          <div className="space-y-1">
            <Label>{isContinue ? '可核销余额' : '汇款金额 *'}</Label>
            <Input
              type="number" min="0.01" step="0.01" value={amount}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAmount(e.target.value)}
              disabled={isContinue}
            />
          </div>
          <div className="space-y-1">
            <Label>日期 *</Label>
            <DatePicker value={payDate} onChange={setPayDate} />
          </div>
        </div>

        {!isContinue && (
          <div className="grid grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label>方式</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger className="h-10 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['转账', '现金', '支票', '网银', '其他'].map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{isPayableType(type) ? '付款账户' : '收款账户'} *</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger className="h-10 w-full"><SelectValue placeholder="请选择账户" /></SelectTrigger>
                <SelectContent>
                  {(accounts ?? []).map(a => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.name}（余额 {money(a.currentBalance)}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 col-span-2">
              <Label>备注</Label>
              <Input value={remark} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRemark(e.target.value)} />
            </div>
          </div>
        )}

        {/* 分配区 */}
        <div className="rounded-lg border border-border">
          <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2">
            <span className="text-sm font-medium">
              {byStatement ? '待核销对账单' : `待核销${isPayableType(type) ? '应付' : '应收'}`}
              {partyName.trim() ? `（${candidates.length} 笔）` : ''}
            </span>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-muted-foreground">已分配 <span className="tabular-nums font-medium text-foreground">{money(allocatedTotal)}</span></span>
              <span className={unallocated < -1e-6 ? 'font-semibold text-destructive' : 'text-muted-foreground'}>
                {unallocated < -1e-6 ? `超出 ${money(-unallocated)}` : `未分配 ${money(unallocated)}`}
              </span>
              <Button size="sm" variant="outline" onClick={autoAllocate} disabled={!candidates.length || totalAmount <= 0}>
                自动分配
              </Button>
            </div>
          </div>

          <div className="max-h-72 overflow-y-auto">
            {!partyName.trim() && <p className="px-3 py-6 text-center text-sm text-muted-foreground">请先填写{partyLabel}名称</p>}
            {partyName.trim() && isFetching && <p className="px-3 py-6 text-center text-sm text-muted-foreground">加载中…</p>}
            {partyName.trim() && !isFetching && !candidates.length && (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                该{partyLabel}没有{byStatement ? '已确认待核销的对账单' : '待核销账款'}
              </p>
            )}
            {candidates.map(c => (
              <div key={c.key} className="flex items-center gap-3 border-b px-3 py-2 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-doc-code">{c.label}</span>
                    <SoftStatusLabel label={c.statusName} tone={c.tone} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {byStatement ? '汇总' : `应${isPayableType(type) ? '付' : '收'}`} {money(c.total)}
                    {' · '}余额 <span className="font-medium text-destructive">{money(c.balance)}</span>
                    {c.sub ? ` · ${c.sub}` : ''}
                  </p>
                </div>
                <Input
                  type="number" min="0" step="0.01" max={c.balance}
                  className="h-8 w-32 text-right"
                  placeholder="0.00"
                  value={alloc[c.key] ?? ''}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAlloc(p => ({ ...p, [c.key]: e.target.value }))}
                />
                <Button size="sm" variant="ghost" className="shrink-0"
                  onClick={() => setAlloc(p => ({ ...p, [c.key]: String(c.balance) }))}>
                  全额
                </Button>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button disabled={!canSubmit} onClick={() => mut.mutate()}>
            {mut.isPending ? '提交中…' : (allocatedTotal > 0 ? `确认核销 ${money(allocatedTotal)}` : '仅登记不核销')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
