import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { AppDialog } from '@/components/shared/AppDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DatePicker } from '@/components/shared/DatePicker'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { payApi } from '@/api/payments'
import type { PaymentRecord } from '@/api/payments'
import { getActiveAccountsApi } from '@/api/finance'
import { createRequestKey } from '@/lib/requestKey'
import { todayYmd } from '@/lib/dateTime'
import { toast } from '@/lib/toast'
import { confirmAction } from '@/lib/confirm'
import { usePaymentViewInvalidation } from './usePaymentViewInvalidation'

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
  const { data: activeAccounts } = useQuery({
    queryKey: ['finance-accounts', 'active'],
    queryFn: () => getActiveAccountsApi().then(r => r || []),
    enabled: open,
  })
  const payMut = useMutation({
    mutationFn: ({ id, d }: { id: number; d: object }) => payApi(id, d, createRequestKey()),
    onSuccess: () => {
      invalidatePaymentViews()
      onClose()
      setPayAmount(''); setPayRemark(''); setPayAccountId('')
    },
  })

  const handlePay = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!record || !payAmount) return
    if (!payAccountId) { toast.error('请选择资金账户'); return }
    const doPay = () => payMut.mutate({
      id: record.id,
      d: { amount: +payAmount, paymentDate: payDate, method: payMethod, accountId: +payAccountId, remark: payRemark || undefined },
    })
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

  return (
    <AppDialog
      open={open}
      onOpenChange={v => { if (!v) onClose() }}
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
        {record && (
          <div className="mb-4 space-y-1 text-sm text-muted-foreground">
            <p>关联单号：<span className="text-doc-code-strong">{record.orderNo}</span> &nbsp;·&nbsp; {partyLabel}：{record.partyName}</p>
            <p>余额：<span className="font-medium text-destructive">¥{record.balance.toFixed(2)}</span></p>
          </div>
        )}
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
      </form>
    </AppDialog>
  )
}
