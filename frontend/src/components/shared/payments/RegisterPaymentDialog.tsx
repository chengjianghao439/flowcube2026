import { money } from '@/lib/format'
import { useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useVisibleQuery } from '@/hooks/useVisibleQuery'
import { AppDialog } from '@/components/shared/AppDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DatePicker } from '@/components/shared/DatePicker'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { payApi } from '@/api/payments'
import type { PaymentRecord } from '@/api/payments'
import { getActiveAccountsApi } from '@/api/finance'
import { todayYmd } from '@/lib/dateTime'
import { toast } from '@/lib/toast'
import { confirmAction } from '@/lib/confirm'
import { usePaymentViewInvalidation } from './usePaymentViewInvalidation'
import { BackfillRequestDialog } from './BackfillRequestDialog'
import { UncertainSubmitNotice } from './UncertainSubmitNotice'
import { useIdempotentSubmit } from './useIdempotentSubmit'
import { isBackfillApplication, useBackfillPrompt } from './backfillFlow'

const FORM_ID = 'payment-register-form'

interface Props {
  open: boolean
  onClose: () => void
  /** 1=付款（应付）2=收款（应收） */
  type: 1 | 2
  /** 本次要登记的账款；弹窗打开期间由调用方保持为选中的那一笔 */
  record: PaymentRecord | null
}

/**
 * 登记付款 / 登记收款——账款页与对账页共用的写操作弹窗。
 *
 * 应付从账户出账、应收进账户，两者字段一致，只有文案与「余额不足二次确认」方向不同，
 * 因此仍是一份实现 + type 分支，只是从 usePaymentActions 的内联弹窗拆成独立组件，
 * 外壳换成可拖拽、带尺寸记忆的 AppDialog 工作区弹窗（2026-09-18 弹窗重构）。
 */
