import { getWorkspaceListPath } from '@/lib/workspaceListNavigation'
import { ReturnSourceButton } from '@/pages/returns/ReturnSourceButton'
import { money, qty, unitPrice } from '@/lib/format'
import { roundQuantity } from '@/lib/qtyStep'
import { OrderEntryIssues } from '@/components/shared/OrderEntryIssues'
import { collectOrderIssues } from '@/lib/orderEntry'
import { OrderDetailSections } from '@/components/shared/OrderDetailSections'
import { PurchaseProductIdentity } from './PurchaseProductIdentity'
import { PurchaseEntryTable } from './PurchaseEntryTable'
import { PurchaseQuantitySummary } from './PurchaseQuantitySummary'
import { PurchaseOrderOverview } from './PurchaseOrderOverview'
import { OrderFact, OrderFacts } from '@/components/shared/OrderFacts'
import { groupPurchaseQuantities, purchaseDraftLineAmount, restorePurchaseEntryPrice, summarizePurchaseDraft } from './purchaseSummary'
import { usePurchaseEditEntry } from './usePurchaseEditEntry'
import { VirtualTableBody, VIRTUAL_TABLE_THRESHOLD } from '@/components/shared/VirtualTableBody'
import { buildWorkspaceTabRegistrationFromPath } from '@/router/workspaceRouteMeta'
/**
 * PurchaseFormPage — 采购单新建 / 查看页面（独立路由）
 *
 * 路由：
 *   /purchase/new  → 新建模式（空表单）
 *   /purchase/:id  → 查看模式（已有订单详情 + 操作按钮）
 *
 * 路径由 TabPathContext 提供，不依赖 useLocation，
 * 确保 keep-alive 多标签场景下路径隔离正确。
 */

import { useCallback, useContext, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Plus, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EditModeBadge, UnsavedBadge } from '@/components/shared/EditModeBadge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DatePicker } from '@/components/shared/DatePicker'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { toast } from '@/lib/toast'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { useWorkspaceTabTitle } from '@/hooks/useWorkspaceTabTitle'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import { confirmDirtyLeave } from '@/lib/unsavedChanges'
import { ActionBar } from '@/components/shared/ActionBar'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { SectionCard } from '@/components/shared/SectionCard'
import { SupplierFinder, ProductFinder } from '@/components/finder'
import { PickerField } from '@/components/shared/PickerField'
import { WarehouseSelect } from '@/components/shared/WarehouseSelect'
import { formatDisplayDateTime, formatDisplayDate } from '@/lib/dateTime'
import { cn } from '@/lib/utils'
import DataTable from '@/components/shared/DataTable'
import type { TableColumn } from '@/types'
import {
  useCreatePurchase,
  useUpdatePurchase,
  usePurchaseDetail,
  useConfirmPurchase,
  useWithdrawConfirmPurchase,
  useApprovePurchase,
  useRejectPurchase,
  useCancelPurchase,
} from '@/hooks/usePurchase'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import type { PurchaseOrder, PurchaseOrderItem } from '@/types/purchase'
import type { ProductFinderResult } from '@/types/products'
import type { FinderResult } from '@/types/finder'
import { INBOUND_STATUS_LABEL, type InboundTaskStatus } from '@/types/inbound-tasks'

interface DraftItem extends Omit<PurchaseOrderItem, 'id' | 'amount'> {
  _key: number
  priceWarning?: string | null
  originalAmount?: number
}

/** 历史行用保存的换算率回显基本量；新录入固定单位。 */
function baseQtyOf(item: DraftItem): number | null {
  const rate = (item.entryUnit || item.unit) === item.unit ? 1 : item.conversionRate ?? null
  if (rate == null || !Number.isFinite(rate) || rate <= 0) return null
  return roundQuantity((Number(item.quantity) || 0) * rate)
}

/**
 * 明细行内「可编辑单元」的统一内联外观。
 * 商品选择按钮 / 数量 / 单价三处共用，让"能改的格子"成为同一视觉族——
 * 默认淡边框、hover 边框加深、focus 显主色描边 + ring；只读列则保持纯文本无边框，
 * 这样"哪些格子能改"一眼可辨，同一行里不再是三种边框各说各话。
 */
const EDIT_CELL_CLASS =
  'h-9 w-full rounded-md border border-border/70 bg-background px-3 text-sm transition-colors hover:border-border focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0'

