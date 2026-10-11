import { inboundEditConfig, inboundEditOwnerCurrent, mayUpdateInbound, type InboundEditOwner } from '@/hooks/useInboundTaskEditRecovery'
import { useEffect, useRef, useState } from 'react'
import { AppDialog } from '@/components/shared/AppDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { InboundProductIdentity } from './InboundProductIdentity'
import { useInboundPurchaseCandidates } from '@/hooks/useInboundTasks'
import { verifyInboundEditPurchaseSelection, verifyInboundPurchaseSelection } from '@/api/inbound-tasks'
import { qty as formatQty, unitPrice } from '@/lib/format'
import { quantityInputError } from '@/lib/qtyStep'
import { InboundEntryTable } from './InboundEntryTable'
import type { InboundPurchaseCandidate } from '@/types/inbound-tasks'

export interface PickedPurchaseItem { item: InboundPurchaseCandidate; qty: number; qtyInput?: string; inboundItemId?: number }
interface Props {
  editTaskId?: number; readOwner?: InboundEditOwner; canInteract?: () => boolean
  open: boolean; supplierId: number | null; initialSelection: Record<number, PickedPurchaseItem>
  onClose: () => void; onConfirm: (rows: PickedPurchaseItem[]) => void
}
export function PurchaseItemPickerDialog({ open, supplierId, initialSelection, onClose, onConfirm, editTaskId, readOwner, canInteract }: Props) {
  const [search, setSearch] = useState(''), [keyword, setKeyword] = useState('')
  const [selection, setSelection] = useState<Record<number, PickedPurchaseItem>>({})
  const [verifyError, setVerifyError] = useState<unknown>(null), [checking, setChecking] = useState(false)
  const generation = useRef(0)
  const { data, isLoading, isFetching, error, refetch } = useInboundPurchaseCandidates(open ? supplierId : null, keyword, editTaskId && readOwner ? { taskId: editTaskId, owner: readOwner, visible: open } : undefined)
  const candidates = data?.list ?? []
  const latest = useRef({ open, canInteract, readOwner })
  latest.current = { open, canInteract, readOwner }
  const allowed = () => latest.current.open && (!latest.current.canInteract || latest.current.canInteract()) && (!latest.current.readOwner || inboundEditOwnerCurrent(latest.current.readOwner) && mayUpdateInbound())
  useEffect(() => () => { latest.current.open = false; generation.current++ }, [])
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open && !wasOpen.current) {
      setSearch(''); setKeyword(''); setSelection({ ...initialSelection }); setVerifyError(null)
    }
    wasOpen.current = open
    generation.current += 1
  }, [open, supplierId, initialSelection, editTaskId, readOwner])

  function lineQuantity(entry: PickedPurchaseItem): number {
    const raw = (entry.qtyInput ?? String(entry.qty)).trim()
    if (!raw) return 0
    const error = quantityInputError(raw), value = Number(raw)
    if (error || !Number.isFinite(value) || value < 0) throw new Error(`${entry.item.productName}：${error || '本次收货数量不能为负数'}，请核对；原输入已保留。`)
    if (!Number.isFinite(entry.item.remainingQty) || value > entry.item.remainingQty) throw new Error(`${entry.item.productName} 超出可建单数量，请核对；原输入已保留。`)
    return value
  }
  function setLineQty(item: InboundPurchaseCandidate, raw: string) {
    if (!allowed()) return
    setVerifyError(null)
    setSelection(previous => ({ ...previous, [item.purchaseItemId]: { ...previous[item.purchaseItemId], item, qty: previous[item.purchaseItemId]?.qty ?? 0, qtyInput: raw } }))
  }
  function blurLineQty(purchaseItemId: number) {
    if (!allowed() || checking) return
    const entry = selection[purchaseItemId]
    if (!entry) return
    try {
      const qty = lineQuantity(entry)
      setSelection(previous => {
        const next = { ...previous }
        if (qty === 0) delete next[purchaseItemId]
        else next[purchaseItemId] = { ...entry, qty, qtyInput: String(qty) }
        return next
      })
    } catch (failure) { setVerifyError(failure) }
  }
  async function handleConfirm() {
    if (!allowed() || !supplierId || error || isFetching || checking) return
    const current = generation.current
    setChecking(true); setVerifyError(null)
    try {
      const rows = Object.values(selection).map(row => ({ ...row, qty: lineQuantity(row) })).filter(row => row.qty > 0)
      const latest = editTaskId && readOwner ? await verifyInboundEditPurchaseSelection(editTaskId, rows.map(row => row.item.purchaseItemId), inboundEditConfig(readOwner)) : await verifyInboundPurchaseSelection(supplierId, rows.map(row => row.item.purchaseItemId))
      if (current !== generation.current || !open || !allowed()) return
      const map = new Map(latest.map(item => [item.purchaseItemId, item]))
      const invalid = rows.find(row => !map.has(row.item.purchaseItemId) || !Number.isFinite(map.get(row.item.purchaseItemId)!.remainingQty) || row.qty > map.get(row.item.purchaseItemId)!.remainingQty)
      if (invalid) throw new Error(`${invalid.item.productName} 的采购明细已失效或可建单数量变化，请核对后修改；已选数量保持不变。`)
      onConfirm(rows.map(row => ({ ...row, qtyInput: String(row.qty), item: map.get(row.item.purchaseItemId)! })))
    } catch (failure) { if (current === generation.current) setVerifyError(failure) }
    finally { setChecking(false) }
  }
  return <AppDialog open={open} onOpenChange={value => { if (!value && !checking) onClose() }} captureFocusOnOpen dialogId="inbound-purchase-item-picker" title="选择收货商品" defaultWidth={1100} defaultHeight={620} minWidth={600} minHeight={420}
    footer={<div className="flex w-full items-center justify-between"><span className="text-sm text-muted-foreground">已选 {Object.values(selection).filter(row => Number((row.qtyInput ?? String(row.qty)).trim()) > 0).length} 项</span><div className="flex gap-2"><Button variant="outline" onClick={onClose} disabled={checking}>取消</Button><Button onClick={() => { void handleConfirm() }} disabled={!allowed() || !data || !!error || isLoading || isFetching || checking}>{checking ? '核对中…' : '确定'}</Button></div></div>}>
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-2"><Input className="flex-1" aria-label="搜索采购单或商品" placeholder="采购单号 / SKU / 商品名称" value={search} disabled={checking} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') setKeyword(search.trim()) }} /><Button variant="outline" disabled={checking} onClick={() => setKeyword(search.trim())}>搜索</Button><Button variant="outline" disabled={checking} onClick={() => { setSearch(''); setKeyword('') }}>清空</Button></div>
      {error && <QueryErrorState compact error={error} title="采购明细读取失败" onRetry={() => { if (allowed()) void refetch() }} />}
      {verifyError != null && <QueryErrorState compact error={verifyError} title="已选明细核对未通过" onRetry={() => { void handleConfirm() }} />}
      {!error && data?.truncated && <p role="status" className="text-xs text-warning-ink">已读取 {data.list.length.toLocaleString()} / 总匹配 {data.pagination.total.toLocaleString()} 条采购明细；请搜索缩小范围，已选项会保留。</p>}
      <div className="min-h-0 flex-1 overflow-auto" data-workspace-scroll>
        {isLoading ? <p className="p-6 text-sm text-muted-foreground">加载中…</p> : !error && candidates.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">暂无可用采购明细</p> : !error && <InboundEntryTable picker data={candidates} getRowKey={item => item.purchaseItemId} renderRow={item => <tr key={item.purchaseItemId} className="border-b border-border/40">
          <td><InboundProductIdentity item={item} /></td>
          <td><div className="flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1">{/* 原始输入允许单独小数点；失焦与确认都严格校验，不提前转数或截断。 */}<Input inputMode="decimal" step="0.01" className="h-9 min-w-12 max-w-24 flex-1 text-right tabular-nums" placeholder="0" data-purchase-item-id={item.purchaseItemId} aria-label={`${item.purchaseOrderNo} ${item.productName}本次收货数量`} value={selection[item.purchaseItemId]?.qtyInput ?? selection[item.purchaseItemId]?.qty ?? ''} disabled={checking || !allowed()} onChange={event => setLineQty(item, event.target.value)} onBlur={() => blurLineQty(item.purchaseItemId)} /><span className="min-w-0 text-muted-body [overflow-wrap:anywhere]">{item.unit || '单位未提供'}</span></div></td>
          <td className="font-mono text-xs">{item.purchaseOrderNo}</td><td className="text-muted-foreground">{item.warehouseName}</td>
          <td className="text-right text-xs tabular-nums">{formatQty(item.orderedQty)} / {formatQty(item.receivedQty)} / {formatQty(item.remainingQty)} {item.unit || '单位未提供'}</td><td className="text-right tabular-nums">{unitPrice(item.unitPrice)}</td>
        </tr>} />}
      </div>
    </div>
  </AppDialog>
}
