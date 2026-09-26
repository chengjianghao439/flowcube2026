import { useEffect, useMemo, useRef, useState } from 'react'
import { money } from '@/lib/format'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AppDialog } from '@/components/shared/AppDialog'
import { CustomerFinder } from '@/components/finder/CustomerFinder'
import { SupplierFinder } from '@/components/finder/SupplierFinder'
import { usePermission } from '@/hooks/usePermission'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import { PERMISSIONS } from '@/lib/permission-codes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DatePicker } from '@/components/shared/DatePicker'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { getPaymentsApi, getStatementsApi, createReceiptApi, settleReceiptApi,
  type PaymentRecord, type PaymentReceipt, type ReconciliationStatement } from '@/api/payments'
import { getActiveAccountsApi } from '@/api/finance'
import { toast } from '@/lib/toast'
import { confirmAction } from '@/lib/confirm'
import { formatDisplayDate, todayYmd } from '@/lib/dateTime'
import { BackfillRequestDialog } from './BackfillRequestDialog'
import { UncertainSubmitNotice } from './UncertainSubmitNotice'
import { useIdempotentSubmit } from './useIdempotentSubmit'
import { isBackfillApplication, useBackfillPrompt } from './backfillFlow'

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

/**
 * 收款核销：录入一笔汇款，勾选若干待核销账款并分配金额。
 *
 * 「按单登记」和「多单核销」在这里是同一个界面——只勾一单就是按单登记。允许分配合计
 * 小于汇款额（余额留在汇款单上，即预收款），也允许单笔只核销一部分（账款留部分付）。
 *
 * 2026-09-18 弹窗重构：从 components/shared/ReceiptFormDialog.tsx 迁入并换成
 * AppDialog 工作区外壳（可拖拽、尺寸记忆、正文区内滚动），分配区随窗口高度自适应。
 */