export default function PurchaseFormPage() {
  const tabPath = useContext(TabPathContext)
  const navigate = useNavigate()
  const isNew = tabPath === '/purchase/new' || tabPath === ''
  const purchaseId = isNew ? null : Number(tabPath.split('?')[0].split('/').pop())

  function closeTab(targetPath = '/purchase') {
    const { removeTab } = useWorkspaceStore.getState()
    removeTab(buildWorkspaceTabRegistrationFromPath(tabPath || '/purchase/new').key)
    navigate(getWorkspaceListPath(targetPath))
  }

  if (isNew) return <FormView closeTab={closeTab} tabPath={tabPath} />
  return <DetailView purchaseId={purchaseId!} closeTab={closeTab} tabPath={tabPath} />
}

function FormView({ closeTab, tabPath, editOrder, onSaved, paused = false }: {
  closeTab: (targetPath?: string) => void
  tabPath: string
  editOrder?: PurchaseOrder
  onSaved?: () => void
  paused?: boolean
}) {
  const navigate = useNavigate()
  const createMutate = useCreatePurchase()
  const updateMutate = useUpdatePurchase()
  const isEdit = !!editOrder
  const submitting = createMutate.isPending || updateMutate.isPending
  const formId = useId()
  const fieldId = (field: string) => `${formId}-purchase-${field}`

  const [supplierId, setSupplierId] = useState(editOrder ? String(editOrder.supplierId) : '')
  const [supplierName, setSupplierName] = useState(editOrder?.supplierName ?? '')
  const [warehouseId, setWarehouseId] = useState(editOrder ? String(editOrder.warehouseId) : '')
  const [warehouseName, setWarehouseName] = useState(editOrder?.warehouseName ?? '')
  const [expectedDate, setExpectedDate] = useState(editOrder?.expectedDate ?? '')
  const [remark, setRemark] = useState(editOrder?.remark ?? '')
  const [items, setItems] = useState<DraftItem[]>(
    (editOrder?.items ?? []).map((it, idx) => ({
      _key: idx, productId: it.productId, productCode: it.productCode, productName: it.productName,
      unit: it.unit, entryUnit: it.entryUnit ?? it.unit, conversionRate: it.conversionRate,
      // 保留历史换算快照与四位录入报价；金额只有两位，不能 amount/entryQty 反推报价。
      quantity: it.entryQty ?? it.quantity,
      unitPrice: restorePurchaseEntryPrice(it).verified ? restorePurchaseEntryPrice(it).entryUnitPrice! : Number.NaN,
      priceWarning: restorePurchaseEntryPrice(it).warning, originalAmount: it.amount,
      remark: it.remark ?? '',
      articleNumber: it.articleNumber ?? null, spec: it.spec ?? null, color: it.color ?? null,
    })),
  )
  const [counter, setCounter] = useState(editOrder?.items?.length ?? 0)
  const [finderOpen, setFinderOpen] = useState(false)
  const [finderItemKey, setFinderItemKey] = useState<number | null>(null)
  const [supplierFinderOpen, setSupplierFinderOpen] = useState(false)
  useEffect(() => {
    if (paused) { setFinderOpen(false); setFinderItemKey(null); setSupplierFinderOpen(false) }
  }, [paused])
  const [submitLocked, setSubmitLocked] = useState(false)
  const [validationAttempted, setValidationAttempted] = useState(false)
  const quantityRefs = useRef<Map<number, HTMLInputElement>>(new Map())
  const entryRef = useRef<HTMLDivElement>(null)
  const scrollToIndex = useRef<((index: number) => void) | null>(null)
  const focusEpoch = useRef(0)
  const pendingFocus = useRef<string | null>(null)
  const registerScroll = useCallback((scroll: ((index: number) => void) | null) => { scrollToIndex.current = scroll }, [])
  const rowKey = useCallback((item: DraftItem) => item._key, [])
  const active = useActiveWorkspaceTab(), activeRef = useRef(active)
  activeRef.current = active
  useEffect(() => () => { focusEpoch.current++ }, [])
  const [supplierError, setSupplierError] = useState(false)
  const [warehouseError, setWarehouseError] = useState(false)


  // 编辑态：初始值本就非空，"是否非空"不能代表"是否改过"；改成与编辑开始时的快照比较
  // 明细行只比对用户可改字段。
  const dirtyComparable = () => JSON.stringify({ supplierId, warehouseId, expectedDate, remark, items: items.map(({ priceWarning: _warning, originalAmount: _amount, ...item }) => item) })
  const editSnapshotRef = useRef(isEdit ? dirtyComparable() : null)
  const isDirty = isEdit
    ? dirtyComparable() !== editSnapshotRef.current
    : !!(supplierId || warehouseId || expectedDate || remark || items.length)
  const dirtyKey = buildWorkspaceTabRegistrationFromPath(tabPath).key
  useDirtyGuard(dirtyKey, isDirty)

  function requestLeave(proceed: () => void) {
    confirmDirtyLeave({
      dirtyKeys: [dirtyKey],
      proceed,
    })
  }

  const focusField = useCallback((target: string) => {
    const field = () => [...(entryRef.current?.querySelectorAll<HTMLElement>('[data-entry-field]') ?? [])].find(el => el.dataset.entryField === target)
    const focus = () => {
      const container = field()
      const control = container?.matches('input,button,select,textarea') ? container : container?.querySelector<HTMLElement>('input,button,select,textarea')
      if (!control?.isConnected || control.closest('[hidden]')) return false
      control.focus(); if (control instanceof HTMLInputElement) control.select()
      control.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
      return true
    }
    const index = items.findIndex(i => target.startsWith(`item-${i._key}-`))
    if (index >= 0) scrollToIndex.current?.(index)
    const epoch = ++focusEpoch.current
    if (focus()) return
    let tries = 0
    const retry = () => {
      if (epoch !== focusEpoch.current || !activeRef.current || !entryRef.current?.isConnected || focus() || ++tries > 30) return
      requestAnimationFrame(retry)
    }
    requestAnimationFrame(retry)
  }, [items])
  useEffect(() => { if (pendingFocus.current) { const target = pendingFocus.current; pendingFocus.current = null; focusField(target) } }, [items, focusField])

  function handleEntryKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.ctrlKey || event.altKey || event.metaKey) return
    const input = event.target
    if (!(input instanceof HTMLInputElement) || !input.hasAttribute('data-entry-input')) return
    const fields = items.flatMap(i => [`item-${i._key}-quantity`, `item-${i._key}-price`])
    const index = fields.indexOf(input.dataset.entryField ?? '')
    if (index < 0) return
    event.preventDefault()
    const target = fields[index + (event.shiftKey ? -1 : 1)] ?? (!event.shiftKey ? 'add' : null)
    if (target) focusField(target)
  }

  const addItem = () => {
    const key = counter
    setCounter(c => c + 1)
    setFinderItemKey(key)
    setFinderOpen(true)
  }

  const removeItem = (k: number) => setItems(p => p.filter(i => i._key !== k))
  const updateItem = (k: number, field: string, val: string | number) =>
    setItems(p => p.map(i => (i._key === k ? { ...i, [field]: val, ...(field === 'unitPrice' ? { priceWarning: null } : {}) } : i)))

  const parsePositiveInteger = (value: string) => {
    if (!value.trim()) return 0
    const num = Number(value)
    return Number.isSafeInteger(num) ? num : 0
  }

  function handleFinderConfirm(product: ProductFinderResult) {
    if (finderItemKey === null) return
    const k = finderItemKey
    pendingFocus.current = `item-${k}-quantity`
    setItems(prev => {
      const previous = prev.find(i => i._key === k)
      const replacement = {
              ...(previous ?? { _key: k, quantity: 1, remark: '' }),
              quantity: previous?.entryUnit && previous.entryUnit !== previous.unit ? 0 : previous?.quantity ?? 1,
              productId: product.id,
              productCode: product.code,
              productName: product.name,
              unit: product.unit,
              entryUnit: product.unit,   // 新录入只使用商品固定单位
              conversionRate: 1, priceWarning: null, originalAmount: undefined,
              unitPrice: product.costPrice ?? 0,
              articleNumber: product.articleNumber,
              spec: product.spec,
              color: product.color,
            }
      return prev.some(i => i._key === k) ? prev.map(i => i._key === k ? replacement : i) : [...prev, replacement]
    })
  }

  function handleSupplierConfirm(result: FinderResult) {
    setSupplierId(String(result.id))
    setSupplierName(result.name)
    setSupplierError(false)
  }

  const allIssues = collectOrderIssues({ kind: 'purchase', partyId: supplierId, partyName: supplierName, warehouseId, warehouseName, items })
  const issues = validationAttempted ? allIssues : []

  async function handleSubmit() {
    if (submitLocked || submitting || paused) return
    setValidationAttempted(true)
    setSupplierError(allIssues.some(i => i.target === 'party'))
    setWarehouseError(allIssues.some(i => i.target === 'warehouse'))
    if (allIssues.length) return
    if (items.some(item => item.entryUnit && item.entryUnit !== item.unit)) {
      toast.warning('多单位功能已删除；原换算行保持历史值，请重新选择商品并按固定单位核对数量和单价后保存')
      return
    }
    const payload = {
      supplierId: +supplierId,
      supplierName,
      warehouseId: +warehouseId,
      warehouseName,
      expectedDate: expectedDate || undefined,
      remark: remark || undefined,
      items: items.map(({ _key, priceWarning, originalAmount, conversionRate, ...rest }) => rest),
    }
    try {
      setSubmitLocked(true)
      if (isEdit && editOrder) {
        await updateMutate.mutateAsync({ id: editOrder.id, data: payload })
        toast.success('已保存')
        onSaved?.()
      } else {
        const res = await createMutate.mutateAsync(payload)
        const id = res?.id
        toast.success('采购单已创建')
        closeTab(id ? `/purchase/${id}` : '/purchase')
      }
    } catch (_) {
    } finally {
      setSubmitLocked(false)
    }
  }

  const summary = summarizePurchaseDraft(items)

  function renderItem(item: DraftItem) {
    return <tr key={item._key} className="border-b border-border/40">
      <td><PurchaseProductIdentity item={item} name={<button type="button" data-entry-field={`item-${item._key}-product`}
        onClick={() => { setFinderItemKey(item._key); setFinderOpen(true) }}
        className="max-w-full text-left font-medium text-foreground underline-offset-2 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [overflow-wrap:anywhere]">{item.productName}</button>} /></td>
      <td><Input quantity type="number" min="1" step="1" data-entry-input data-entry-field={`item-${item._key}-quantity`}
        aria-label={`${item.productName}数量`} aria-invalid={issues.some(i => i.target === `item-${item._key}-quantity`)}
        ref={el => { if (el) quantityRefs.current.set(item._key, el); else quantityRefs.current.delete(item._key) }}
        value={item.quantity} onChange={e => updateItem(item._key, 'quantity', parsePositiveInteger(e.target.value))}
        className={cn(EDIT_CELL_CLASS, 'text-right tabular-nums')} />
        {item.entryUnit && item.entryUnit !== item.unit && <div className="mt-0.5 text-xs text-warning-ink" role="alert">历史换算行：{baseQtyOf(item) == null ? '基本量待核对' : `${qty(baseQtyOf(item))} ${item.unit}`}。保存前请重新选择商品并核对数量、单价。</div>}
      </td>
      <td><span className="text-muted-body">{item.entryUnit || item.unit}</span></td>
      <td><Input type="number" min="0" step="0.0001" data-entry-input data-entry-field={`item-${item._key}-price`}
        aria-label={`${item.productName}单价`} aria-invalid={issues.some(i => i.target === `item-${item._key}-price`)}
        value={Number.isFinite(item.unitPrice) ? item.unitPrice : ''} onChange={e => updateItem(item._key, 'unitPrice', e.target.value === '' ? Number.NaN : +e.target.value)} className={cn(EDIT_CELL_CLASS, 'text-right tabular-nums')} />
        {item.priceWarning && <p role="alert" className="mt-1 text-xs text-warning-ink">{item.priceWarning}；原行金额 {money(item.originalAmount)}</p>}
      </td>
      <td className="text-right font-medium tabular-nums">{money(purchaseDraftLineAmount(item.quantity, item.unitPrice))}</td>
      <td className="text-center"><Button type="button" size="sm" variant="ghost" aria-label="删除该行商品" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive-ink" onClick={() => removeItem(item._key)}>✕</Button></td>
    </tr>
  }

  return (
    <div ref={entryRef} data-order-entry onKeyDown={handleEntryKeyDown} className="desktop-purchase-form flex min-w-0 flex-col gap-3">
      <ActionBar
        title={isEdit ? '编辑采购单' : '新建采购单'}
        description="填写供应商、仓库与采购明细。"
        subtitle={isEdit || isDirty ? <>{isEdit && <EditModeBadge />}<UnsavedBadge show={isDirty} /></> : undefined}
        rightActions={
          <>
            <Button variant="outline" disabled={submitting || submitLocked} onClick={() => requestLeave(() => isEdit ? onSaved?.() : closeTab())}>
              {isEdit ? '取消编辑' : '取消'}
            </Button>
            <Button onClick={handleSubmit} disabled={submitting || submitLocked || paused} className="gap-1.5">
              {submitting || submitLocked ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  保存中…
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  {isEdit ? '保存修改' : '保存草稿'}
                </>
              )}
            </Button>
          </>
        }
      />

      <OrderEntryIssues issues={issues} onLocate={focusField} />
      <SectionCard title="订单信息" compact>
        <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-4 [&>*]:min-w-0">
          <div data-entry-field="party" className="space-y-1.5">
            <Label htmlFor={fieldId('supplier')}>供应商 *</Label>
            <PickerField
              id={fieldId('supplier')}
              value={supplierName}
              placeholder="点击选择供应商…"
              onOpen={() => setSupplierFinderOpen(true)}
              onDoubleClick={() => {
                setSupplierFinderOpen(false)
                requestLeave(() => navigate('/suppliers'))
              }}
              className={cn(supplierError && 'border-destructive/60 bg-destructive/5')}
            />
            {supplierError && <p className="text-xs text-destructive-ink">请选择供应商</p>}
          </div>

          <div data-entry-field="warehouse" className="space-y-1.5">
            <Label htmlFor={fieldId('warehouse')}>入库仓库 *</Label>
            <WarehouseSelect
              id={fieldId('warehouse')}
              value={warehouseId ? +warehouseId : null}
              onChange={(id, name) => { setWarehouseId(id ? String(id) : ''); setWarehouseName(name); setWarehouseError(false) }}
              placeholder="选择仓库"
              className={cn(warehouseError && 'border-destructive/60 bg-destructive/5')}
            />
            {warehouseError && <p className="text-xs text-destructive-ink">请选择仓库</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={fieldId('expected-date')}>预计到货日期</Label>
            <DatePicker id={fieldId('expected-date')} value={expectedDate} onChange={setExpectedDate} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={fieldId('remark')}>备注</Label>
            <Input
              id={fieldId('remark')}
              maxLength={50}
              value={remark}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRemark(e.target.value)}
              placeholder="选填"
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="商品明细"
        compact
        actions={
          <Button data-entry-add data-entry-field="add" type="button" size="sm" variant="outline" onClick={addItem} className="gap-1.5">
            <Plus className="h-4 w-4" />
            添加商品
          </Button>
        }
      >
        {items.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">暂无商品明细</p> : <>
          <div className="overflow-x-auto" data-table-scroll>
            <PurchaseEntryTable rowCount={items.length + 1} stickyHeader={items.length >= VIRTUAL_TABLE_THRESHOLD}>
              {items.length >= VIRTUAL_TABLE_THRESHOLD
                ? <VirtualTableBody data={items} columns={6} getRowKey={rowKey} renderRow={renderItem} onScrollToIndexReady={registerScroll} />
                : <tbody>{items.map(renderItem)}</tbody>}
            </PurchaseEntryTable>
          </div>
          <div className="desktop-order-total flex flex-wrap items-center justify-between gap-3 border-t border-border px-3 py-2 text-sm">
            <div className="min-w-0 space-y-1"><p className="text-muted-body">商品明细：{items.length} 行{summary.invalidLineCount > 0 && <span className="ml-2 text-warning-ink">{summary.invalidLineCount} 行待核对，金额仅含有效明细</span>}</p><PurchaseQuantitySummary groups={summary.quantityGroups} /></div>
            <p className="tabular-nums"><span className="mr-3 text-muted-foreground">采购金额</span><strong>{money(summary.amount)}</strong></p>
          </div>
        </>}
      </SectionCard>

      <ProductFinder
        compact context="purchase" dialogId="purchase-product-finder"
        mode="purchase"
        warehouseName={warehouseName}
        open={finderOpen && !paused}
        warehouseId={warehouseId ? +warehouseId : null}
        onConfirm={handleFinderConfirm}
        onClose={() => {
          setFinderOpen(false)
          setFinderItemKey(null)
        }}
      />

      <SupplierFinder
        compact context="purchase" dialogId="purchase-supplier-finder"
        open={supplierFinderOpen && !paused}
        onClose={() => setSupplierFinderOpen(false)}
        onConfirm={handleSupplierConfirm}
      />

      <div className="h-4" />
    </div>
  )
}