export function RegisterPaymentDialog({ open, onClose, type, record }: Props) {
  const isPayable = type === 1
  const actionLabel = isPayable ? '登记付款' : '登记收款'
  const partyLabel = isPayable ? '供应商' : '客户'
  const invalidatePaymentViews = usePaymentViewInvalidation()

  const [payAmount, setPayAmount] = useState('')
  const [payDate, setPayDate] = useState(todayYmd())
  const [payMethod, setPayMethod] = useState('转账')
  const [payRemark, setPayRemark] = useState('')
  const [payAccountId, setPayAccountId] = useState('')

  // 收/付款账户下拉：仅在弹窗打开时拉取启用账户
  const { data: activeAccounts } = useVisibleQuery({
    queryKey: ['finance-accounts', 'active'],
    queryFn: () => getActiveAccountsApi().then(r => r || []),
    enabled: open,
  })
  const { prompt, ask, close: closePrompt } = useBackfillPrompt()
  // 请求键的轮换时机交给守卫：成功与「明确被拒」才换键，超时/断网与期间已结账一律保留——
  // 早先是「打开就换键」，响应超时后用户关窗重开再提交会重复付款。
  const guard = useIdempotentSubmit({ action: 'payment.record.pay', prefix: 'payment-pay' })

  // 本次提交指向哪一笔账款（切行会换 record）。用来：① 把 recordId 绑进「查询上次结果」的
  // action，使服务端能精确定位本笔（否则同键多条时前缀解析不唯一 ⇒ not_found）；
  // ② 查询完成时判断「提交的那一笔」是否仍是「当前正在看的这一笔」，避免关掉另一笔的弹窗。
  const submittedRecordIdRef = useRef<number | null>(null)
  const submittedOrderNoRef = useRef<string | null>(null)
  const currentRecordIdRef = useRef<number | null>(null)
  currentRecordIdRef.current = record?.id ?? null

  const buildBody = () => ({
    amount: +payAmount, paymentDate: payDate, method: payMethod,
    accountId: +payAccountId, remark: payRemark || undefined,
  })

  const payMut = useMutation({
    mutationFn: ({ id, d, backfillReason, orderNo, amountText, dateText }: {
      id: number; d: object; backfillReason?: string
      /** 提交时快照：切到别的账款后这些不能再用当前表单值 */
      orderNo?: string; amountText?: string; dateText?: string
    }) => {
      // 幂等身份必须绑定**本次实际写入的那一笔**（mutation 参数 id），不是当前 record：
      // 「余额不足确认」与「跨期补录重发」的回调可能持有更早那次提交的 id，两者可能不同。
      // 单号/金额/日期同样取提交时快照，避免切到 B 后把 A 的提交记成 B。
      submittedRecordIdRef.current = id
      submittedOrderNoRef.current = orderNo ?? null
      guard.remember(
        `${actionLabel} ${money(+(amountText ?? '0'))} · ${dateText ?? ''} · ${orderNo ?? ''}`,
        `payment.record.pay.${id}`,
      )
      return payApi(id, backfillReason ? { ...d, backfillRequest: true, backfillReason } : d, guard.keyRef.current, { skipGlobalError: true })
    },
    onSuccess: (res) => {
      guard.settle()
      closePrompt()
      onClose()
      setPayAmount(''); setPayRemark(''); setPayAccountId('')
      // 202 申请单不是「登记成功」：业务一行未写、钱还没动。必须把单号和去哪看进度一起说清楚，
      // 否则一句「已提交」很容易被当成钱已经付了。
      if (isBackfillApplication(res)) {
        toast.success(`已提交补录申请 ${res.applicationNo}，审批通过后才会记账；进度见「财务 › 跨期补录审批」`)
        return
      }
      invalidatePaymentViews()
      toast.success(`${actionLabel}成功`)
    },
    onError: (e) => {
      const kind = guard.classify(e)
      // 期间已结账：不改业务日期（那是事实），改走补录申请；确认后用**同一个请求键**重发
      if (kind === 'period-closed' && record) {
        const rid = record.id
        ask((e as Error).message, (
          <>
            付款 {money(Number(payAmount))} · {payDate} · 账户「{(activeAccounts || []).find(a => String(a.id) === payAccountId)?.name ?? '—'}」
            <br />账款 <span className="text-doc-code">{record.orderNo}</span> · {record.partyName}
          </>
        ), reason => payMut.mutate({
          id: rid, d: buildBody(), backfillReason: reason,
          orderNo: record.orderNo, amountText: payAmount, dateText: payDate,
        }))
        return
      }
      // 未确认：提示条已经说清「可能已成功、先查回执」，再弹一句「登记失败」会把人推向重复提交
      if (kind === 'uncertain') return
      toast.error(e instanceof Error ? e.message : '登记失败')
    },
  })

  const handlePay = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!record || !payAmount) return
    if (!payAccountId) { toast.error('请选择资金账户'); return }
    const doPay = () => payMut.mutate({
      id: record.id, d: buildBody(),
      orderNo: record.orderNo, amountText: payAmount, dateText: payDate,
    })
    // 付款(应付)从账户支出，透支前二次确认——后端仍允许「先记账后到账」，此处只做软性提示
    const acc = (activeAccounts || []).find(a => String(a.id) === payAccountId)
    if (isPayable && acc && +payAmount > acc.currentBalance + 1e-6) {
      confirmAction({
        title: '账户余额不足',
        description: `账户「${acc.name}」当前余额 ${money(acc.currentBalance)}，本次付款 ${money(Number(payAmount))} 将形成负余额。确认继续？`,
        variant: 'destructive',
        confirmText: '仍然付款',
        onConfirm: doPay,
      })
      return
    }
    doPay()
  }

  return (
    <>
    <AppDialog
      open={open}
      onOpenChange={v => { if (!v) { onClose(); closePrompt() } }}
      dialogId="payment-register"
      title={actionLabel}
      defaultWidth={640}
      defaultHeight={560}
      minWidth={520}
      minHeight={420}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>取消</Button>
          <Button type="submit" form={FORM_ID} disabled={payMut.isPending}>确认登记</Button>
        </div>
      }
    >
      <form id={FORM_ID} onSubmit={handlePay} className="h-full overflow-y-auto p-5">
        <UncertainSubmitNotice
          visible={guard.uncertain}
          pending={guard.checkMut.isPending}
          what={guard.lastLabelRef.current ?? undefined}
          onCheck={() => {
            // 点查询这一刻给「在确认哪一笔」拍快照（继续核销那处同范式）：回调里现读 ref 会被后来的提交覆盖
            const queriedRecordId = submittedRecordIdRef.current
            const queriedOrderNo = submittedOrderNoRef.current
            return guard.checkLastResult(() => {
              invalidatePaymentViews()
              // 成功提示必须点出被确认的是哪一笔，否则在另一笔的界面上只报「已成功」会被误读
              toast.success(`上次提交的付款已成功，无需重复登记${queriedOrderNo ? `（账款 ${queriedOrderNo}）` : ''}`)
              // 只有「查询指向的那一笔」正是「现在正在看的这一笔」时才关窗；
              // 用户已切到另一笔时保留当前弹窗（否则会把另一笔的界面一起关掉）。
              if (queriedRecordId === currentRecordIdRef.current) onClose()
            })
          }}
        />
        {record && (
          <div className="mb-4 space-y-1 text-sm text-muted-foreground">
            <p>关联单号：<span className="text-doc-code-strong">{record.orderNo}</span> &nbsp;·&nbsp; {partyLabel}：{record.partyName}</p>
            <p>余额：<span className="font-medium text-destructive">{money(record.balance)}</span></p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1 col-span-2"><Label>资金账户 *</Label>
            <Select value={payAccountId} onValueChange={setPayAccountId}>
              <SelectTrigger className="h-10 w-full"><SelectValue placeholder={`选择${isPayable ? '付款' : '收款'}账户`} /></SelectTrigger>
              <SelectContent>
                {(activeAccounts || []).map(a => (
                  <SelectItem key={a.id} value={String(a.id)}>{a.name}（{money(a.currentBalance)}）</SelectItem>
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
      </form>
    </AppDialog>
    <BackfillRequestDialog
      open={!!prompt}
      onClose={closePrompt}
      message={prompt?.message ?? ''}
      summary={prompt?.summary}
      pending={payMut.isPending}
      onConfirm={reason => prompt?.onConfirm(reason)}
    />
    </>
  )
}
