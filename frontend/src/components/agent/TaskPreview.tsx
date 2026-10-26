import { useEffect, useState } from 'react'
import { Check, Clock3 } from 'lucide-react'
import { formatDisplayDate, formatDisplayDateTime } from '@/lib/dateTime'
import { money as formatMoney } from '@/lib/format'
import { GRAPH_LABELS, TASK_STATE_LABELS, type AssistantLine, type AssistantTask } from './types'

const money = (cents: number | undefined) => formatMoney(cents == null ? undefined : cents / 100)
function ProductLines({ lines }: { lines: AssistantLine[] }) {
  return <div className="xiaoman-lines">{lines.map((line, i) => <div className="xiaoman-product" key={`${line.productId}-${i}`}>
    <div><strong>{line.productName}</strong>{line.unitPrice != null || line.unitPriceCents != null ? <span className="xiaoman-line-detail">单价 {line.unitPrice != null ? `¥${line.unitPrice}` : money(line.unitPriceCents ?? undefined)}{line.priceSource?.level ? ` · ${line.priceSource.level}` : ''}</span> : null}</div>
    <span className="xiaoman-quantity">×{line.qty}{line.unit ? ` ${line.unit}` : ''}</span>
  </div>)}</div>
}
export default function TaskPreview({ task, busy, recovering, onConfirm, onAccount }: {
  task: AssistantTask; busy: boolean; recovering: boolean; onConfirm: () => void; onAccount: (index: number) => void
}) {
  const preview = task.preview
  const expiresAt = preview?.expiresAt ? Date.parse(preview.expiresAt) : NaN
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const remaining = expiresAt - Date.now()
    if (remaining > 0 && remaining < 2147483647) {
      const timer = window.setTimeout(() => setNow(Date.now()), remaining + 20)
      return () => window.clearTimeout(timer)
    }
  }, [expiresAt])
  if (!preview) return null
  const expired = task.state === 'EXPIRED' || (task.state === 'AWAITING_CONFIRM' && Number.isFinite(expiresAt) && Math.max(now, Date.now()) >= expiresAt)
  const awaiting = task.state === 'AWAITING_CONFIRM' && !expired
  const receipt = task.graph === 'D-receipt'
  const settle = task.graph === 'D-settle'
  const reserve = task.graph === 'B2-reserve'
  const needsAccount = receipt && !preview.account
  const status = recovering ? '待核对' : expired ? '已失效' : needsAccount && awaiting ? '待选账户' : TASK_STATE_LABELS[task.state] || '待核对'
  const lines = preview.lines || []
  return <section className="xiaoman-preview" aria-label="当前业务预览">
    <div className="xiaoman-preview-heading"><h2>{GRAPH_LABELS[task.graph] || preview.title || '业务预览'}</h2><span className={`xiaoman-state ${task.state === 'DONE' ? 'is-done' : ''}`}>{task.state === 'DONE' && <Check size={12} aria-hidden="true" />}{status}</span></div>
    <div className="xiaoman-preview-body">
      <dl className="xiaoman-facts">
        {preview.customer && <><dt>客户</dt><dd>{preview.customer.name}</dd></>}
        {preview.warehouseName && <><dt>仓库</dt><dd>{preview.warehouseName}</dd></>}
        {receipt && <><dt>到账金额</dt><dd className="xiaoman-amount">{money(preview.amountCents ?? preview.totalCents)}</dd><dt>入账账户</dt><dd>{preview.account?.name || '请先选择'}</dd><dt>业务日期</dt><dd>{formatDisplayDate(preview.paymentDate)}</dd></>}
      </dl>
      {needsAccount && awaiting && <fieldset className="xiaoman-accounts"><legend>这笔款入哪个账户？</legend>{(preview.accounts || []).map((account, index) => <button type="button" disabled={busy || recovering} key={account.id} onClick={() => onAccount(index)}>{account.name}</button>)}</fieldset>}
      {settle ? <div className="xiaoman-allocations">{(preview.allocations || []).map(a => <div key={a.recordId}><strong>{a.orderNo}</strong><div><span>原余额 {money(a.balanceBeforeCents)}</span><b>本次核销 {money(a.amountCents)}</b><span>核销后 {money(a.balanceBeforeCents - a.amountCents)}</span></div></div>)}</div>
        : receipt ? null : preview.drafts?.length ? preview.drafts.map((draft, index) => <div className="xiaoman-purchase-group" key={index}><h3>{draft.supplierName}{draft.warehouseName ? ` · ${draft.warehouseName}` : ''}</h3><ProductLines lines={draft.lines} /></div>) : <ProductLines lines={lines} />}
      {lines.some(line => (line.shortage || 0) > 0) && !reserve && <p className="xiaoman-notice">当前库存有缺口。草稿保留预览数量，确认建单后仍需单独占库。</p>}
      {!reserve && !receipt && preview.totalCents != null && <div className="xiaoman-total"><span>{settle ? '本次核销合计' : '合计'}</span><strong>{money(preview.totalCents)}</strong></div>}
    </div>
    {awaiting && !recovering && <div className="xiaoman-preview-actions">
      <span>{needsAccount ? '选好账户后，再确认登记。' : preview.expiresAt ? <><Clock3 size={13} aria-hidden="true" />有效至 {formatDisplayDateTime(preview.expiresAt)}</> : '请核对以上信息。'}</span>
      <button className="xiaoman-primary" type="button" disabled={busy || recovering || needsAccount} onClick={onConfirm}>{preview.confirmLabel || '确认建单'}</button>
    </div>}
    {expired && <p className="xiaoman-preview-expired">这份预览已失效。请重新说明需求，按最新数据核对。</p>}
  </section>
}