function DetailView({ purchaseId, closeTab, tabPath }: { purchaseId: number; closeTab: (targetPath?: string) => void; tabPath: string }) {
  const navigate = useNavigate()
  const isActiveTab = useActiveWorkspaceTab()
  // 采购/收货是 PDA 现场高频变化的单据，标签页常驻挂载时若不轮询容易看到陈旧的收货进度
  const { data: order, isLoading, isFetching, error, refetch } = usePurchaseDetail(purchaseId, { refetchInterval: isActiveTab ? 20_000 : false })
  useWorkspaceTabTitle(order?.orderNo)
  const confirmMutate = useConfirmPurchase()
  const withdrawConfirmMutate = useWithdrawConfirmPurchase()
  const approveMutate = useApprovePurchase()
  const rejectMutate = useRejectPurchase()
  const cancelMutate  = useCancelPurchase()
  const { can } = usePermission()
  const canApprove = can(PERMISSIONS.PURCHASE_ORDER_APPROVE)
  const canEdit = can(PERMISSIONS.PURCHASE_ORDER_CREATE)
  const [editing, setEditing] = useState(false)
  usePurchaseEditEntry(tabPath, !!order && !isLoading && !isFetching && !error, () => { if (order?.status === 1 && canEdit) setEditing(true) })

  const [confirmState, setConfirmState] = useState<{
    open: boolean
    title: string
    description: string
    variant: 'default' | 'destructive'
    confirmText?: string
    onConfirm: () => void
  }>({ open: false, title: '', description: '', variant: 'default', onConfirm: () => {} })

  // 审批驳回弹窗（审计 4.7）
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  function ask(
    title: string, description: string,
    variant: 'default' | 'destructive',
    onConfirm: () => void,
    confirmText?: string,
  ) {
    setConfirmState({ open: true, title, description, variant, onConfirm, confirmText })
  }

  if (isLoading && !order) {
    return (
      <div className="flex h-40 items-center justify-center text-muted-body">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />加载中…
      </div>
    )
  }

  const status = (error as { status?: number; response?: { status?: number } } | null)?.status ?? (error as { response?: { status?: number } } | null)?.response?.status
  const accessUnavailable = status === 403 || status === 404
  if (accessUnavailable && !(order && editing)) {
    return (
      <div className="flex h-40 flex-col items-center justify-center gap-3 text-muted-foreground">
        <p className="text-sm">{status === 403 ? '没有权限查看采购单' : '采购单不存在或已删除'}</p>
        <Button variant="outline" onClick={() => closeTab()}>返回采购列表</Button>
      </div>
    )
  }
  if (!order) {
    return <QueryErrorState error={error} title="采购单加载失败" description="请重试读取采购单" onRetry={() => { void refetch() }} />
  }

  const canConfirm = order.status === 1 && can(PERMISSIONS.PURCHASE_ORDER_CONFIRM)
  const hasActiveInboundTask = (order.inboundTasks ?? []).some(t => t.status !== 5)
  const canWithdrawConfirm = (order.status === 2 || order.status === 5) && !hasActiveInboundTask && can(PERMISSIONS.PURCHASE_ORDER_CONFIRM)
  const canCancel = [1, 2, 5].includes(order.status) && can(PERMISSIONS.PURCHASE_ORDER_CANCEL)
  const isPending = confirmMutate.isPending || withdrawConfirmMutate.isPending || cancelMutate.isPending || approveMutate.isPending || rejectMutate.isPending
  const editPaused = editing && (accessUnavailable || !canEdit || order.status !== 1)
  const pauseReason = status === 403 ? '没有权限查看采购单' : status === 404 ? '采购单不存在或已删除' : !canEdit ? '当前没有采购编辑权限' : '采购单已不是草稿，无法继续编辑'

  return (
    <div className="desktop-purchase-detail flex flex-col gap-3">
      <div hidden={!editPaused} role={editPaused ? 'alert' : undefined} className="flex h-40 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <p>{pauseReason}</p><p>未保存编辑内容已保留，恢复后再继续。</p>
        <div className="flex gap-2"><Button variant="outline" onClick={() => closeTab()}>返回采购列表</Button><Button variant="outline" onClick={() => { void refetch() }}>重试</Button></div>
      </div>
      <div hidden={!error || editPaused} role={error && !editPaused ? 'alert' : undefined} className="flex items-center justify-between gap-3 rounded-md border border-warning/30 px-3 py-2 text-sm">
        <span>刷新失败，当前显示上次读取的数据{editing ? '；编辑内容已保留' : ''}。</span>
        <Button size="sm" variant="outline" onClick={() => { void refetch() }}>重试</Button>
      </div>
      <div hidden={editPaused} className="flex min-w-0 flex-col gap-3">
      {editing ? <FormView editOrder={order} closeTab={closeTab} tabPath={tabPath} paused={editPaused} onSaved={() => setEditing(false)} /> : <>
      <ActionBar
        title={order.orderNo}
        description="核对采购明细、金额与收货进度。"
        subtitle={<StatusBadge type="purchase" status={order.status} />}
        rightActions={
          <>
            <ReturnSourceButton kind="purchase" sourceId={order.id} sourceNo={order.orderNo} />
            {canCancel && (
              <Button variant="outline" className="border-destructive/30 text-destructive-ink hover:bg-destructive/5" disabled={isPending}
                onClick={() => ask('取消采购单', '取消后此采购单将无法恢复，请确认操作。', 'destructive', () => {
                  setConfirmState(s => ({ ...s, open: false }))
                  cancelMutate.mutate(order.id)
                })}>
                取消
              </Button>
            )}
            {order.status === 1 && canEdit && (
              <Button variant="outline" disabled={isPending} onClick={() => setEditing(true)}>
                编辑
              </Button>
            )}
            {canWithdrawConfirm && (
              <Button variant="outline" disabled={isPending}
                onClick={() => ask('撤回确认', '撤回后采购单将恢复为草稿状态，可重新编辑后再次提交。', 'default', () => {
                  setConfirmState(s => ({ ...s, open: false }))
                  withdrawConfirmMutate.mutate(order.id)
                }, '撤回确认')}>
                撤回确认
              </Button>
            )}
            {/* 待审批单：审批通过/驳回（审计 4.7） */}
            {order.status === 5 && canApprove && (
              <>
                <Button variant="outline" disabled={isPending}
                  onClick={() => ask('审批通过', '通过后该采购单可创建收货订单。', 'default', () => {
                    setConfirmState(s => ({ ...s, open: false }))
                    approveMutate.mutate(order.id)
                  }, '通过')}>
                  审批通过
                </Button>
                <Button variant="outline" className="border-destructive/30 text-destructive-ink hover:bg-destructive/5" disabled={isPending}
                  onClick={() => setRejectOpen(true)}>
                  驳回
                </Button>
              </>
            )}
            {canConfirm && (
              <Button variant="outline" disabled={isPending}
                onClick={() => ask('提交采购单', '提交后采购单将进入待收货阶段，后续由收货入库单承接到货。', 'default', () => {
                  setConfirmState(s => ({ ...s, open: false }))
                  confirmMutate.mutate(order.id)
                })}>
                提交
              </Button>
            )}

          </>
        }
      />

      <PurchaseOrderOverview order={order} />
      <OrderDetailSections type="purchase" id={order.id}>
      <SectionCard title="基础信息" compact contentClassName="p-3">
        <OrderFacts>
          {[
            ['供应商',     order.supplierName],
            ['仓库',       order.warehouseName],
            ['预计到货',   formatDisplayDate(order.expectedDate)],
            ['经办人',     order.operatorName],
            ['创建时间',   formatDisplayDateTime(order.createdAt)],
          ].map(([label, value]) => (
            <OrderFact key={label} label={label!}>{value}</OrderFact>
          ))}
          {(order.totalOrderedQty ?? 0) > 0 && !!order.items?.length && order.items.every(i => i.productId === order.items![0].productId && i.unit === order.items![0].unit) && (() => {
            const ordered = order.totalOrderedQty ?? 0
            const received = order.totalReceivedQty ?? 0
            const pct = ordered > 0 ? Math.min(100, Math.round(received / ordered * 100)) : 0
            const fullyReceived = received >= ordered
            return (
              <OrderFact label="收货进度">
                <span className={cn('font-medium', fullyReceived && 'text-success-ink')}>{qty(received)} / {qty(ordered)} {order.items![0].unit}</span>
                <div className="mt-1.5 h-1.5 w-full max-w-32 rounded-full bg-muted">
                  <div
                    className="h-1.5 rounded-full transition-all"
                    style={{ width: `${pct}%`, background: fullyReceived ? 'hsl(var(--success))' : 'hsl(var(--primary))' }}
                  />
                </div>
              </OrderFact>
            )
          })()}
          {order.remark && (
            <OrderFact label="备注" className="col-span-full"><span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{order.remark}</span></OrderFact>
          )}
          {!!order.inboundTasks?.length && (
            <OrderFact label="关联收货入库单" className="col-span-full">
              <span className="inline-flex flex-wrap items-center gap-2 align-middle">
                {order.inboundTasks.map(t => {
                  // 跟收货订单详情页保持一致：不能只看 status（4=已完成）字段，还要看
                  // receiptStatus——打印超时/上架超期等异常也会让它显示"异常中"，
                  // 不然这里显示"已完成"，点进去却是异常，会让人confused
                  const label = t.receiptStatus?.label ?? INBOUND_STATUS_LABEL[t.status as InboundTaskStatus] ?? '未知'
                  const toneClass = t.receiptStatus?.key === 'exception'
                    ? 'text-destructive-ink'
                    : t.receiptStatus?.key === 'audited'
                      ? 'text-success-ink'
                      : 'text-muted-foreground'
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => navigate(`/inbound-tasks/${t.id}`)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground transition-colors hover:border-primary hover:bg-muted/30"
                    >
                      {t.taskNo}
                      <span className={toneClass}>{label}</span>
                    </button>
                  )
                })}
              </span>
            </OrderFact>
          )}
        </OrderFacts>
      </SectionCard>

      <SectionCard title="商品明细" compact noPadding>
        <div data-workspace-scroll tabIndex={0} aria-label="采购商品明细" className="max-h-[min(60vh,36rem)] overflow-auto [&>div]:rounded-none [&>div]:border-0 [&>div]:overflow-visible [&_[data-table-scroll]]:overflow-visible [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10">
        <DataTable columns={[
          { key: 'productName', title: '商品', width: 44, minWidth: 220, render: (_, item) => <PurchaseProductIdentity item={item} /> },
          { key: 'quantity', title: '数量', width: 17, minWidth: 100, align: 'right', render: (_, item) => <div className="tabular-nums">{qty(item.entryQty ?? (item.entryUnit === item.unit || !item.entryUnit ? item.quantity : null))}
            {!!item.entryUnit && item.entryUnit !== item.unit && <div className="text-xs text-muted-foreground">= {qty(item.quantity)} {item.unit}</div>}
          </div> },
          { key: 'entryUnit', title: '单位', width: 10, minWidth: 70, render: (_, item) => item.entryUnit || item.unit },
          { key: 'unitPrice', title: '单价', width: 16, minWidth: 110, align: 'right', render: (v, item) => {
            const restored = restorePurchaseEntryPrice(item)
            return <span className="tabular-nums" title={`基本单位单价 ${unitPrice(Number(v), 8)} / ${item.unit}`}>{restored.verified ? unitPrice(restored.entryUnitPrice) : `${unitPrice(Number(v), 8)}/${item.unit}`}</span>
          } },
          { key: 'amount', title: '金额', width: 13, minWidth: 96, align: 'right', render: v => <span className="font-medium tabular-nums">{money(Number(v))}</span> },
        ] satisfies TableColumn<PurchaseOrderItem>[]}
          data={order.items ?? []} rowKey="id" emptyText="暂无商品明细" fluid virtualized columnStorageKey="purchase-detail-items" />
        </div>
        <div aria-label="采购商品明细汇总" className="desktop-order-total flex flex-wrap items-center justify-end gap-x-6 gap-y-2 border-t border-border px-4 py-3 text-sm">
          <span className="mr-auto tabular-nums"><span className="text-muted-foreground">明细</span> {order.items?.length ?? 0} 行</span>
          <PurchaseQuantitySummary groups={groupPurchaseQuantities(order.items ?? [], 'saved')} />
          <strong className="tabular-nums"><span className="mr-2 font-normal">采购金额合计</span>{money(order.totalAmount)}</strong>
        </div>
      </SectionCard>

      </OrderDetailSections>

      <div className="h-4" />

      <ConfirmDialog
        open={confirmState.open}
        title={confirmState.title}
        description={confirmState.description}
        variant={confirmState.variant}
        confirmText={
          confirmState.confirmText
            ?? (confirmState.variant === 'destructive' ? '确认取消' : '确认')
        }
        loading={isPending}
        onConfirm={confirmState.onConfirm}
        onCancel={() => setConfirmState(s => ({ ...s, open: false }))}
      />

      {/* 审批驳回弹窗（审计 4.7） */}
      <Dialog open={rejectOpen} onOpenChange={(v) => !v && setRejectOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader description={"填写驳回原因，供采购人员调整。"}><DialogTitle>驳回采购单 {order.orderNo}</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>驳回原因 *</Label>
            <Input
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              maxLength={300}
              placeholder="请填写驳回原因"
            />
          </div>
          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setRejectOpen(false)}>取消</Button>
            <Button
              variant="destructive"
              disabled={rejectMutate.isPending || !rejectReason.trim()}
              onClick={() => rejectMutate.mutate(
                { id: order.id, reason: rejectReason.trim() },
                { onSettled: () => { setRejectOpen(false); setRejectReason('') } },
              )}
            >
              {rejectMutate.isPending ? '驳回中…' : '确认驳回'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </>}
      </div>
    </div>
  )
}