export function SettleReceiptDialog({ open, onClose, type, settlementTypes, receipt, target = 'record' }: Props) {
  const active = useActiveWorkspaceTab()
  const bodyRef = useRef<HTMLDivElement>(null)
  const byStatement = target === 'statement'
  const qc = useQueryClient()
  const isContinue = !!receipt
  const partyLabel = isPayableType(type) ? '供应商' : '客户'
  const actionLabel = isPayableType(type) ? '付款' : '收款'

  const { can } = usePermission()
  const [partyId, setPartyId] = useState<number | null>(null)
  const [finderOpen, setFinderOpen] = useState(false)
  const [partyName, setPartyName] = useState('')
  const [amount, setAmount] = useState('')
  const [payDate, setPayDate] = useState(todayYmd())
  const [method, setMethod] = useState('转账')
  const [accountId, setAccountId] = useState('')
  const [remark, setRemark] = useState('')
  /** recordId → 分配金额（字符串，便于处理输入中间态） */
  const [alloc, setAlloc] = useState<Record<number, string>>({})

  // 请求键轮换时机交给守卫（见 useIdempotentSubmit）：成功与明确被拒才换，超时/断网与期间已结账保留
  const guard = useIdempotentSubmit({
    action: isContinue ? 'payment.receipt.settle' : 'payment.receipt.create',
    prefix: 'receipt',
  })

  // 上一次填的是哪一张汇款单（null＝「新建」）。用来区分「重新打开同一笔」与「换了另一笔」：
  // 后者是另一笔业务，表单必须按新的业务对象重建，不能沿用上一张的往来方与金额。
  const lastReceiptIdRef = useRef<number | null | undefined>(undefined)
  // 取成局部常量：稳定引用，且能直接进下面 effect 的依赖数组
  const isUncertain = guard.isUncertain

  useEffect(() => {
    if (!open) return
    const targetId = receipt?.id ?? null
    const sameTarget = lastReceiptIdRef.current === targetId
    lastReceiptIdRef.current = targetId
    // 同一笔业务、且上次提交的结果还没确认时不重置：表单与请求键一并保留，用户可原样重试
    // （后端按同一个请求键认定同一笔）。换掉请求键再录一遍，可能把同一笔收付款登记两次。
    if (sameTarget && isUncertain()) return
    setPartyName(receipt?.partyName ?? '')
    setPartyId(receipt?.partyId ?? null)
    setFinderOpen(false)
    setAmount(receipt ? String(receipt.balance) : '')
    setPayDate(receipt?.paymentDate?.slice(0, 10) ?? todayYmd())
    setMethod(receipt?.method || '转账')
    setAccountId(receipt?.accountId ? String(receipt.accountId) : '')
    setRemark('')
    setAlloc({})
    // isUncertain 是稳定引用（见 useIdempotentSubmit），放进依赖不会让这个 effect 重跑
  }, [open, receipt, isUncertain])

  // 往来方确定后才拉候选；status!==3 由前端过滤（接口的 status 只能传单值）
  const { data, isFetching } = useQuery({
    queryKey: ['payments', 'settleable', { type, partyId, partyName, settlementTypes, target }],
    // 两个分支返回的 list 元素类型不同，显式收敛成联合类型交给下面的 candidates 归一
    queryFn: async (): Promise<{ list: (PaymentRecord | ReconciliationStatement)[] }> => byStatement
      ? getStatementsApi({ type, pageSize: 500, ...(partyId ? { partyId } : { keyword: partyName }) })
      : getPaymentsApi({ type, pageSize: 500, ...(partyId ? { partyId } : { keyword: partyName }), settlementTypes }),
    enabled: active && open && partyName.trim().length > 0,
  })

  // 收付款必须落到具体账户上，否则账户余额永远不准
  const { data: accounts } = useQuery({
    queryKey: ['finance-accounts', 'active'],
    queryFn: () => getActiveAccountsApi(),
    enabled: active && open && !isContinue,
  })

  /** 统一成 {key, label, balance, sub} 结构，下方列表不必区分两种目标 */
  const candidates = useMemo(() => {
    const raw = (data?.list ?? []) as (PaymentRecord | ReconciliationStatement)[]
    if (byStatement) {
      return (raw as ReconciliationStatement[])
        // 只有已确认(2)的对账单能核销；草稿还能改明细，核了会对不上账
        .filter(s => (partyId != null || s.partyName === partyName.trim()) && s.status === 2 && s.balance > 0)
        .map(s => ({ key: s.id, label: s.statementNo, balance: s.balance, total: s.totalAmount,
                     sub: `${s.itemCount ?? 0} 笔明细`, statusName: s.statusName, tone: 'active' as const }))
    }
    return (raw as PaymentRecord[])
      .filter(r => (partyId != null || r.partyName === partyName.trim()) && r.status !== 3)
      // 应付未经财务确认不能出款，先挡在选择阶段，避免提交时才报错
      .filter(r => !(isPayableType(type) && r.confirmStatus === 0))
      .sort((a, b) => String(a.dueDate ?? '').localeCompare(String(b.dueDate ?? '')))
      .map(r => ({ key: r.id, label: r.orderNo, balance: r.balance, total: r.totalAmount,
                   sub: r.dueDate ? `到期 ${formatDisplayDate(r.dueDate)}` : '', statusName: r.statusName,
                   tone: (r.status === 2 ? 'active' : 'draft') as 'active' | 'draft' }))
  }, [data, partyId, partyName, type, byStatement])

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

  const { prompt, ask, close: closePrompt } = useBackfillPrompt()

  const mut = useMutation({
    mutationFn: async ({ backfillReason }: { backfillReason?: string } = {}) => {
      guard.remember(`${actionLabel} ${money(totalAmount)} · ${payDate} · ${partyName.trim()}`)
      const allocations = Object.entries(alloc)
        .map(([id, v]) => ({
          ...(byStatement ? { statementId: Number(id) } : { recordId: Number(id) }),
          amount: Number(v) || 0,
        }))
        .filter(a => a.amount > 0)
      const cfg = { skipGlobalError: true }
      if (isContinue && receipt) return settleReceiptApi(receipt.id, allocations, guard.keyRef.current, backfillReason, cfg)
      return createReceiptApi({
        type, ...(partyId ? { partyId } : {}), partyName: partyName.trim(), amount: totalAmount,
        paymentDate: payDate, method, accountId: Number(accountId),
        remark: remark || undefined, allocations,
      }, guard.keyRef.current, backfillReason, cfg)
    },
    onSuccess: (res) => {
      guard.settle()
      // 202 申请单：业务一行未写、账户没动，只有审批通过后才会记账，所以这些视图都不必失效；
      // 必须把单号与查看进度的地方说清楚，否则「已提交」很容易被当成钱已经收/付了
      if (isBackfillApplication(res)) {
        closePrompt()
        onClose()
        toast.success(`已提交补录申请 ${res.applicationNo}，审批通过后才会记账；进度见「财务 › 跨期补录审批」`)
        return
      }
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
    onError: (e) => {
      const kind = guard.classify(e)
      // 业务日期落在已结账期间：日期是事实不能改，改走补录申请（确认后复用同一个请求键重发）
      if (kind === 'period-closed') {
        ask((e as Error).message, (
          <>
            {actionLabel} {money(totalAmount)} · {payDate}
            {!isContinue && <> · 账户「{(accounts ?? []).find(a => String(a.id) === accountId)?.name ?? '—'}」</>}
            <br />{partyLabel}：{partyName.trim()}{isContinue && receipt ? ` · 汇款单 ${receipt.receiptNo}` : ''}
          </>
        ), reason => mut.mutate({ backfillReason: reason }))
        return
      }
      // 未确认：提示条已说清「可能已成功、先查回执」，不再弹「提交失败」把人推向重复提交
      if (kind === 'uncertain') return
      toast.error(e instanceof Error ? e.message : '提交失败')
    },
  })

  const canSubmit = partyName.trim() && totalAmount > 0 && unallocated >= -1e-6 && !mut.isPending
    && (isContinue || !!accountId)

  return (
    <>
      <AppDialog
        open={open}
        onOpenChange={v => { if (!v) { onClose(); closePrompt() } }}
        dialogId="payment-receipt-settle"
        title={isContinue ? `继续核销 — ${receipt?.receiptNo}` : `登记${actionLabel}并核销`}
        defaultWidth={1120}
        defaultHeight={680}
        minWidth={880}
        minHeight={520}
        // 继续核销的首个可编辑字段是日期；拒绝默认聚焦，避免自动展开日历遮挡明细
        onOpenAutoFocus={event => { if (isContinue) { event.preventDefault(); bodyRef.current?.focus() } }}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button disabled={!canSubmit} onClick={() => {
              // 应付付款(新建收付款单，从账户出账)透支前二次确认；继续核销(isContinue)不动账户、无需确认
              const acc = (accounts || []).find(a => String(a.id) === accountId)
              if (!isContinue && isPayableType(type) && acc && totalAmount > acc.currentBalance + 1e-6) {
                confirmAction({
                  title: '账户余额不足',
                  description: `账户「${acc.name}」当前余额 ${money(acc.currentBalance)}，本次付款 ${money(totalAmount)} 将形成负余额。确认继续？`,
                  variant: 'destructive',
                  confirmText: '仍然付款',
                  onConfirm: () => mut.mutate({}),
                })
                return
              }
              mut.mutate({})
            }}>
              {mut.isPending ? '提交中…' : (allocatedTotal > 0 ? `确认核销 ${money(allocatedTotal)}` : '仅登记不核销')}
            </Button>
          </div>
        }
      >
        <div ref={bodyRef} tabIndex={-1} className="flex h-full flex-col gap-4 overflow-y-auto p-5 focus:outline-none">
          <UncertainSubmitNotice
            visible={guard.uncertain}
            pending={guard.checkMut.isPending}
            what={guard.lastLabelRef.current ?? undefined}
            onCheck={() => guard.checkLastResult(() => {
              qc.invalidateQueries({ queryKey: ['payments'] })
              qc.invalidateQueries({ queryKey: ['payment-receipts'] })
              qc.invalidateQueries({ queryKey: ['finance-accounts'] })
              toast.success(`上次提交的${actionLabel}已成功，无需重复登记`)
              onClose()
            })}
          />
          <div className="grid grid-cols-[minmax(160px,1fr)_minmax(220px,1.4fr)_1fr_1fr] gap-4">
            <div className="space-y-1 col-span-2">
              <Label>{partyLabel} *</Label>
              <div className="flex items-center gap-2">
                <Input
                  value={partyName}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setPartyName(e.target.value); setPartyId(null); setAlloc({}) }}
                  placeholder={`输入${partyLabel}名称`}
                  disabled={isContinue}
                />
                {!isContinue && can(type === 2 ? PERMISSIONS.CUSTOMER_VIEW : PERMISSIONS.SUPPLIER_VIEW) && <Button type="button" size="sm" variant="outline" onClick={() => setFinderOpen(true)}>选择{partyLabel}</Button>}
              </div>
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
            <div className="grid grid-cols-[minmax(160px,1fr)_minmax(220px,1.4fr)_1fr_1fr] gap-4">
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

          {/* 分配区：占满剩余高度，账款列表自己也滚动，行多时不挤掉上方表单 */}
          <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-border">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/40 px-4 py-3">
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

            <div className="min-h-0 flex-1 overflow-y-auto">
              {!partyName.trim() && <p className="px-3 py-6 text-center text-sm text-muted-foreground">请先填写{partyLabel}名称</p>}
              {partyName.trim() && isFetching && <p className="px-3 py-6 text-center text-sm text-muted-foreground">加载中…</p>}
              {partyName.trim() && !isFetching && !candidates.length && (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  该{partyLabel}没有{byStatement ? '已确认待核销的对账单' : '待核销账款'}
                </p>
              )}
              {candidates.map(c => (
                <div key={c.key} className="flex items-center gap-4 border-b px-4 py-3 last:border-b-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
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
                    className="h-10 w-40 text-right tabular-nums"
                    aria-label={`${c.label}本次核销金额`}
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
        </div>
      </AppDialog>

      {type === 2
        ? <CustomerFinder open={finderOpen} onClose={() => setFinderOpen(false)} onConfirm={party => { setPartyId(party.id); setPartyName(party.name); setAlloc({}); setFinderOpen(false) }} />
        : <SupplierFinder open={finderOpen} onClose={() => setFinderOpen(false)} onConfirm={party => { setPartyId(party.id); setPartyName(party.name); setAlloc({}); setFinderOpen(false) }} />}

      <BackfillRequestDialog
        open={!!prompt}
        onClose={closePrompt}
        message={prompt?.message ?? ''}
        summary={prompt?.summary}
        pending={mut.isPending}
        onConfirm={reason => prompt?.onConfirm(reason)}
      />
    </>
  )
}
