import { useContext, useEffect, useId, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Loader2, Save, ShoppingCart } from 'lucide-react'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { ActionBar } from '@/components/shared/ActionBar'
import { SectionCard } from '@/components/shared/SectionCard'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { usePermission } from '@/hooks/usePermission'
import { useWorkspaceTabTitle } from '@/hooks/useWorkspaceTabTitle'
import { useInboundTaskEditContext, useInboundTaskEditRecovery } from '@/hooks/useInboundTasks'
import { captureInboundEditOwner, inboundEditConfig, inboundEditOwnerCurrent, mayUpdateInbound, mayViewInbound, type InboundEditRecord } from '@/hooks/useInboundTaskEditRecovery'
import { verifyInboundEditPurchaseSelection } from '@/api/inbound-tasks'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { PERMISSIONS } from '@/lib/permission-codes'
import { confirmDirtyLeave } from '@/lib/unsavedChanges'
import { getInboundListWorkspacePath } from '@/lib/inboundListNavigation'
import { toast } from '@/lib/toast'
import { quantityInputError } from '@/lib/qtyStep'
import { unitPrice } from '@/lib/format'
import type { InboundTask, InboundTaskEditContext, UpdateInboundTaskResult } from '@/types/inbound-tasks'
import { InboundEntryTable } from './InboundEntryTable'
import { InboundProductIdentity } from './InboundProductIdentity'
import { InboundFreightFields } from './InboundFreightFields'
import { parseInboundFreightAmount, type InboundFreightType } from './inboundFreight'
import { PurchaseItemPickerDialog, type PickedPurchaseItem } from './PurchaseItemPickerDialog'

interface Draft {
  remark: string; freightType: InboundFreightType; freightAmount: string; selected: Record<number, PickedPurchaseItem>
}
interface Baseline { context: InboundTaskEditContext; signature: string; fingerprint: string }
function editable(task?: InboundTask) {
  return !!task && task.draftEditable === true && task.status === 1 && task.submittedAt == null && !!task.items?.length && task.items.every(row => row.receivedQty === 0 && row.putawayQty === 0)
}
const signature = (draft: Draft) => JSON.stringify([draft.remark, draft.freightType, draft.freightAmount, Object.values(draft.selected).map(row => [row.item.purchaseItemId, row.qtyInput ?? String(row.qty)] as const).sort((a, b) => a[0] - b[0])])
function hydrate(context: InboundTaskEditContext, pending: InboundEditRecord | null): Draft {
  const candidates = new Map(context.candidates.map(item => [item.purchaseItemId, item]))
  const originals = new Map(context.task.items?.map(item => [item.purchaseItemId, item.id]))
  const rows = pending?.body.items ?? context.task.items?.map(item => ({ purchaseItemId: item.purchaseItemId, qty: item.orderedQty })) ?? []
  const selected: Record<number, PickedPurchaseItem> = {}
  for (const row of rows) {
    if (!row.purchaseItemId || !candidates.has(row.purchaseItemId) || selected[row.purchaseItemId]) throw Error('原采购明细身份不完整，请重新核对；没有自动合并或补造来源')
    selected[row.purchaseItemId] = { item: candidates.get(row.purchaseItemId)!, qty: row.qty, qtyInput: String(row.qty), inboundItemId: originals.get(row.purchaseItemId) }
  }
  return { selected, remark: pending?.body.remark ?? context.task.remark ?? '', freightType: pending ? pending.body.freightType ?? null : context.task.freightType ?? null,
    freightAmount: String((pending ? pending.body.freightAmount : context.task.freightAmount) ?? '') }
}

