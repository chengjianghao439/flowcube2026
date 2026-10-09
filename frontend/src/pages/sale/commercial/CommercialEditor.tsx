import { SaleEntryTable } from '../form/components/SaleEntryTable'
import { Plus, Save, Trash2 } from 'lucide-react'
import { commercialWarehouseName } from './warehouseName'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { MAX_WORKSPACE_TABS, useWorkspaceStore } from '@/store/workspaceStore'
import type { SaleOrder } from '@/types/sale'
import type { CommercialBody, CommercialComponent, CommercialWriteConfirmation } from '@/types/sale-commercial'
import { getProductApi } from '@/api/products'
import { commercialReadConfig } from '@/api/sale-commercial'
import type { KitReadOwner } from '@/api/kits'
import { assertKitReadOwner, useKitBackup } from '@/hooks/useKits'
import { useCommercialPreview, useCommercialWrite, readCommercialSaleOwned } from '@/hooks/useCommercialSale'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { usePermission } from '@/hooks/usePermission'
import { useProductQtyPolicies } from '@/hooks/useProductQtyPolicies'
import { captureHandlingOwner } from '@/lib/disposalHandlingRecovery'
import { PERMISSIONS } from '@/lib/permission-codes'
import { CustomerFinder } from '@/components/finder'
import { SaleOrderHeaderFields } from '../form/components/SaleOrderHeaderFields'
import { useSaleOrderForm } from '../form/useSaleOrderForm'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { ActionBar } from '@/components/shared/ActionBar'
import { SectionCard } from '@/components/shared/SectionCard'
import { VirtualTableBody, VIRTUAL_TABLE_THRESHOLD } from '@/components/shared/VirtualTableBody'
import { summarizeSaleQuantities } from '@/lib/salePresentation'
import { money } from '@/lib/format'
import { toast } from '@/lib/toast'
import CommercialPicker from './CommercialPicker'
import { commercialUnit, draftFromOrder, toCommercialInputs, type CommercialDraftRow } from './commercialDraft'
import { buildWorkspaceTabRegistrationFromPath } from '@/router/workspaceRouteMeta'
import { ReorderSourcePanel } from '../ReorderSourcePanel'
import { RepeatCreateRecoveryPanel } from '../RepeatCreateRecoveryPanel'
import { commercialReorderDrafts } from '../reorderDraft'
import type { useSaleReorderSource } from '@/hooks/useSaleReorderSource'
import type { RepeatSaleCreate } from '@/hooks/useRepeatSaleCreate'
import { mayCreateReorder, mayReorder } from '@/lib/saleReorder'
import { handleEntryKeyDown } from '@/lib/orderEntryNavigation'
import { UnsavedBadge } from '@/components/shared/EditModeBadge'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import { buildNewSalePayload } from './newSalePayload'
import { saleEntryEpoch, subscribeSaleEntry } from '@/lib/saleEntryOwner'
import type { EntryIssue } from '@/lib/orderEntry'
import { SectionVisibilityContext } from '@/components/layout/SectionVisibilityContext'
import { CommercialItemIdentity } from './CommercialItemIdentity'
import { componentDisplayQuantity, SALE_KIT_TABLE_CLASSES } from './commercialPresentation'

