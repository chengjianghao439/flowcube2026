import { InboundFreightFields } from './InboundFreightFields'
import { validateInboundFreightAmount, type InboundFreightType } from './inboundFreight'
import { InboundProductIdentity } from './InboundProductIdentity'
import { InboundEntryTable, type InboundEntryFocus } from './InboundEntryTable'
import { inboundDraftQuantityError } from './inboundQuantity'
import { OrderFieldError } from '@/components/shared/OrderFieldError'
import { focusOrderEntryField } from '@/lib/orderEntryNavigation'
import { cn } from '@/lib/utils'
import { unitPrice } from '@/lib/format'
import { getInboundListWorkspacePath } from '@/lib/inboundListNavigation'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { confirmDirtyLeave } from '@/lib/unsavedChanges'
import { SectionCard } from '@/components/shared/SectionCard'
import { useContext, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Save, ShoppingCart } from 'lucide-react'
import { ActionBar } from '@/components/shared/ActionBar'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import type { InboundCreateRecord } from '@/hooks/useInboundTaskCreateRecovery'
import type { CreateInboundTaskResult, PickedPurchaseItem } from '@/types/inbound-tasks'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { SupplierFinder } from '@/components/finder'
import { PickerField } from '@/components/shared/PickerField'
import type { FinderResult } from '@/types/finder'
import { useCreateInboundTask } from '@/hooks/useInboundTasks'
import { toast } from '@/lib/toast'
import { PurchaseItemPickerDialog } from './PurchaseItemPickerDialog'