export default function InboundTaskEditPage() {
  const prefix = useId(), tabPath = useContext(TabPathContext), location = useLocation(), navigate = useNavigate()
  const path = tabPath || location.pathname + location.search, ownPath = path.split(/[?#]/)[0]
  const match = ownPath.match(/^\/inbound-tasks\/([1-9]\d*)\/edit$/), parsedId = Number(match?.[1]), id = Number.isSafeInteger(parsedId) && parsedId > 0 ? parsedId : null
  const active = useActiveWorkspaceTab(), { can } = usePermission(), [owner] = useState(captureInboundEditOwner)
  const [draft, setDraft] = useState<Draft | null>(null), [baseline, setBaseline] = useState<Baseline | null>(null), [initError, setInitError] = useState(''), [pickerOpen, setPickerOpen] = useState(false)
  const recovery = useInboundTaskEditRecovery(id ?? 0, active, owner, () => writable)
  const readingAllowed = active && (!recovery.pendingRecord || can(PERMISSIONS.INBOUND_ORDER_VIEW))
  const read = useInboundTaskEditContext(id, readingAllowed, owner)
  const ready = readingAllowed && inboundEditOwnerCurrent(owner) && can(PERMISSIONS.INBOUND_ORDER_UPDATE) && !read.error && !read.isFetching && !read.isPaused && read.isFetchedAfterMount && !!id && read.data?.task.id === id
  const writable = ready && editable(read.data?.task) && !!baseline && read.data?.expectedEditFingerprint === baseline.fingerprint
  useWorkspaceTabTitle(baseline ? `编辑 ${baseline.context.task.taskNo}` : undefined)
  const pendingSnapshot = JSON.stringify(recovery.pendingRecord)
  useEffect(() => {
    const pending = JSON.parse(pendingSnapshot) as InboundEditRecord | null
    if (draft || !ready || !read.data || !editable(read.data.task) && !pending) return
    let cancelled = false
    const current = () => !cancelled && inboundEditOwnerCurrent(owner) && mayUpdateInbound() && (!pending || mayViewInbound())
    const context = JSON.parse(JSON.stringify(read.data)) as InboundTaskEditContext
    async function restore() {
      try {
        const known = new Set(context.candidates.map(item => item.purchaseItemId))
        const missing = pending?.body.items.map(row => row.purchaseItemId).filter(itemId => !known.has(itemId)) ?? []
        if (missing.length) {
          const sources = await verifyInboundEditPurchaseSelection(id!, missing, inboundEditConfig(owner))
          if (!current()) return
          const wanted = new Set(missing), seen = new Set<number>()
          for (const item of sources) {
            if (!wanted.has(item.purchaseItemId) || seen.has(item.purchaseItemId) || item.supplierId !== context.supplierId || item.warehouseId !== context.task.warehouseId) throw Error('原采购明细身份不完整，请核对缺失来源；原请求已保留')
            seen.add(item.purchaseItemId)
          }
          context.candidates.push(...sources)
        }
        if (!current()) return
        const initial = hydrate(context, pending)
        setDraft(initial); setBaseline({ context, signature: signature(initial), fingerprint: pending?.body.expectedEditFingerprint ?? context.expectedEditFingerprint }); setInitError('')
      } catch (error) { if (current()) setInitError(error instanceof Error ? error.message : '原明细无法回填') }
    }
    void restore()
    return () => { cancelled = true }
  }, [draft, ready, read.data, pendingSnapshot, owner, id])
  const rows = useMemo(() => Object.values(draft?.selected ?? {}), [draft?.selected])
  const dirty = !!recovery.pendingRecord || !!(draft && baseline && signature(draft) !== baseline.signature)
  useDirtyGuard(path, dirty)
  const blocked = !writable || recovery.blocked
  function closeTab() { useWorkspaceStore.getState().removeTab(path); navigate(getInboundListWorkspacePath()) }
  function patch(change: Partial<Draft>) { if (!blocked) setDraft(previous => previous ? { ...previous, ...change } : null) }
  function lineQty(purchaseItemId: number, raw: string) {
    if (blocked || !draft) return
    const entry = draft.selected[purchaseItemId], qty = Number(raw.replace(/,/g, '').trim())
    if (!entry || !Number.isFinite(qty) || qty < 0 || qty > entry.item.remainingQty) return
    patch({ selected: { ...draft.selected, [purchaseItemId]: { ...entry, qty, qtyInput: raw } } })
  }
  function blurQty(purchaseItemId: number) {
    if (blocked || !draft) return
    const entry = draft.selected[purchaseItemId], raw = entry?.qtyInput ?? String(entry?.qty ?? ''), qty = Number(raw.trim())
    if (entry && raw.trim() && !quantityInputError(raw) && qty > 0 && qty <= entry.item.remainingQty) patch({ selected: { ...draft.selected, [purchaseItemId]: { ...entry, qty, qtyInput: String(qty) } } })
  }
  function picked(pickedRows: PickedPurchaseItem[]) {
    if (blocked || !draft || !baseline) return
    const selected: Record<number, PickedPurchaseItem> = {}, originals = new Map(baseline.context.task.items?.map(item => [item.purchaseItemId, item.id]))
    for (const row of pickedRows) selected[row.item.purchaseItemId] = { ...row, qtyInput: String(row.qty), inboundItemId: draft.selected[row.item.purchaseItemId]?.inboundItemId ?? originals.get(row.item.purchaseItemId) }
    patch({ selected }); setPickerOpen(false)
  }
  function confirmed(result: UpdateInboundTaskResult | null) {
    if (!result || !recovery.canApply(result)) return
    toast.success(`收货订单 ${result.taskNo} 已保存`)
    const detailPath = `/inbound-tasks/${result.taskId}`
    if (can(PERMISSIONS.INBOUND_ORDER_VIEW)) { useWorkspaceStore.getState().addTab({ key: detailPath, path: detailPath, title: result.taskNo }); closeTab(); navigate(detailPath) }
    else closeTab()
  }
  async function save() {
    if (blocked || !draft || !baseline) return
    if (draft.remark.trim().length > 200) { toast.error('备注最多200字，原输入已保留，请核对后修改'); return }
    let freightAmount: number | null
    try { freightAmount = parseInboundFreightAmount(draft.freightAmount) } catch (error) { toast.error(error instanceof Error ? error.message : '请核对运费金额'); return }
    if (!rows.length || rows.some(row => { const raw = row.qtyInput ?? String(row.qty), qty = Number(raw.trim()); return !raw.trim() || !!quantityInputError(raw) || !Number.isFinite(qty) || qty <= 0 || qty > row.item.remainingQty })) { toast.warning('请至少保留一条有效明细，并核对本次到货数量'); return }
    const result = await recovery.submit({ remark: draft.remark.trim(), freightType: draft.freightType, freightAmount, expectedEditFingerprint: baseline.fingerprint, items: rows.map(row => ({ purchaseItemId: row.item.purchaseItemId, qty: Number((row.qtyInput ?? String(row.qty)).trim()) })) })
    confirmed(result)
  }
  const recoveryPanel = recovery.pendingRecord ? <div role="status" className="space-y-2 rounded-md border border-border bg-muted/30 p-3 text-sm">
    <p>{recovery.pendingRecord.phase === 'pending' ? '原保存结果待确认，原内容和请求键已保留。' : '原保存结果已确认，请继续查询以完成记录清理。'}</p>
    {!can(PERMISSIONS.INBOUND_ORDER_VIEW) && <p>当前没有收货订单查看权限，原草稿和请求已保留，请联系有权人员核对。</p>}
    <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={recovery.busy || !can(PERMISSIONS.INBOUND_ORDER_VIEW)} onClick={async () => confirmed(await recovery.queryOriginal())}>查询原保存结果</Button>
      {recovery.canRetry && <Button variant="outline" size="sm" disabled={recovery.busy || !can(PERMISSIONS.INBOUND_ORDER_UPDATE)} onClick={async () => confirmed(await recovery.retry())}>按原请求重试</Button>}</div>
  </div> : null
  return <div className="desktop-inbound-form flex flex-col gap-4">
    <ActionBar title={baseline ? `编辑 ${baseline.context.task.taskNo}` : '编辑收货订单'}
        description="核对收货草稿的来源与商品明细。" rightActions={<>
      <Button variant="outline" onClick={() => confirmDirtyLeave({ dirtyKeys: [path], willNavigate: true, proceed: closeTab })}>取消编辑</Button>
      <Button className="gap-1.5" disabled={blocked || !draft} onClick={() => { void save() }}>{recovery.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{recovery.busy ? '保存中…' : '保存修改'}</Button>
    </>} />
    {recoveryPanel}
    {recovery.error && <p role="alert" className="text-sm text-destructive-ink">{recovery.error}</p>}
    {read.error && <QueryErrorState compact={!!draft} error={read.error} title="编辑资料读取失败，未保存输入已保留" onRetry={() => { if (readingAllowed && inboundEditOwnerCurrent(owner) && can(PERMISSIONS.INBOUND_ORDER_UPDATE)) void read.refetch() }} />}
    {initError && <p role="alert" className="text-sm text-destructive-ink">{initError}</p>}
    {!can(PERMISSIONS.INBOUND_ORDER_UPDATE) && <p className="text-sm text-warning-ink">没有收货订单编辑权限，原输入已保留。</p>}
    {ready && !editable(read.data?.task) && <p className="text-sm text-warning-ink">原单已不属于可编辑草稿，请核对；原输入已保留。</p>}
    {ready && baseline && read.data?.expectedEditFingerprint !== baseline.fingerprint && <p className="text-sm text-warning-ink">原单已变化，请重新打开核对；未保存输入已保留。</p>}
    {!id && <p role="alert">收货订单编号无效</p>}
    {!draft && read.isLoading && <p className="p-6 text-sm text-muted-foreground">加载中…</p>}
    {draft && baseline && <div className="flex flex-col gap-4" hidden={!!read.error && [403, 404].includes(Number((read.error as { status?: number }).status))}>
      <SectionCard title="订单信息" compact><div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div className="space-y-1.5"><label className="text-sm font-medium" htmlFor={`${prefix}-supplier`}>供应商</label><Input id={`${prefix}-supplier`} readOnly className="h-9" value={baseline.context.task.supplierName ?? '—'} /></div>
        <div className="space-y-1.5"><label className="text-sm font-medium" htmlFor={`${prefix}-warehouse`}>仓库</label><Input id={`${prefix}-warehouse`} readOnly className="h-9" value={baseline.context.task.warehouseName ?? '—'} /></div>
        <div className="space-y-1.5"><label className="text-sm font-medium" htmlFor={`${prefix}-remark`}>备注</label><Input id={`${prefix}-remark`} className="h-9" value={draft.remark} maxLength={200} onChange={event => patch({ remark: event.target.value })} disabled={blocked} placeholder="选填" /></div>
        <InboundFreightFields prefix={prefix} freightType={draft.freightType} freightAmount={draft.freightAmount} onTypeChange={freightType => patch({ freightType })} onAmountChange={freightAmount => patch({ freightAmount })} disabled={blocked} />
      </div></SectionCard>
      <SectionCard title="商品明细" compact actions={<Button type="button" size="sm" variant="outline" disabled={blocked} onClick={() => setPickerOpen(true)} className="gap-1.5"><ShoppingCart className="h-4 w-4" />选择商品</Button>}>
        {!rows.length ? <div className="py-6 text-center text-sm text-muted-foreground">尚未选择商品，点击右上角「选择商品」挑选本次到货明细</div> : <>
          <div className="max-h-[60vh] overflow-auto" data-workspace-scroll><InboundEntryTable data={rows} getRowKey={entry => entry.item.purchaseItemId} renderRow={({ item, qty, qtyInput, inboundItemId }) => <tr key={item.purchaseItemId} data-inbound-item-id={inboundItemId} className="border-b border-border/40">
            <td><InboundProductIdentity item={item} /></td><td><div className="flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1"><Input quantity inputMode="decimal" className="h-9 min-w-12 max-w-24 flex-1 text-right tabular-nums" value={qtyInput ?? String(qty)} onBlur={() => blurQty(item.purchaseItemId)} data-purchase-item-id={item.purchaseItemId} aria-label={`${item.purchaseOrderNo} ${item.productName}本次到货数量`} disabled={blocked} onChange={event => lineQty(item.purchaseItemId, event.target.value)} /><span className="min-w-0 text-muted-body [overflow-wrap:anywhere]">{item.unit || '单位未提供'}</span></div></td>
            <td className="font-mono text-xs">{item.purchaseOrderNo}</td><td className="text-muted-foreground">{item.warehouseName}</td><td className="text-right tabular-nums">{unitPrice(item.unitPrice)}</td>
            <td className="text-center"><Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive-ink" disabled={blocked} aria-label={`删除 ${item.purchaseOrderNo} ${item.productName}`} onClick={() => { const selected = { ...draft.selected }; delete selected[item.purchaseItemId]; patch({ selected }) }}>✕</Button></td>
          </tr>} /></div><div className="desktop-order-total border-t border-border px-3 py-2 text-sm text-muted-body">商品明细：{rows.length} 行</div>
        </>}
      </SectionCard>
      <PurchaseItemPickerDialog open={pickerOpen && !blocked} supplierId={baseline.context.supplierId} editTaskId={id!} readOwner={owner} canInteract={() => !blocked} initialSelection={draft.selected} onClose={() => setPickerOpen(false)} onConfirm={picked} />
    </div>}
  </div>
}