type DisplayRow = { row: CommercialDraftRow; key: string; component?: CommercialComponent }
export default function CommercialEditor({
  order,
  owner,
  tabPath,
  adjust = false,
  ordinaryOnlySave = false,
  onDone,
  onReload,
  reorder
}: {
  order?: SaleOrder
  owner: KitReadOwner
  tabPath: string
  adjust?: boolean
  ordinaryOnlySave?: boolean
  onDone: (id?: number) => void
  onReload?: (order: SaleOrder) => void
  reorder?: { source: ReturnType<typeof useSaleReorderSource>; write: RepeatSaleCreate }
}) {
  const navigate = useNavigate()
  // Header reuse without entering the legacy physical item initialization/pricing path.
  const headerOrder = useMemo(() => (order ? { ...order, items: [] } : undefined), [order])
  const h = useSaleOrderForm('', headerOrder, owner, reorder?.source.isActiveCurrent)
  const entryRef = useRef<HTMLDivElement>(null)
  const entryTableRef = useRef<HTMLDivElement>(null)
  const scrollToEntryIndex = useRef<((index: number) => void) | null>(null)
  const pendingFocus = useRef<string | null>(null)
  const registerEntryScroll = useCallback((scroll: ((index: number) => void) | null) => { scrollToEntryIndex.current = scroll }, [])
  const compositionCache = useRef(new Map<string, { versionId: number; components: CommercialComponent[] }>())
  const [imported, setImported] = useState(false)
  const [validationAttempted, setValidationAttempted] = useState(false)
  const [rows, setRows] = useState<CommercialDraftRow[]>(() => draftFromOrder(order)),
    [picker, setPicker] = useState<'kit' | 'ordinary' | null>(null),
    [error, setError] = useState(''),
    [reloading, setReloading] = useState(false),
    [discardOpen, setDiscardOpen] = useState(false)
  const epoch = useSyncExternalStore(subscribeSaleEntry, saleEntryEpoch)
  const [openingEpoch] = useState(saleEntryEpoch)
  const sourceCurrent = () => !ordinaryOnlySave || openingEpoch === saleEntryEpoch()
  const [savedConfirmation, setSavedConfirmation] = useState<CommercialWriteConfirmation | null>(null)
  const write = useCommercialWrite(owner, `commercial-editor:${buildWorkspaceTabRegistrationFromPath(tabPath).key}`, sourceCurrent),
    { can } = usePermission()
  const active = useActiveWorkspaceTab(), activeRef = useRef(active)
  activeRef.current = active
  const activity = useRef({ active, generation: 0 })
  if (activity.current.active !== active) activity.current = { active, generation: activity.current.generation + 1 }
  let ownerCurrent = true
  try {
    assertKitReadOwner(owner)
  } catch {
    ownerCurrent = false
  }
  const locked = write.blocked || !!savedConfirmation || reloading || !ownerCurrent || !sourceCurrent() || (!!reorder && (reorder.write.blocked || !reorder.source.current || !reorder.source.active))
  const interaction = useRef({ locked, warehouseId: h.warehouseId })
  interaction.current = { locked, warehouseId: h.warehouseId }
  const renderGeneration = activity.current.generation
  const mayInteract = () => activeRef.current && sourceCurrent() && !interaction.current.locked
  function importSource(include: boolean) {
    const data = reorder?.source.data
    if (locked || imported || rows.length || !data?.customer || data.customerError || data.items.some(i => i.error)) return
    const fresh = commercialReorderDrafts(data, include)
    if (h.initializeIdentities(data.customer, [])) { setRows(fresh); setImported(true) }
    else toast.warning('当前新单已有输入，未覆盖；请保留输入后重新打开独立来源草稿')
  }
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  // A guard covers the entire commercial draft, including original operation identity on unknown results.
  const snapshot = JSON.stringify({
    owner,
    baseline: order,
    customerId: h.customerId,
    warehouseId: h.warehouseId,
    remark: h.remark,
    carrierId: h.carrierId,
    shippingProduct: h.shippingProduct,
    freightType: h.freightType,
    receiverName: h.receiverName,
    receiverPhone: h.receiverPhone,
    receiverAddress: h.receiverAddress,
    discountAmount: h.discountAmount,
    rows: rows.map(({ units: _units, allowDecimalQty: _policy, ...row }) => row)
  })
  const original = useRef(snapshot),
    current = useRef(snapshot)
  current.current = snapshot
  useDirtyGuard(tabPath, snapshot !== original.current || !!write.pending || write.busy || !!reorder?.write.pending)
  const backup = useKitBackup(snapshot, owner)
  const readable = active && !locked && can(PERMISSIONS.PRODUCT_VIEW)
  const readCurrent = () => activeRef.current && sourceCurrent() && !write.blocked && (!reorder || (reorder.source.isActiveCurrent() && !reorder.write.blocked))
  const [quantityOwner] = useState(captureHandlingOwner)
  const allowsDecimal = useProductQtyPolicies(rows.flatMap(row => order && row.input.kind === 'ordinary' && row.allowDecimalQty === undefined ? [row.input.productId] : []), {
    owner: quantityOwner,
    isCurrent: () => {
      try { assertKitReadOwner(owner) } catch { return false }
      return readable && readCurrent() && activity.current.generation === renderGeneration
    }
  })
  const entryRows = rows.map(row => row.input.kind === 'ordinary' && row.allowDecimalQty === undefined
    ? { ...row, allowDecimalQty: allowsDecimal(row.input.productId) } : row)
  const bodyResult = useMemo((): { body: CommercialBody | null; error?: string } => {
    try {
      if (!h.customerId || !h.warehouseId) return { body: null, error: '请选择客户和出库仓库' }
      if (h.receiverPhone && !/^[0-9+()\-\s]{3,30}$/.test(h.receiverPhone)) throw new Error('联系电话格式不正确')
      const discountAmount = Number(h.discountAmount || 0)
      if (!Number.isFinite(discountAmount) || discountAmount < 0) throw new Error('折扣金额须为非负数')
      const commercialGroups = toCommercialInputs(entryRows).map((g) => (order ? g : { ...g, warehouseId: +h.warehouseId }))
      return {
        body: {
          commercialModel: 'kit-v1',
          ...(order ? { expectedRevision: order.commercialRevision ?? 0, ...(order.editFingerprint ? { expectedEditFingerprint: order.editFingerprint } : {}) } : {}),
          customerId: +h.customerId,
          customerName: h.customerName,
          warehouseId: +h.warehouseId,
          warehouseName: h.warehouseName,
          discountAmount,
          commercialGroups,
          remark: h.remark || undefined,
          carrierId: h.carrierId ? +h.carrierId : null,
          shippingProduct: h.shippingProduct || null,
          freightType: h.freightType ? +h.freightType : null,
          receiverName: h.receiverName || undefined,
          receiverPhone: h.receiverPhone || undefined,
          receiverAddress: h.receiverAddress || undefined
        }
      }
    } catch (e) {
      return { body: null, error: e instanceof Error ? e.message : '请核对输入' }
    }
  }, [
    h.customerId,
    h.customerName,
    h.warehouseId,
    h.warehouseName,
    h.discountAmount,
    h.remark,
    h.carrierId,
    h.shippingProduct,
    h.freightType,
    h.receiverName,
    h.receiverPhone,
    h.receiverAddress,
    order,
    entryRows
  ])
  const entryIssues: EntryIssue[] = []
  if (!h.customerId || !h.customerName) entryIssues.push({ target: 'party', message: '请选择客户' })
  if (!h.warehouseId || !h.warehouseName) entryIssues.push({ target: 'warehouse', message: '请选择仓库' })
  if (!rows.length) entryIssues.push({ target: 'add', message: '请添加至少一条商品明细' })
  const preview = useCommercialPreview(readable ? bodyResult.body : null, owner, order?.id, readCurrent)
  const heldPreview = useRef<{ signature: string; data: typeof preview.data } | null>(null)
  const bodySignature = JSON.stringify(bodyResult.body)
  if (preview.data) heldPreview.current = { signature: bodySignature, data: preview.data }
  const shownPreview = preview.data ?? (locked && heldPreview.current?.signature === bodySignature ? heldPreview.current.data : undefined)
  const resolvedByKey = useMemo(() => new Map(shownPreview?.commercialGroups.map(group => [group.lineKey, group])), [shownPreview])
  // 缓存仅保存本草稿选定版本的展示组成；量价和保存仍由原成交组与服务端预览决定。
  for (const row of rows) {
    if (row.input.kind !== 'kit') continue
    const resolved = resolvedByKey.get(row.input.lineKey)
    if (resolved) compositionCache.current.set(row.input.lineKey, { versionId: row.input.kitVersionId, components: resolved.components })
  }
  const currentLineKeys = new Set(rows.map(row => row.input.lineKey))
  for (const key of compositionCache.current.keys()) if (!currentLineKeys.has(key)) compositionCache.current.delete(key)
  const displayRows: DisplayRow[] = rows.flatMap(row => {
    const cached = compositionCache.current.get(row.input.lineKey)
    const components = row.input.kind === 'kit'
      ? resolvedByKey.get(row.input.lineKey)?.components ?? (cached?.versionId === row.input.kitVersionId ? cached.components : undefined) ?? row.saved?.components ?? row.components ?? []
      : []
    return [{ row, key: row.input.lineKey }, ...components.map((component, index) => ({ row, component, key: `${row.input.lineKey}-component-${index}` }))]
  })
  const parentIndexes = new Map(displayRows.flatMap((item, index) => item.component ? [] : [[item.row.input.lineKey, index] as const]))
  function focusEntryField(field: string) {
    const row = rows.find(item => field === `item-${item.input.lineKey}-quantity` || field === `item-${item.input.lineKey}-price`)
    const index = row && parentIndexes.get(row.input.lineKey)
    // 滚动观察者可能同步挂载目标行；必须先登记焦点，再请求滚动。
    pendingFocus.current = index !== undefined ? field : null
    if (index !== undefined) scrollToEntryIndex.current?.(index)
    const wrapper = [...(entryRef.current?.querySelectorAll<HTMLElement>('[data-entry-field]') ?? [])].find(element => element.dataset.entryField === field)
    const control = wrapper?.matches('input,button,select,textarea') ? wrapper : wrapper?.querySelector<HTMLElement>('input,button,select,textarea')
    if (control) { pendingFocus.current = null; control.focus({ preventScroll: !!scrollToEntryIndex.current }); if (control instanceof HTMLInputElement) control.select() }
  }
  function consumePendingFocus(field: string, input: HTMLInputElement | null) {
    if (input && pendingFocus.current === field) { pendingFocus.current = null; input.focus({ preventScroll: true }); input.select() }
  }
  function navigateEntry(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.ctrlKey || event.altKey || event.metaKey) return
    const input = event.target, table = entryTableRef.current
    if (!(input instanceof HTMLInputElement) || !input.hasAttribute('data-entry-input') || !table) { handleEntryKeyDown(event); return }
    const outside = [...(entryRef.current?.querySelectorAll<HTMLInputElement>('input[data-entry-input]:not(:disabled)') ?? [])].filter(element => !table.contains(element) && !element.closest('[hidden]'))
    const before = outside.filter(element => element.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING)
    const after = outside.filter(element => !before.includes(element))
    const fields: (HTMLInputElement | string)[] = [...before, ...rows.flatMap(row => [
      ...(row.packagingExpressible ? [`item-${row.input.lineKey}-quantity`] : []), `item-${row.input.lineKey}-price`,
    ]), ...after]
    const current = table.contains(input) ? input.closest<HTMLElement>('[data-entry-field]')?.dataset.entryField : input
    const index = fields.findIndex(field => field === current)
    if (index < 0) { handleEntryKeyDown(event); return }
    const target = fields[index + (event.shiftKey ? -1 : 1)]
    if (!target) { handleEntryKeyDown(event); return }
    event.preventDefault()
    if (typeof target === 'string') focusEntryField(target)
    else { target.focus(); target.select() }
  }
  if (preview.data && Number(h.discountAmount || 0) > preview.data.amount) entryIssues.push({ target: 'discount', message: '折扣金额不能超过商品金额' })
  const rowIssues = useMemo(() => entryRows.flatMap(row => {
    if (!row.packagingExpressible) return []
    try { toCommercialInputs([row]); return [] }
    catch (caught) {
      const message = caught instanceof Error ? caught.message : '请核对本行输入'
      return [{ lineKey: row.input.lineKey, target: message.startsWith('成交价') ? 'price' : 'quantity', message }]
    }
  }), [entryRows])
  const showFieldErrors = !!order || validationAttempted
  const visibleIssues = showFieldErrors ? entryIssues : []
  const priceRequired = preview.data?.commercialGroups.some((g) => !(g.unitPrice > 0))
  const valid =
    !!preview.data &&
    !preview.loading &&
    !preview.error &&
    !priceRequired &&
    Number(h.discountAmount || 0) <= preview.data.amount
  function update(key: string, patch: Partial<CommercialDraftRow>) {
    if (!locked) setRows((old) => old.map((r) => (r.input.lineKey === key ? { ...r, ...patch } : r)))
  }
  function applySaved(answer: CommercialWriteConfirmation | null, generation: number) {
    if (!answer || !write.canApplyConfirmation(answer) || !sourceCurrent()) return
    if (activeRef.current && activity.current.generation === generation) onDone(answer.result?.id)
    else setSavedConfirmation(answer)
  }
  async function recover(retry: boolean) {
    const generation = activity.current.generation
    const answer = await (retry ? write.retry() : write.queryOriginal())
    if (answer?.queryOnly && write.canViewConfirmation(answer)) setSavedConfirmation(answer)
    else applySaved(answer, generation)
  }
  function viewSaved() {
    const answer = savedConfirmation, id = answer?.result?.id ?? answer?.plan.operation.id
    if (!answer || !Number.isSafeInteger(id) || !id || id < 1 || !activeRef.current || !sourceCurrent() ||
      !can(PERMISSIONS.SALE_ORDER_VIEW) || !write.canViewConfirmation(answer)) return
    // Existing editors own a local edit state; navigating to the same URL cannot leave it.
    if (order && id === order.id) { onDone(id); return }
    const registration = buildWorkspaceTabRegistrationFromPath(`/sale/${id}`)
    const workspace = useWorkspaceStore.getState()
    if (!workspace.tabs.some(tab => tab.key === registration.key) && workspace.tabs.length >= MAX_WORKSPACE_TABS) {
      toast.warning('工作区标签已满，请先关闭不需要的页面'); return
    }
    // Keep the new-order tab and its draft; viewing a receipt does not apply its old payload.
    if (workspace.addTab({ ...registration, title: answer.result?.orderNo || `销售单 #${id}` })) navigate(registration.path)
  }
  async function save() {
    const generation = activity.current.generation
    if (!mayInteract() || (reorder && !imported)) return
    setValidationAttempted(true)
    setError('')
    const focusField = focusEntryField
    if (entryIssues.length) { focusField(entryIssues[0].target); return }
    if (bodyResult.error === '联系电话格式不正确' || bodyResult.error === '折扣金额须为非负数') {
      focusField(bodyResult.error === '联系电话格式不正确' ? 'phone' : 'discount'); return
    }
    if (rowIssues.length) { focusField(`item-${rowIssues[0].lineKey}-${rowIssues[0].target}`); return }
    if (!valid || !bodyResult.body || !preview.data) {
      setError(bodyResult.error || preview.error || (priceRequired ? '请填写大于零的成交单价' : '请等待系统完成报价核对'))
      return
    }
    try {
      assertKitReadOwner(owner)
      const body = ordinaryOnlySave && (!order || order.commercialModel !== 'kit-v1') ? buildNewSalePayload(bodyResult.body, preview.data) : bodyResult.body
      if (reorder) {
        const answer = await reorder.write.submit(body)
        if (answer && activity.current.generation === generation && reorder.write.canApply(answer) && reorder.source.isActiveCurrent()) onDone(answer.id)
        return
      }
      const answer = await write.submit(order
        ? { action: adjust ? 'adjust' : 'update', id: order.id, body }
        : { action: 'create', body })
      if (answer && write.canApplyConfirmation(answer) && sourceCurrent()) {
        toast.success(
          answer.result?.pending ? '改单已提交，等待仓库确认；预占与派发以原单最新事实为准' : '销售单已保存'
        )
        applySaved(answer, generation)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    }
  }
  async function reload() {
    if (!order || !backup.canReload() || locked) return
    const before = current.current
    setReloading(true)
    try {
      const latest = await readCommercialSaleOwned(order.id, owner)
      if (!mounted.current || current.current !== before || !backup.canReload()) return
      assertKitReadOwner(owner)
      backup.invalidate()
      onReload?.(latest)
    } catch (e) {
      setError(e instanceof Error ? e.message : '重读失败，当前草稿保留')
    } finally {
      setReloading(false)
    }
  }
  const unitReads = useRef(new Map<string, AbortController>())
  useEffect(() => {
    const reads = unitReads.current
    return () => { reads.forEach(controller => controller.abort()); reads.clear() }
  }, [])
  async function loadUnits(row: CommercialDraftRow) {
    if (row.input.kind !== 'ordinary' || row.units.length || !mayInteract() || unitReads.current.has(row.input.lineKey)) return
    const productId = row.input.productId
    const controller = new AbortController(), generation = activity.current.generation
    unitReads.current.set(row.input.lineKey, controller)
    try {
      assertKitReadOwner(owner)
      const product = await getProductApi(row.input.productId, { ...commercialReadConfig(owner), signal: controller.signal })
      assertKitReadOwner(owner)
      if (!mounted.current || controller.signal.aborted || !mayInteract() || generation !== activity.current.generation) return
      setRows(old => old.map(currentRow => currentRow.input.lineKey === row.input.lineKey && currentRow.input.kind === 'ordinary' && currentRow.input.productId === productId
        ? { ...currentRow, units: product?.units ?? [], allowDecimalQty: product?.allowDecimalQty } : currentRow))
    } catch {
      if (!controller.signal.aborted && mayInteract()) toast.error('商品单位读取失败，请重试；当前输入保留')
    } finally { unitReads.current.delete(row.input.lineKey) }
  }
  function renderEntryRow(item: DisplayRow) {
    const { row, component } = item
    const resolved = resolvedByKey.get(row.input.lineKey)
    if (component) return <tr key={item.key} className="border-t">
      <td><CommercialItemIdentity code={component.productCode} name={component.productName} {...component} kitLine="component" groupKey={row.input.lineKey} /></td>
      <td className="text-right tabular-nums">{componentDisplayQuantity(component.baseQty, row.quantity) ?? '—'}</td>
      <td>{component.unit}</td><td className="text-right">—</td><td className="text-right">—</td><td>—</td><td />
    </tr>
    const quantityError = showFieldErrors ? rowIssues.find(issue => issue.lineKey === row.input.lineKey && issue.target === 'quantity')?.message : undefined
    const priceError = showFieldErrors ? rowIssues.find(issue => issue.lineKey === row.input.lineKey && issue.target === 'price')?.message : undefined
    const integerQuantity =
      row.input.kind === 'kit' || (row.input.kind === 'ordinary' && (row.allowDecimalQty ?? allowsDecimal(row.input.productId)) === false && row.unit === row.baseUnit)
    const unitOptions = [...new Set([row.unit, ...(row.baseUnit ? [row.baseUnit] : []), ...row.units.map(unit => unit.unitName)])]
    return (
      <tr key={row.input.lineKey} className="border-t hover:bg-muted/20">
        <td className="p-3">
          <CommercialItemIdentity {...row} kitLine={row.input.kind === 'kit' ? 'parent' : undefined} groupKey={row.input.lineKey} />
          {row.input.kind === 'kit' && row.input.warehouseId !== Number(h.warehouseId) && <p className="text-xs text-muted-foreground">{order && row.input.warehouseId ? commercialWarehouseName(order, row.input.warehouseId) : h.warehouseName || '待选仓库'}</p>}
          {resolved?.metadata.entry && row.unit !== row.baseUnit && <p className="text-xs text-muted-foreground">折合 {resolved.quantity}{row.baseUnit || resolved.components[0]?.unit}</p>}
          {row.costPrice != null && resolved && (row.input.kind === 'kit' ? resolved.unitPrice : (resolved.metadata.entry?.entryUnitPrice ?? resolved.unitPrice) / (resolved.metadata.entry?.conversionRate ?? 1)) < row.costPrice && <p className="text-xs text-destructive">成交价低于进价，请核对</p>}
          {!row.packagingExpressible && (
            <p className="text-destructive-ink">
              当前 {row.saved?.targetQty ?? row.quantity}
              {row.saved?.components[0]?.unit ?? row.baseUnit}{' '}
              无法按原包装精度表达；不能按原包装填写，保留原包装成交依据。
            </p>
          )}
        </td>
        <td data-entry-field={`item-${row.input.lineKey}-quantity`} className="p-2">
          <Input
            data-entry-input
            ref={input => consumePendingFocus(`item-${row.input.lineKey}-quantity`, input)}
            aria-invalid={!!quantityError}
            quantity
            aria-label={`${row.name}数量`}
            type="number"
            step={integerQuantity ? 1 : 0.01}
            min={integerQuantity ? 1 : 0.01}
            value={row.quantity}
            disabled={!row.packagingExpressible}
            onChange={(e) => update(row.input.lineKey, { quantity: e.target.value })}
            className="h-9 w-full text-right tabular-nums"
          />
          {quantityError && <p role="alert" className="mt-1 text-xs text-destructive-ink">{quantityError}</p>}
        </td>
        <td className="p-2">
          {row.input.kind === 'ordinary' ? (
            <select
              aria-label={`${row.name}录入单位`}
              onFocus={() => void loadUnits(row)}
              onPointerDown={() => void loadUnits(row)}
              value={row.unit}
              className={`h-9 w-full rounded-md border border-input bg-background px-2 ${unitOptions.length === 1 ? 'appearance-none' : ''}`}
              onChange={(e) =>
                update(row.input.lineKey, {
                  unit: e.target.value,
                  input: { ...row.input, entryUnit: e.target.value } as CommercialDraftRow['input']
                })
              }
            >
              {unitOptions.map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
          ) : (
            row.input.kind === 'kit' && resolved ? commercialUnit(resolved) : row.unit
          )}
        </td>
        <td data-entry-field={`item-${row.input.lineKey}-price`} className="p-2">
          <Input
            data-entry-input
            aria-invalid={!!priceError}
            ref={input => consumePendingFocus(`item-${row.input.lineKey}-price`, input)}
            aria-label={`${row.name}成交单价`}
            type="number"
            step="0.0001"
            min="0.0001"
            value={
              row.input.priceSource === 'manual'
                ? row.price
                : resolved
                  ? String(
                      row.input.kind === 'kit'
                        ? resolved.unitPrice
                        : (resolved.metadata.entry?.entryUnitPrice ?? resolved.unitPrice)
                    )
                  : row.price
            }
            onChange={(e) =>
              update(row.input.lineKey, {
                price: e.target.value,
                input: { ...row.input, priceSource: 'manual' }
              })
            }
            className="h-9 w-full text-right tabular-nums"
          />
          {priceError && <p role="alert" className="mt-1 text-xs text-destructive-ink">{priceError}</p>}
        </td>
        <td className="p-2 text-right tabular-nums">{resolved ? money(resolved.amount) : '待预览'}</td>
        <td className="p-2">
          <Input aria-label={`${row.name}备注`} maxLength={200} value={row.input.remark ?? ''} placeholder="选填"
            onChange={event => update(row.input.lineKey, { input: { ...row.input, remark: event.target.value } })}
            className="h-9 w-full text-sm" />
        </td>
        <td className="p-2">
          <Button
            variant="ghost"
            size="sm"
            aria-label="删除商品行"
            className="h-8 w-9 p-0 text-muted-foreground hover:text-destructive-ink"
            onClick={() => setRows((old) => old.filter((r) => r.input.lineKey !== row.input.lineKey))}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </td>
      </tr>
    )
  }
  const entryWarehouseId = adjust ? (order?.items?.find(item => item.quantity > 0)?.warehouseId ?? Number(h.warehouseId)) : Number(h.warehouseId)
  interaction.current.warehouseId = String(entryWarehouseId)
  const permission = order ? PERMISSIONS.SALE_ORDER_UPDATE : PERMISSIONS.SALE_ORDER_CREATE
  return (
    <div ref={entryRef} data-order-entry onKeyDown={navigateEntry} className="flex flex-col gap-2.5">
      <ActionBar
        title={order ? `${order.orderNo} · ${adjust ? '修改订单' : '编辑'}` : '新建销售单'}
        subtitle={<UnsavedBadge show={snapshot !== original.current} />}
        rightActions={
          <>
            <Button
              variant="outline"
              disabled={locked}
              onClick={() => {
                if (snapshot !== original.current) setDiscardOpen(true)
                else onDone()
              }}
            >
              {order ? (adjust ? '取消' : '取消编辑') : '取消'}
            </Button>
            {can(permission) && (
              <Button disabled={locked || (!ordinaryOnlySave && !valid) || preview.loading || (!!reorder && !imported)} onClick={() => void save()}>
                <Save className="mr-1.5 h-4 w-4" />{order ? (adjust ? '提交改单' : '保存修改') : '保存草稿'}
              </Button>
            )}
          </>
        }
      />
      {reorder && <><ReorderSourcePanel data={reorder.source.data} error={reorder.source.error} loading={reorder.source.loading} imported={imported} disabled={locked} onImport={importSource} onReload={reorder.source.reload} /><RepeatCreateRecoveryPanel write={reorder.write} active={reorder.source.active} onConfirmed={a => { if (activity.current.generation === renderGeneration && reorder.source.isActiveCurrent()) onDone(a.id) }} /></>}
      {(error || write.error || (bodyResult.body && preview.error) || ((!!order || validationAttempted) && !visibleIssues.length && !rowIssues.length && bodyResult.error && bodyResult.error !== '联系电话格式不正确' && bodyResult.error !== '折扣金额须为非负数') || backup.error) && (
        <p role="alert" className="text-sm text-destructive-ink">
          {error || write.error || (bodyResult.body && preview.error) || bodyResult.error || backup.error}
        </p>
      )}
      {!sourceCurrent() && <p role="alert">账号、权限或服务器已变化，原草稿保留；请核对后重新打开新单。</p>}
      {savedConfirmation && <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm">
        <p><strong>{savedConfirmation.result?.orderNo || order?.orderNo || `订单 #${savedConfirmation.result?.id ?? savedConfirmation.plan.operation.id}`}</strong> {savedConfirmation.result?.pending ? '改单已提交，等待仓库确认，当前草稿保留。' : '已确认保存，当前草稿保留。'}</p>
        <Button variant="outline" disabled={!active || !ownerCurrent || !sourceCurrent() || !can(PERMISSIONS.SALE_ORDER_VIEW) || !write.canViewConfirmation(savedConfirmation)} onClick={viewSaved}>查看已保存销售单</Button>
      </div>}
      {write.pending && (
        <div className="space-y-2 rounded-md border p-3">
          <p>原请求结果待确认，离开或刷新不会自动重新提交。刷新后仅保留查询身份，不保存表单内容。</p>
          <Button disabled={write.busy} onClick={() => void recover(false)}>查询原操作结果</Button>
          <Button
            disabled={write.busy || !write.canRetry}
            onClick={() => void recover(true)}
          >
            按原请求重试
          </Button>
        </div>
      )}
      {write.conflict && !write.pending && (
        <div className="space-y-2">
          <p>订单或套版本已变化。草稿未覆盖；先复制，再显式重读核对，不能自动合并。</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void backup.copy(snapshot)}>
              复制草稿内容
            </Button>
            {order && (
              <Button variant="outline" disabled={!backup.copied || locked} onClick={() => void reload()}>
                重读最新订单
              </Button>
            )}
          </div>
          {backup.text && (
            <>
              <textarea
                aria-label="完整草稿备份"
                readOnly
                value={backup.text}
                className="w-full rounded border p-2 text-xs"
              />
              <Button variant="outline" onClick={() => backup.acknowledge(backup.text)}>
                已备份草稿
              </Button>
            </>
          )}
        </div>
      )}
      <fieldset disabled={locked} className="min-w-0 space-y-3">
        <SaleOrderHeaderFields
          compact
          phoneError={showFieldErrors && bodyResult.error === '联系电话格式不正确' ? bodyResult.error : undefined}
          readOwner={owner}
          interactionGuard={{ epoch, isCurrent: () => mayInteract() && (!reorder || (reorder.source.isActiveCurrent() && mayCreateReorder() && mayReorder(PERMISSIONS.CUSTOMER_VIEW))) }}
          {...h}
          customerError={visibleIssues.some(issue => issue.target === 'party')}
          warehouseError={visibleIssues.some(issue => issue.target === 'warehouse')}
          headerReadOnly={adjust || locked}
          shippingProductDisabled={adjust || locked}
        />
        <SectionCard title="商品明细" compact noPadding actions={
          <div data-entry-field="add" className="flex flex-wrap items-center gap-2">
            {visibleIssues.some(issue => issue.target === 'add') && <p role="alert" className="text-xs text-destructive-ink">请添加至少一条商品明细</p>}
            <Button
              data-entry-add
              size="sm"
              className="gap-1.5"
              variant="outline"
              disabled={(!ordinaryOnlySave && !h.warehouseId) || !can(PERMISSIONS.PRODUCT_VIEW)}
              onClick={() => { if (!h.warehouseId) { setValidationAttempted(true); return }; setPicker('ordinary') }}
            >
              <Plus className="h-4 w-4" />添加商品
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              variant="outline"
              disabled={!h.warehouseId || !can(PERMISSIONS.PRODUCT_VIEW)}
              onClick={() => setPicker('kit')}
            >
              <Plus className="h-4 w-4" />添加套装
            </Button>
          </div>
        }>
          {!rows.length ? <div className="flex min-h-32 flex-col items-center justify-center gap-2 px-4 py-6 text-sm">
            <p className="text-muted-foreground">尚未添加商品</p>
          </div> : <div ref={entryTableRef} data-sale-entry-items data-workspace-scroll tabIndex={0} aria-label="销售录入明细" className={`max-h-[min(60vh,36rem)] overflow-auto ${SALE_KIT_TABLE_CLASSES}`}>

            <SaleEntryTable stickyHeader rowCount={displayRows.length + 1}>
              {displayRows.length >= VIRTUAL_TABLE_THRESHOLD
                ? <VirtualTableBody data={displayRows} columns={7} getRowKey={item => item.key} renderRow={renderEntryRow} onScrollToIndexReady={registerEntryScroll} />
                : <tbody>{displayRows.map(renderEntryRow)}</tbody>}
            </SaleEntryTable>
          </div>}
        </SectionCard>
        <SectionCard compact contentClassName="px-4 py-3"><div role="group" aria-label="金额汇总" className="flex flex-wrap items-start gap-x-6 gap-y-3 text-sm">
          <div className="flex min-h-9 flex-wrap items-center gap-x-6 gap-y-2">
            <p className="flex items-baseline gap-2"><span className="text-muted-foreground">明细</span><span className="tabular-nums">{rows.length} 行</span></p>
            <p className="flex items-baseline gap-2"><span className="text-muted-foreground">基本数量</span><span className="tabular-nums">{shownPreview ? summarizeSaleQuantities(shownPreview.physicalItems).map(q => `${q.ordered} ${q.unit}`).join(' / ') || '—' : '—'}</span></p>
          </div>
          <div className="ml-auto flex flex-wrap items-start justify-end gap-x-6 gap-y-2">
            <div data-entry-field="discount">
              <label className="flex items-center gap-2"><span className="text-muted-foreground">折扣金额</span><Input
                aria-label="折扣金额" data-entry-input type="number" min="0" step="0.01" value={h.discountAmount}
                onChange={(e) => h.setDiscountAmount(e.target.value)} className="h-9 w-28 text-right tabular-nums"
              /></label>
              {visibleIssues.some(issue => issue.target === 'discount') && <p role="alert" className="mt-1 text-xs text-destructive-ink">折扣金额不能超过商品金额</p>}
              {showFieldErrors && bodyResult.error === '折扣金额须为非负数' && <p role="alert" className="mt-1 text-xs text-destructive-ink">{bodyResult.error}</p>}
            </div>
            <p className="flex items-baseline gap-3 pt-1.5"><span className="font-medium">订单金额</span><strong className="text-lg tabular-nums">{shownPreview ? money(Math.max(0, shownPreview.amount - Number(h.discountAmount || 0))) : '—'}</strong></p>
          </div>
        </div></SectionCard>
      </fieldset>
      {priceRequired && (
        <p role="alert" className="text-destructive-ink">
          默认报价为零，请填写大于零的正式成交价后保存。
        </p>
      )}
      {preview.loading && <p role="status">正在核对成交价与金额…</p>}
      <SectionVisibilityContext.Provider value={readable}><CustomerFinder
          compact
          readOwner={owner}
          readGuard={{ epoch, isCurrent: mayInteract }}
          open={h.customerFinderOpen}
          onClose={() => h.setCustomerFinderOpen(false)}
          onConfirm={(customer) => {
            try {
              if (reorder && !reorder.source.isActiveCurrent()) return
              assertKitReadOwner(owner)
              if (!mayInteract() || activity.current.generation !== renderGeneration) return
              if (ordinaryOnlySave && !order && h.customerId && h.customerId !== String(customer.id)) {
                setRows(old => old.map(row => row.input.kind === 'ordinary' ? { ...row, price: '', input: { ...row.input, priceSource: 'default', unitPrice: undefined } } : row))
              }
              h.setCustomerId(String(customer.id))
              h.setCustomerName(customer.name)
              h.setCustomerFinderOpen(false)
            } catch (e) {
              setError(e instanceof Error ? e.message : '来源已变化')
            }
          }}
        /></SectionVisibilityContext.Provider>
      {picker && (
        <SectionVisibilityContext.Provider value={readable}><CommercialPicker
          kind={picker}
          readGuard={{ epoch, isCurrent: mayInteract }}
          warehouseId={entryWarehouseId}
          owner={owner}
          onClose={() => setPicker(null)}
          onSelect={(row) => {
            if (row.input.warehouseId !== Number(interaction.current.warehouseId)) return
            if (reorder && !reorder.source.isActiveCurrent()) return
            if (!mayInteract() || activity.current.generation !== renderGeneration) return
            assertKitReadOwner(owner)
            setRows((old) => [...old, row])
            setPicker(null)
          }}
        /></SectionVisibilityContext.Provider>
      )}
      <ConfirmDialog
        open={discardOpen}
        title="放弃当前草稿"
        description="当前修改尚未保存。返回后这些输入会丢失，请确认是否放弃。"
        confirmText="放弃并返回"
        cancelText="继续编辑"
        loading={locked}
        onCancel={() => {
          if (!locked) setDiscardOpen(false)
        }}
        onConfirm={() => {
          if (!locked) {
            setDiscardOpen(false)
            onDone()
          }
        }}
      />
    </div>
  )
}