export default function InboundTaskCreatePage() {
  const fieldPrefix = useId()
  const entryRef = useRef<HTMLDivElement>(null)
  const focusRowRef = useRef<InboundEntryFocus>(null)
  const [validationAttempted, setValidationAttempted] = useState(false)
  const [rejectedQuantities, setRejectedQuantities] = useState<Record<number, string | undefined>>({})
  const { can } = usePermission()
  const tabPath = useContext(TabPathContext)
  const navigate = useNavigate()
  const addTab = useWorkspaceStore(s => s.addTab)
  const active = useActiveWorkspaceTab(), createInbound = useCreateInboundTask(active)

  const [supplierFinderOpen, setSupplierFinderOpen] = useState(false)
  const [supplier, setSupplier] = useState<FinderResult | null>(null)
  const [remark, setRemark] = useState('')
  const [freightType, setFreightType] = useState<InboundFreightType>(null), [freightAmount, setFreightAmount] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [selectedMap, setSelectedMap] = useState<Record<number, PickedPurchaseItem>>({})

  const pendingSnapshot = createInbound.pendingRecord ? JSON.stringify(createInbound.pendingRecord) : ''
  const settledSnapshot = createInbound.settledRecord ? JSON.stringify(createInbound.settledRecord) : ''
  const previousContext = useRef(createInbound.contextIdentity), formRequestKey = useRef<string | null>(null)
  const formDirty = useRef(false), terminalConsumer = useRef(createInbound.consumeTerminal)
  formDirty.current = !!(supplier || remark || selectedMap && Object.keys(selectedMap).length || freightType != null || freightAmount !== '')
  terminalConsumer.current = createInbound.consumeTerminal
  useEffect(() => {
    function clearOriginalForm() {
      formDirty.current = false
      setSupplier(null); setRemark(''); setFreightType(null); setFreightAmount(''); setSelectedMap({})
      setPickerOpen(false); setSupplierFinderOpen(false); setValidationAttempted(false); setRejectedQuantities({})
    }
    if (previousContext.current !== createInbound.contextIdentity) {
      previousContext.current = createInbound.contextIdentity
      formRequestKey.current = null; clearOriginalForm()
    }
    const terminal = settledSnapshot ? JSON.parse(settledSnapshot) as InboundCreateRecord : null
    if (terminal) {
      if (formRequestKey.current === terminal.requestKey) {
        if (terminal.phase === 'confirmed') clearOriginalForm()
        formRequestKey.current = null
      }
      terminalConsumer.current(terminal.requestKey)
      return
    }
    const original = pendingSnapshot ? JSON.parse(pendingSnapshot) as InboundCreateRecord : null
    if (!original || original.phase !== 'pending') return
    if (formRequestKey.current !== original.requestKey) {
      if (original.requestKey !== createInbound.submittedRequestKey && formDirty.current) return
      formRequestKey.current = original.requestKey
    }
    setSupplier({ id: original.body.supplierId, name: original.body.supplierName } as FinderResult)
    setRemark(original.body.remark ?? ''); setFreightType(original.body.freightType ?? null); setFreightAmount(String(original.body.freightAmount ?? ''))
    setSelectedMap(Object.fromEntries(original.displayRows.map(row => [row.item.purchaseItemId, row])))
  }, [pendingSnapshot, settledSnapshot, createInbound.contextIdentity, createInbound.submittedRequestKey])
  const blocked = createInbound.blocked || !can(PERMISSIONS.INBOUND_ORDER_CREATE)
  const selectedRows = useMemo(() => Object.values(selectedMap), [selectedMap])
  const warehouseId = selectedRows[0]?.item.warehouseId
  const rowIssues = selectedRows.map(({ item, qty }) => ({
    quantity: rejectedQuantities[item.purchaseItemId] ?? inboundDraftQuantityError(String(qty), item.remainingQty),
    warehouse: !warehouseId || item.warehouseId !== warehouseId ? '同一张收货单仅支持同仓到货' : null,
  }))
  const freight = validateInboundFreightAmount(freightAmount)
  const supplierError = !supplier ? '请先选择供应商' : null
  const remarkError = remark.length > 200 ? '备注最多200个字符，原输入已保留' : null
  const addError = !selectedRows.length ? '请至少填写一条收货数量' : null
  const showErrors = validationAttempted && !blocked
  const errorId = (field: string) => `${fieldPrefix}-${field}-error`
  const describedBy = (field: string, error: string | null) => showErrors && error ? errorId(field) : undefined

  const isDirty = !!(createInbound.pendingRecord || supplier || remark || selectedRows.length || freightType != null || freightAmount !== '')
  useDirtyGuard(tabPath, isDirty)

  function closeTab() {
    const { removeTab } = useWorkspaceStore.getState()
    removeTab(tabPath || '/inbound-tasks/new')
    navigate(getInboundListWorkspacePath())
  }

  function handleSupplierConfirm(result: FinderResult) {
    if (blocked) return
    setSupplier(result)
    if (supplier?.id !== result.id) {
      setSelectedMap({})
      setRejectedQuantities({})
    }
  }

  function handlePickerConfirm(rows: PickedPurchaseItem[]) {
    if (blocked) return
    const next: Record<number, PickedPurchaseItem> = {}
    for (const row of rows) next[row.item.purchaseItemId] = row
    setSelectedMap(next)
    setRejectedQuantities({})
    setPickerOpen(false)
  }

  function reportQuantityError(purchaseItemId: number, error: string | null) {
    if (blocked) return
    setRejectedQuantities(previous => previous[purchaseItemId] === (error ?? undefined)
      ? previous
      : { ...previous, [purchaseItemId]: error ?? undefined })
  }

  function setLineQty(purchaseItemId: number, remainingQty: number, raw: string) {
    if (blocked) return
    const entry = selectedMap[purchaseItemId]
    if (!entry) return
    const value = raw.trim()
    if (!value) {
      setSelectedMap(prev => {
        const next = { ...prev }
        delete next[purchaseItemId]
        return next
      })
      return
    }
    const qty = Number(value.replace(/,/g, ''))
    if (!Number.isFinite(qty) || qty < 0 || qty > remainingQty) {
      reportQuantityError(purchaseItemId, inboundDraftQuantityError(value, remainingQty))
      return
    }
    setSelectedMap(prev => ({ ...prev, [purchaseItemId]: { ...entry, qty } }))
  }

  function removeLine(purchaseItemId: number) {
    if (blocked) return
    reportQuantityError(purchaseItemId, null)
    setSelectedMap(prev => {
      const next = { ...prev }
      delete next[purchaseItemId]
      return next
    })
  }

  async function submit() {
    if (!active || blocked) return
    setValidationAttempted(true)
    const headerField = supplierError ? 'supplier' : remarkError ? 'remark' : freight.error ? 'freight' : addError ? 'add' : null
    if (headerField) {
      focusOrderEntryField(entryRef.current, headerField)
      return
    }

    const invalidIndex = rowIssues.findIndex(issue => issue.quantity || issue.warehouse)
    if (invalidIndex >= 0) {
      const field = rowIssues[invalidIndex].quantity ? 'quantity' : 'warehouse'
      focusRowRef.current?.(invalidIndex, `item-${selectedRows[invalidIndex].item.purchaseItemId}-${field}`)
      return
    }
    if (!supplier || !warehouseId) return
    confirmed(await createInbound.submit({ freightType, freightAmount: freight.amount, supplierId: supplier.id, supplierName: supplier.name,
      remark: remark.trim() || undefined, items: selectedRows.map(entry => ({ purchaseItemId: entry.item.purchaseItemId, qty: entry.qty })) }, warehouseId, selectedRows))
  }
  function confirmed(data: CreateInboundTaskResult | null) {
    if (!data) return
    toast.success(`收货订单 ${data.taskNo} 已创建`)
    const path = `/inbound-tasks/${data.taskId}`
    addTab({ key: path, title: data.taskNo, path }); closeTab(); navigate(path)
  }

  return (
    <div ref={entryRef} className="desktop-inbound-form desktop-entry-controls flex flex-col gap-4">
      <ActionBar
        title="新建收货订单"
        description="填写收货来源、仓库与商品明细。"
        rightActions={
          <>

            <Button variant="outline" onClick={() => confirmDirtyLeave({ dirtyKeys: [tabPath || '/inbound-tasks/new'], willNavigate: true, proceed: closeTab })}>取消新建</Button>
            {can(PERMISSIONS.INBOUND_ORDER_CREATE) && <Button onClick={() => { void submit() }} disabled={blocked} className="gap-1.5">
              {createInbound.busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  创建中…
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  创建收货订单
                </>
              )}
            </Button>}
          </>
        }
      />

      {createInbound.pendingRecord && <div role="status" className="space-y-2 rounded-md border border-border bg-muted/30 p-3 text-sm">
        <p>{createInbound.pendingRecord.phase === 'pending' ? '原创建结果待确认，原正文和请求键已保留。' : '原创建结果已确认，待清理本地记录。'}</p>
        <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={createInbound.busy || !can(PERMISSIONS.INBOUND_ORDER_VIEW)} onClick={async () => confirmed(await createInbound.queryOriginal())}>查询原创建结果</Button>
          {createInbound.canRetry && <Button variant="outline" size="sm" disabled={createInbound.busy || !can(PERMISSIONS.INBOUND_ORDER_CREATE)} onClick={async () => confirmed(await createInbound.retry())}>按原请求重试</Button>}</div>
      </div>}
      {createInbound.error && <p role="alert" className="text-sm text-destructive-ink">{createInbound.error}</p>}
      <SectionCard title="订单信息" compact>
        <div className="desktop-inbound-create-fields grid grid-cols-1 gap-4 md:grid-cols-2">
          <div data-entry-field="supplier" className="space-y-1.5">
            <label htmlFor={`${fieldPrefix}-supplier`} className="text-sm font-medium">供应商 <span className="text-destructive-ink">*</span></label>
            <PickerField id={`${fieldPrefix}-supplier`}
              className={cn(showErrors && supplierError && 'border-destructive/60 bg-destructive/5')}
              aria-invalid={!!describedBy('supplier', supplierError)} aria-describedby={describedBy('supplier', supplierError)}
              value={supplier?.name ?? ''}
              placeholder="点击选择供应商…"
              disabled={blocked} onOpen={() => { if (!blocked) setSupplierFinderOpen(true) }}
            />
            <OrderFieldError id={errorId('supplier')}>{showErrors && supplierError}</OrderFieldError>
          </div>
          <div data-entry-field="remark" className="space-y-1.5">
            <label htmlFor={`${fieldPrefix}-remark`} className="text-sm font-medium">备注</label>
            <Input id={`${fieldPrefix}-remark`} aria-invalid={!!describedBy('remark', remarkError)} aria-describedby={describedBy('remark', remarkError)} value={remark} disabled={blocked} onChange={e => { if (!blocked) setRemark(e.target.value) }} placeholder="选填" />
            <OrderFieldError id={errorId('remark')}>{showErrors && remarkError}</OrderFieldError>
          </div>
          <InboundFreightFields prefix={fieldPrefix} freightType={freightType} freightAmount={freightAmount} onTypeChange={setFreightType} onAmountChange={setFreightAmount} amountError={showErrors ? freight.error : null} disabled={blocked} />
        </div>
      </SectionCard>

      <SectionCard title="商品明细" compact actions={<div data-entry-field="add" className="flex flex-wrap items-center gap-2">
        <OrderFieldError id={errorId('add')}>{showErrors && supplier && addError}</OrderFieldError>
        <Button type="button" size="sm" variant="outline" aria-describedby={supplier ? describedBy('add', addError) : undefined}
          disabled={blocked || !supplier} onClick={() => { if (!blocked) setPickerOpen(true) }} className="gap-1.5"><ShoppingCart className="h-4 w-4" />选择商品</Button>
      </div>}>
          {selectedRows.length === 0 && (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {supplier ? '尚未选择商品，点击右上角「选择商品」挑选本次到货明细' : '请先选择供应商，再挑选本次到货商品'}
            </div>
          )}

          {selectedRows.length > 0 && (
            <>
              <div className="max-h-[60vh] overflow-auto" data-workspace-scroll>
                <InboundEntryTable data={selectedRows} getRowKey={entry => entry.item.purchaseItemId} focusRowRef={focusRowRef} renderRow={({ item, qty }, index) => {
                  const quantityField = `item-${item.purchaseItemId}-quantity`
                  const warehouseField = `item-${item.purchaseItemId}-warehouse`
                  const quantityError = !blocked ? rejectedQuantities[item.purchaseItemId] ?? (showErrors ? rowIssues[index].quantity : null) : null
                  const warehouseError = showErrors ? rowIssues[index].warehouse : null
                  return <tr key={item.purchaseItemId} className="border-b border-border/40">
                    <td><InboundProductIdentity item={item} /></td>
                    <td data-entry-field={quantityField}>
                      <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1">
                        <Input quantity inputMode="decimal" className="h-9 min-w-12 max-w-24 flex-1 text-right tabular-nums" placeholder="0" disabled={blocked}
                          value={String(qty)} data-purchase-item-id={item.purchaseItemId} aria-label={`${item.purchaseOrderNo} ${item.productName}本次到货数量`}
                          aria-invalid={!!quantityError} aria-describedby={quantityError ? errorId(quantityField) : undefined}
                          onQuantityError={error => reportQuantityError(item.purchaseItemId, error)}
                          onChange={event => setLineQty(item.purchaseItemId, item.remainingQty, event.target.value)} />
                        <span className="min-w-0 text-muted-body [overflow-wrap:anywhere]">{item.unit || '单位未提供'}</span>
                      </div>
                      <OrderFieldError id={errorId(quantityField)} className="mt-1">{quantityError}</OrderFieldError>
                    </td>
                    <td className="font-mono text-xs">{item.purchaseOrderNo}</td>
                    <td className="text-muted-foreground">{item.warehouseName}<OrderFieldError id={errorId(warehouseField)} className="mt-1">{warehouseError}</OrderFieldError></td>
                    <td className="text-right tabular-nums">{unitPrice(item.unitPrice)}</td>
                    <td className="text-center"><Button type="button" variant="ghost" size="sm" data-entry-field={warehouseField}
                      aria-describedby={warehouseError ? errorId(warehouseField) : undefined} className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive-ink"
                      disabled={blocked} aria-label={`删除 ${item.purchaseOrderNo} ${item.productName}`} onClick={() => removeLine(item.purchaseItemId)}>✕</Button></td>
                  </tr>
                }} />
              </div>
              <div className="desktop-order-total border-t border-border px-3 py-2 text-sm text-muted-body">商品明细：{selectedRows.length} 行</div>
            </>
          )}
      </SectionCard>

      <SupplierFinder
        compact
        context="purchase"
        open={supplierFinderOpen && !blocked}
        onClose={() => setSupplierFinderOpen(false)}
        onConfirm={handleSupplierConfirm}
      />

      <PurchaseItemPickerDialog
        open={pickerOpen && !blocked} canInteract={() => !blocked}
        supplierId={supplier?.id ?? null}
        initialSelection={selectedMap}
        onClose={() => setPickerOpen(false)}
        onConfirm={handlePickerConfirm}
      />
    </div>
  )
}
