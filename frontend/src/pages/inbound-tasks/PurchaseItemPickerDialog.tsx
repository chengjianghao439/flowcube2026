import { inboundEditConfig, inboundEditOwnerCurrent, mayUpdateInbound, type InboundEditOwner } from '@/hooks/useInboundTaskEditRecovery'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { AppDialog } from '@/components/shared/AppDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { OrderFieldError } from '@/components/shared/OrderFieldError'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { InboundProductIdentity } from './InboundProductIdentity'
import { useInboundPurchaseCandidates } from '@/hooks/useInboundTasks'
import { verifyInboundEditPurchaseSelection, verifyInboundPurchaseSelection } from '@/api/inbound-tasks'
import { qty as formatQty, unitPrice } from '@/lib/format'
import { quantityInputError } from '@/lib/qtyStep'
import { InboundEntryTable, type InboundEntryFocus } from './InboundEntryTable'
import type { InboundPurchaseCandidate, PickedPurchaseItem } from '@/types/inbound-tasks'
interface Props {
  editTaskId?: number; readOwner?: InboundEditOwner; canInteract?: () => boolean
  open: boolean; supplierId: number | null; initialSelection: Record<number, PickedPurchaseItem>
  onClose: () => void; onConfirm: (rows: PickedPurchaseItem[]) => void
}
function checkLineQuantity(entry: PickedPurchaseItem): { qty: number; error: string | null } {
  const raw = (entry.qtyInput ?? String(entry.qty)).trim()
  if (!raw) return { qty: 0, error: null }
  const qty = Number(raw)
  const precisionError = quantityInputError(raw)
  if (precisionError) return { qty, error: precisionError }
  if (qty < 0) return { qty, error: '本次收货数量不能为负数' }
  if (!Number.isFinite(entry.item.remainingQty) || qty > entry.item.remainingQty) return { qty, error: '超出可建单数量' }
  return { qty, error: null }
}

