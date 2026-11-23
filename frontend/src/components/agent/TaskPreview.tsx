import { useEffect, useState } from 'react'
import { Check, Clock3 } from 'lucide-react'
import { formatDisplayDate, formatDisplayDateTime } from '@/lib/dateTime'
import { Button } from '@/components/ui/button'
import { FinanceOrderLink } from '@/components/shared/payments/FinanceOrderLink'
import { ReceiptDetailDialog } from '@/components/shared/payments/ReceiptDetailDialog'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { money as formatMoney, qty as formatQty } from '@/lib/format'
import { GRAPH_LABELS, TASK_STATE_LABELS, type AssistantLine, type AssistantTask } from './types'

const money = (cents: number | undefined) => formatMoney(cents == null ? undefined : cents / 100)
const isSourceId = (id: number | undefined): id is number => id != null && Number.isSafeInteger(id) && id > 0
const unitLabel = (unit?: string) => unit ? ` ${unit}` : ''

function balanceChange(before: number | undefined, amount: number | undefined) {
  return before != null && amount != null && Number.isSafeInteger(before) && Number.isSafeInteger(amount)
    && amount > 0 && before >= amount ? `${money(before)} → ${money(before - amount)}` : undefined
}

function ProductLines({ lines, showReserveChange = false }: { lines: AssistantLine[], showReserveChange?: boolean }) {
  return <div className="xiaoman-lines">{lines.map((line, i) => {
    const before = showReserveChange && line.reservedQty != null && Number.isFinite(line.reservedQty) && line.reservedQty >= 0
      && Number.isFinite(line.qty) && line.qty > 0 ? line.reservedQty : undefined
    const unit = unitLabel(line.unit)
    return <div className="xiaoman-product" key={`${line.productId}-${i}`}>
      <div>
        <strong>{line.productName}</strong>
        {line.warehouseName && <span className="xiaoman-line-detail">{line.warehouseName}</span>}
        {line.unitPrice != null || line.unitPriceCents != null ? <span className="xiaoman-line-detail">单价 {line.unitPrice != null ? `¥${line.unitPrice}` : money(line.unitPriceCents ?? undefined)}{line.priceSource?.level ? ` · ${line.priceSource.level}` : ''}</span> : null}
        {before != null && <span className="xiaoman-line-detail">预计累计已占 <span className="xiaoman-change">{formatQty(before)} → {formatQty(before + line.qty)}{unit}</span></span>}
      </div>
      <span className="xiaoman-quantity">{before != null ? '本次占库 ' : '×'}{formatQty(line.qty)}{unit}</span>
    </div>
  })}</div>
}
export default function TaskPreview({ task, busy, recovering, onConfirm, onAccount, onReview, onReselect, onCancel }: {
  task: AssistantTask; busy: boolean; recovering: boolean; onConfirm: () => void; onAccount: (index: number) => void
  onReview?: () => void
  onReselect?: () => void; onCancel?: () => void
}) {
  const preview = task.preview
  const expiresAt = preview?.expiresAt ? Date.parse(preview.expiresAt) : NaN
  const [now, setNow] = useState(Date.now)
  const [viewReceipt, setViewReceipt] = useState(false)
  const { can } = usePermission()
  useEffect(() => {
    const remaining = expiresAt - Date.now()
    if (remaining > 0 && remaining < 2147483647) {
      const timer = window.setTimeout(() => setNow(Date.now()), remaining + 20)
      return () => window.clearTimeout(timer)
    }
  }, [expiresAt])
  if (!preview) return null
  const expired = task.state === 'EXPIRED' || (task.state === 'AWAITING_CONFIRM' && Number.isFinite(expiresAt) && Math.max(now, Date.now()) >= expiresAt)
  const awaiting = task.state === 'AWAITING_CONFIRM' && !expired && !task.reviewRequired
  const receipt = task.graph === 'D-receipt'
  const settle = task.graph === 'D-settle'
  const backfill = task.graph === 'R-backfill-action'
  const refund = task.graph === 'P-refund-execute' || backfill
  const reserve = task.graph === 'B2-reserve'
  const canReviewExpired = reserve || settle || (refund && !backfill) || task.graph === 'B-sale-draft'
  const needsAccount = receipt && !preview.account
  const status = recovering ? '待核对' : expired ? '已失效' : task.reviewRequired ? '待复核' : needsAccount && awaiting ? '待选账户' : TASK_STATE_LABELS[task.state] || '待核对'
  const lines = preview.lines || []
  const showsLineWarehouses = reserve && lines.some(line => line.warehouseName)
  const showChanges = awaiting && !recovering
  const receiptChange = settle && showChanges ? balanceChange(preview.receiptBalanceBeforeCents, preview.totalCents) : undefined
  const statementChange = settle && showChanges ? balanceChange(preview.statementBalanceBeforeCents, preview.totalCents) : undefined
  const receiptId = settle && isSourceId(preview.receiptId) && can(PERMISSIONS.PAYMENT_VIEW) ? preview.receiptId : undefined
  return <section className="xiaoman-preview" aria-label="当前业务预览">
    <div className="xiaoman-preview-heading"><h2>{GRAPH_LABELS[task.graph] || preview.title || '业务预览'}</h2><span className={`xiaoman-state ${task.state === 'DONE' ? 'is-done' : ''}`}>{task.state === 'DONE' && <Check size={12} aria-hidden="true" />}{status}</span></div>
    <div className="xiaoman-preview-body">
      <dl className="xiaoman-facts">
        {preview.customer && <><dt>客户</dt><dd>{preview.customer.name}</dd></>}
        {preview.warehouseName && !showsLineWarehouses && <><dt>仓库</dt><dd>{preview.warehouseName}</dd></>}
        {reserve && preview.orderNo && <><dt>原销售单</dt><dd>{isSourceId(preview.orderId)
          ? <FinanceOrderLink type={2} orderId={preview.orderId} orderNo={preview.orderNo} /> : preview.orderNo}</dd></>}
        {settle && preview.receiptNo && <><dt>原收款单</dt><dd>{receiptId == null ? preview.receiptNo
          : <button type="button" className="xiaoman-source-link" aria-label={`查看原收款单 ${preview.receiptNo}`} onClick={() => setViewReceipt(true)}>{preview.receiptNo}</button>}</dd></>}
        {receiptChange && <><dt>预计收款余款</dt><dd className="xiaoman-change">{receiptChange}</dd></>}
        {settle && preview.statementNo && <><dt>月结对账单</dt><dd>{preview.statementNo}</dd></>}
        {statementChange && <><dt>预计对账单欠款</dt><dd className="xiaoman-change">{statementChange}</dd></>}
        {refund && <><dt>退款单</dt><dd>{preview.refundNo}</dd><dt>原销售单</dt><dd>{preview.saleOrderNo}</dd>
          {preview.statementNo && <><dt>月结对账单</dt><dd>{preview.statementNo}</dd></>}
          {preview.account && <><dt>出账账户</dt><dd>{preview.account.name}</dd></>}
          <dt>业务日期</dt><dd>{formatDisplayDate(preview.paymentDate)}</dd>
          {backfill && preview.applicationNo && <><dt>补录申请</dt><dd>{preview.applicationNo}</dd></>}
          {backfill && preview.businessPeriod && <><dt>原业务期间</dt><dd>{preview.businessPeriod.replace(/^(\d{4})(\d{2})$/, '$1-$2')}</dd></>}
          {backfill && <><dt>调整凭证期间</dt><dd>{preview.postingMonth || '审批日期所属开放期间'}</dd></>}</>}
        {receipt && <><dt>到账金额</dt><dd className="xiaoman-amount">{money(preview.amountCents ?? preview.totalCents)}</dd><dt>入账账户</dt><dd>{preview.account?.name || '请先选择'}</dd><dt>业务日期</dt><dd>{formatDisplayDate(preview.paymentDate)}</dd></>}
      </dl>
      {needsAccount && awaiting && <fieldset className="xiaoman-accounts"><legend>这笔款入哪个账户？</legend>{(preview.accounts || []).map((account, index) => <button type="button" disabled={busy || recovering} key={account.id} onClick={() => onAccount(index)}>{account.name}</button>)}</fieldset>}
      {settle ? <div className="xiaoman-allocations">{(preview.allocations || []).map(a => {
        const change = showChanges ? balanceChange(a.balanceBeforeCents, a.amountCents) : undefined
        return <div key={a.recordId}>
          <strong>{isSourceId(a.orderId) ? <FinanceOrderLink type={2} orderId={a.orderId} orderNo={a.orderNo} /> : a.orderNo}</strong>
          <div><b>{showChanges ? '本次核销' : '试算核销'} {money(a.amountCents)}</b>{change && <span>预计应收余额 <span className="xiaoman-change">{change}</span></span>}</div>
        </div>
      })}</div>
        : receipt || refund ? null : preview.drafts?.length ? preview.drafts.map((draft, index) => <div className="xiaoman-purchase-group" key={index}><h3>{draft.supplierName}{draft.warehouseName ? ` · ${draft.warehouseName}` : ''}</h3><ProductLines lines={draft.lines} /></div>) : <ProductLines lines={lines} showReserveChange={reserve && showChanges} />}
      {lines.some(line => (line.shortage || 0) > 0) && !reserve && <p className="xiaoman-notice">当前库存有缺口。草稿保留预览数量，确认建单后仍需单独占库。</p>}
      {!reserve && !receipt && preview.totalCents != null && <div className="xiaoman-total"><span>{settle ? '本次核销合计' : backfill ? '原退款金额' : refund ? '本次退款' : '合计'}</span><strong>{money(preview.totalCents)}</strong></div>}
    </div>
    {awaiting && !recovering && <div className="xiaoman-preview-actions">
      <span>{needsAccount ? '选好账户后，再确认登记。' : preview.expiresAt ? <><Clock3 size={13} aria-hidden="true" />有效至 {formatDisplayDateTime(preview.expiresAt)}</> : '请核对以上信息。'}</span>
      <div className="flex flex-wrap items-center gap-2">
        {onCancel && <Button variant="outline" size="sm" disabled={busy || recovering} onClick={onCancel}>作废草稿</Button>}
        {onReselect && <Button variant="outline" size="sm" disabled={busy || recovering} onClick={onReselect}>重选商品</Button>}
        <button className="xiaoman-primary" type="button" disabled={busy || recovering || needsAccount} onClick={onConfirm}>{preview.confirmLabel || '确认建单'}</button>
      </div>
    </div>}
    {!recovering && onReview && (expired ? canReviewExpired : task.reviewRequired) &&
      <div className="xiaoman-preview-actions"><button className="xiaoman-primary" type="button" disabled={busy} onClick={onReview}>核对原预览</button></div>}
    {expired && <p className="xiaoman-preview-expired">这份预览已失效。{canReviewExpired ? '请先核对原任务。' : '请回原单核对当前业务状态。'}</p>}
    {viewReceipt && receiptId != null && <ReceiptDetailDialog open receiptId={receiptId} type={2} onClose={() => setViewReceipt(false)} />}
  </section>
}
