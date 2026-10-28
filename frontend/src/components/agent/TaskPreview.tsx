import { useEffect, useState } from 'react'
import { Clock3 } from 'lucide-react'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import type { StatusTone } from '@/lib/statusTone'
import { formatDisplayDate, formatDisplayDateTime } from '@/lib/dateTime'
import { money as formatMoney } from '@/lib/format'
import { GRAPH_LABELS, TASK_STATE_LABELS, type AssistantLine, type AssistantTask } from './types'

const money = (cents: number | undefined) => formatMoney(cents == null ? undefined : cents / 100)
function priceSourceLabel(value: AssistantLine['priceSource']) {
  if (!value) return '来源未记录'
  const name = value.name?.trim()
  const level = value.level?.trim()
  const levelName = level && /^[ABCD]$/i.test(level) ? `价格${level.toUpperCase()}` : level
  if (value.source === 'price_list') return `客户价格表：${name || '名称未返回'}`
  if (value.source === 'price_level') return `客户等级价：${name || levelName || '等级未返回'}`
  if (value.source === 'product_cost') return '商品成本价'
  if (value.source) return `来源未识别（${[value.source, name || level].filter(Boolean).join('；')}）`
  return `来源未记录${name || levelName ? `（${name || levelName}）` : ''}`
}
function ProductLines({ lines, reserve = false }: { lines: AssistantLine[]; reserve?: boolean }) {
  return <div className="xiaoman-lines">{lines.map((line, i) => <div className="xiaoman-product" key={`${line.productId}-${i}`}>
    <div><strong>{line.productName}</strong>{line.unitPrice != null || line.unitPriceCents != null ? <span className="xiaoman-line-detail">单价 {line.unitPrice != null ? `¥${line.unitPrice}` : money(line.unitPriceCents ?? undefined)} · {priceSourceLabel(line.priceSource)}</span> : null}{reserve && <span className="xiaoman-line-detail">可用 {line.available ?? '—'}</span>}</div>
    <span className="xiaoman-quantity">×{line.qty}{line.unit ? ` ${line.unit}` : ''}</span>
  </div>)}</div>
}
export default function TaskPreview({ task, busy, recovering, onConfirm, onCancel, onAccount }: {
  task: AssistantTask; busy: boolean; recovering: boolean; onConfirm: () => void; onCancel: () => void; onAccount: (index: number) => void
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
  const blocked = Boolean(task.confirmationBlocked || task.previewUncertain || task.previewStorageError)
  const status = recovering ? '待核对' : expired ? '已失效' : blocked && awaiting ? '确认已暂停' : needsAccount && awaiting ? '待选账户' : TASK_STATE_LABELS[task.state] || '待核对'
  const statusTone: StatusTone = recovering || expired || (blocked && awaiting) || !TASK_STATE_LABELS[task.state] ? 'warning'
    : task.state === 'DONE' ? 'success'
      : ['CANCELLED', 'FAILED_FINAL'].includes(task.state) ? 'danger'
        : ['CREATED', 'PLANNED'].includes(task.state) ? 'draft' : 'active'
  const lines = preview.lines || []
  return <section className="xiaoman-preview" aria-label="当前业务预览">
    <div className="xiaoman-preview-heading"><h2>{GRAPH_LABELS[task.graph] || preview.title || '业务预览'}</h2><SoftStatusLabel className={`xiaoman-state ${task.state === 'DONE' ? 'is-done' : ''}`} label={status} tone={statusTone} /></div>
    <div className="xiaoman-preview-body">
      <dl className="xiaoman-facts">
        {preview.customer && <><dt>客户</dt><dd>{preview.customer.name}</dd></>}
        {preview.warehouseName && <><dt>仓库</dt><dd>{preview.warehouseName}</dd></>}
        {task.graph === 'C-purchase-draft' && preview.drafts && <><dt>本批草稿</dt><dd>{preview.drafts.length}张</dd></>}
        {reserve && preview.orderNo && <><dt>销售单</dt><dd>{preview.orderNo}</dd></>}
        {receipt && <><dt>到账金额</dt><dd className="xiaoman-amount">{money(preview.amountCents ?? preview.totalCents)}</dd><dt>入账账户</dt><dd>{preview.account?.name || '请先选择'}</dd><dt>业务日期</dt><dd>{formatDisplayDate(preview.paymentDate)}</dd></>}
      </dl>
      {needsAccount && awaiting && <fieldset className="xiaoman-accounts"><legend>这笔款入哪个账户？</legend>{(preview.accounts || []).map((account, index) => <button type="button" disabled={busy || recovering} key={account.id} onClick={() => onAccount(index)}>{account.name}</button>)}</fieldset>}
      {settle ? <div className="xiaoman-allocations">{(preview.allocations || []).map(a => <div key={a.recordId}><strong>{a.orderNo}</strong><div><span>原余额 {money(a.balanceBeforeCents)}</span><b>本次核销 {money(a.amountCents)}</b><span>核销后 {money(a.balanceBeforeCents - a.amountCents)}</span></div></div>)}</div>
        : receipt ? null : preview.drafts?.length ? preview.drafts.map((draft, index) => <div className="xiaoman-purchase-group" key={index}><h3>{draft.supplierName}{draft.warehouseName ? ` · ${draft.warehouseName}` : ''}</h3><ProductLines lines={draft.lines} />{draft.totalCents != null && <div className="xiaoman-total"><span>小计</span><strong>{money(draft.totalCents)}</strong></div>}</div>) : <ProductLines lines={lines} reserve={reserve} />}
      {reserve && preview.totalRemain != null && <div className="xiaoman-total"><span>待占合计</span><strong>{preview.totalRemain}</strong></div>}
      {lines.some(line => (line.shortage || 0) > 0) && !reserve && <p className="xiaoman-notice">当前库存有缺口。草稿保留预览数量，确认建单后仍需单独占库。</p>}
      {!reserve && !receipt && preview.totalCents != null && <div className="xiaoman-total"><span>{settle ? '本次核销合计' : '合计'}</span><strong>{money(preview.totalCents)}</strong></div>}
    </div>
    {awaiting && !recovering && <div className="xiaoman-preview-actions">
      <span>{needsAccount ? '选好账户后，再确认登记。' : preview.expiresAt ? <><Clock3 size={13} aria-hidden="true" />有效至 {formatDisplayDateTime(preview.expiresAt)}</> : '请核对以上信息。'}</span>
      <button type="button" disabled={busy || recovering} onClick={onCancel}>放弃预览</button>
      <Button className="xiaoman-primary" size="sm" type="button" disabled={busy || recovering || needsAccount || blocked} onClick={onConfirm}>{preview.confirmLabel || '确认建单'}</Button>
    </div>}
    {awaiting && blocked && <p className="xiaoman-preview-expired">{task.previewStorageError || task.confirmationBlocked || '刚才的请求尚未核对，旧预览确认已暂停。请重新说明修改，或回复“继续原版”重新试算。'}</p>}
    {settle && task.state === 'CANCELLED' && <p className="xiaoman-notice">已放弃本次核销预览。收款已登记，原收款结果保留。</p>}
    {expired && <p className="xiaoman-preview-expired">这份预览已失效。请重新说明需求，按最新数据核对。</p>}
  </section>
}