export function PurchaseItemPickerDialog({ open, supplierId, initialSelection, onClose, onConfirm, editTaskId, readOwner, canInteract }: Props) {
  const [search, setSearch] = useState(''), [keyword, setKeyword] = useState('')
  const [selection, setSelection] = useState<Record<number, PickedPurchaseItem>>({})
  const [verifyError, setVerifyError] = useState<unknown>(null), [checking, setChecking] = useState(false)
  const [blurredRows, setBlurredRows] = useState<Set<number>>(new Set())
  const [validationAttempted, setValidationAttempted] = useState(false)
  const [revealedRows, setRevealedRows] = useState<InboundPurchaseCandidate[]>([])
  const pendingFocus = useRef<number | null>(null)
  const focusRowRef = useRef<InboundEntryFocus>(null)
  const fieldPrefix = useId()
  const generation = useRef(0)
  const { data, isLoading, isFetching, error, refetch } = useInboundPurchaseCandidates(open ? supplierId : null, keyword, editTaskId && readOwner ? { taskId: editTaskId, owner: readOwner, visible: open } : undefined)
  const candidates = data?.list ?? []
  const visibleIds = new Set(candidates.map(item => item.purchaseItemId))
  const displayedRows = [...candidates, ...revealedRows.filter(item => !visibleIds.has(item.purchaseItemId))]
  const checked = Object.values(selection).map(row => ({ row, ...checkLineQuantity(row) }))
  const invalid = checked.filter(entry => entry.error)
  const rowErrors = new Map(invalid.map(({ row, error }) => [row.item.purchaseItemId, error]))
  const latest = useRef({ open, canInteract, readOwner })
  latest.current = { open, canInteract, readOwner }
  const allowed = () => latest.current.open && (!latest.current.canInteract || latest.current.canInteract()) && (!latest.current.readOwner || inboundEditOwnerCurrent(latest.current.readOwner) && mayUpdateInbound())
  useEffect(() => () => { latest.current.open = false; generation.current++ }, [])
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open && !wasOpen.current) {
      setSearch(''); setKeyword(''); setSelection({ ...initialSelection }); setVerifyError(null)
      setBlurredRows(new Set()); setValidationAttempted(false); setRevealedRows([])
    }
    wasOpen.current = open
    generation.current += 1
  }, [open, supplierId, initialSelection, editTaskId, readOwner])

  // 问题行可能刚从搜索结果之外添加，提交渲染后再请求表格挂载及定位。
  useLayoutEffect(() => {
    const id = pendingFocus.current
    pendingFocus.current = null
    if (id == null || !allowed() || error || checking) return
    const index = displayedRows.findIndex(item => item.purchaseItemId === id)
    if (index >= 0) focusRowRef.current?.(index, `item-${id}-quantity`)
  })

  function applySearch(value: string) {
    setKeyword(value)
    setRevealedRows([])
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
    const { qty, error: quantityError } = checkLineQuantity(entry)
    if (quantityError) {
      setBlurredRows(previous => new Set(previous).add(purchaseItemId))
      return
    }
    setSelection(previous => {
      const next = { ...previous }
      if (qty === 0) delete next[purchaseItemId]
      else next[purchaseItemId] = { ...entry, qty, qtyInput: String(qty) }
      return next
    })
  }
  async function handleConfirm() {
    if (!allowed() || !supplierId || error || isFetching || checking) return
    setVerifyError(null)
    setValidationAttempted(true)
    if (invalid.length) {
      const visibleError = displayedRows.find(item => rowErrors.has(item.purchaseItemId))
      const displayedIds = new Set(displayedRows.map(item => item.purchaseItemId))
      const hiddenInvalid = invalid.map(({ row }) => row.item).filter(item => !displayedIds.has(item.purchaseItemId))
      pendingFocus.current = visibleError?.purchaseItemId ?? hiddenInvalid[0].purchaseItemId
      setRevealedRows([...revealedRows, ...hiddenInvalid])
      return
    }

    const current = generation.current
    setChecking(true)
    try {
      const rows = checked.filter(entry => entry.qty > 0).map(({ row, qty }) => ({ ...row, qty }))
      const latest = editTaskId && readOwner ? await verifyInboundEditPurchaseSelection(editTaskId, rows.map(row => row.item.purchaseItemId), inboundEditConfig(readOwner)) : await verifyInboundPurchaseSelection(supplierId, rows.map(row => row.item.purchaseItemId))
      if (current !== generation.current || !open || !allowed()) return
      const map = new Map(latest.map(item => [item.purchaseItemId, item]))
      const invalid = rows.find(row => !map.has(row.item.purchaseItemId) || !Number.isFinite(map.get(row.item.purchaseItemId)!.remainingQty) || row.qty > map.get(row.item.purchaseItemId)!.remainingQty)
      if (invalid) throw new Error(`${invalid.item.productName} 的采购明细已失效或可建单数量变化，请核对后修改；已选数量保持不变。`)
      onConfirm(rows.map(row => ({ ...row, qtyInput: String(row.qty), item: map.get(row.item.purchaseItemId)! })))
    } catch (failure) { if (current === generation.current) setVerifyError(failure) }
    finally { setChecking(false) }
  }
  return <AppDialog descriptionInHeader description={!error && data?.truncated ? <span role="status">已读取 {data.list.length.toLocaleString()} / 总匹配 {data.pagination.total.toLocaleString()} 条采购明细；请搜索缩小范围，已选项会保留。</span> : '选择原采购明细并填写本次到货数量。'} open={open} onOpenChange={value => { if (!value && !checking) onClose() }} captureFocusOnOpen dialogId="inbound-purchase-item-picker" title="选择收货商品" defaultWidth={1100} defaultHeight={620} minWidth={600} minHeight={420}
    footer={<div className="flex w-full items-center justify-between"><span className="text-sm text-muted-foreground">已选 {Object.values(selection).filter(row => Number((row.qtyInput ?? String(row.qty)).trim()) > 0).length} 项</span><div className="flex gap-2"><Button variant="outline" onClick={onClose} disabled={checking}>取消</Button><Button onClick={() => { void handleConfirm() }} disabled={!allowed() || !data || !!error || isLoading || isFetching || checking}>{checking ? '核对中…' : '确定'}</Button></div></div>}>
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-2"><Input className="flex-1" aria-label="搜索采购单或商品" placeholder="采购单号 / SKU / 商品名称" value={search} disabled={checking} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') applySearch(search.trim()) }} /><Button variant="outline" disabled={checking} onClick={() => applySearch(search.trim())}>搜索</Button><Button variant="outline" disabled={checking} onClick={() => { setSearch(''); applySearch('') }}>清空</Button></div>
      {error && <QueryErrorState compact error={error} title="采购明细读取失败" onRetry={() => { if (allowed()) void refetch() }} />}
      {verifyError != null && <QueryErrorState compact error={verifyError} title="已选明细核对未通过" onRetry={() => { void handleConfirm() }} />}
      <div className="min-h-0 flex-1 overflow-auto" data-workspace-scroll>
        {isLoading ? <p className="p-6 text-sm text-muted-foreground">加载中…</p> : !error && displayedRows.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">暂无可用采购明细</p> : !error && <InboundEntryTable picker focusRowRef={focusRowRef} data={displayedRows} getRowKey={item => item.purchaseItemId} renderRow={item => {
          const field = `item-${item.purchaseItemId}-quantity`
          const errorId = `${fieldPrefix}-${field}-error`
          const quantityError = validationAttempted || blurredRows.has(item.purchaseItemId) ? rowErrors.get(item.purchaseItemId) : null
          return <tr key={item.purchaseItemId} className="border-b border-border/40">
            <td><InboundProductIdentity item={item} /></td>
            <td data-entry-field={field}>
              <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1">
                {/* 原始输入允许单独小数点；失焦与确认都严格校验，不提前转数或截断。 */}
                <Input inputMode="decimal" step="0.01" className="h-9 min-w-12 max-w-24 flex-1 text-right tabular-nums" placeholder="0"
                  data-purchase-item-id={item.purchaseItemId} aria-label={`${item.purchaseOrderNo} ${item.productName}本次收货数量`}
                  aria-invalid={!!quantityError} aria-describedby={quantityError ? errorId : undefined}
                  value={selection[item.purchaseItemId]?.qtyInput ?? selection[item.purchaseItemId]?.qty ?? ''}
                  disabled={checking || !allowed()} onChange={event => setLineQty(item, event.target.value)} onBlur={() => blurLineQty(item.purchaseItemId)} />
                <span className="min-w-0 text-muted-body [overflow-wrap:anywhere]">{item.unit || '单位未提供'}</span>
              </div>
              <OrderFieldError id={errorId} className="mt-1">{quantityError}</OrderFieldError>
            </td>
            <td className="font-mono text-xs">{item.purchaseOrderNo}</td><td className="text-muted-foreground">{item.warehouseName}</td>
            <td className="text-right text-xs tabular-nums">{formatQty(item.orderedQty)} / {formatQty(item.receivedQty)} / {formatQty(item.remainingQty)} {item.unit || '单位未提供'}</td>
            <td className="text-right tabular-nums">{unitPrice(item.unitPrice)}</td>
          </tr>
        }} />}
      </div>
    </div>
  </AppDialog>
}
