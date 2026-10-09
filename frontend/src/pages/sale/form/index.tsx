import { ExistingSaleEditor } from '../commercial/ExistingSaleEditor'
import { readHandlingSourceId, mayHandle } from '@/lib/disposalHandlingRecovery'
import { useDisposalHandlingSource } from '@/hooks/useDisposalHandlingSource'
import { useDisposalHandlingOperation } from '@/hooks/useDisposalHandlingOperation'
import { HandlingOperationPanel } from '@/pages/disposal/HandlingOperationPanel'
import { createSaleApi } from '@/api/sale'
import { createRequestKey } from '@/lib/requestKey'
import { ReturnSourceButton } from '@/pages/returns/ReturnSourceButton'
import { ReorderSourceButton } from '../ReorderSourceButton'
import { ReorderSourcePanel } from '../ReorderSourcePanel'
import { RepeatCreateRecoveryPanel } from '../RepeatCreateRecoveryPanel'
import { useSaleReorderSource } from '@/hooks/useSaleReorderSource'
import { useRepeatSaleCreate } from '@/hooks/useRepeatSaleCreate'
import { mayCreateReorder, mayReorder, readReorderSource } from '@/lib/saleReorder'
import { PERMISSIONS } from '@/lib/permission-codes'
import { ordinaryReorderDrafts } from '../reorderDraft'
import { buildWorkspaceTabRegistrationFromPath } from '@/router/workspaceRouteMeta'
import { toast } from '@/lib/toast'
import CommercialSalePage, { NewCommercialSale } from '../commercial/CommercialSalePage'
import { usePermission } from '@/hooks/usePermission'
import { useCommercialSaleRead } from '@/hooks/useCommercialSale'
import { assertKitReadOwner } from '@/hooks/useKits'
import { readSaleHandoff } from './handoff'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import { money } from '@/lib/format'
import { OrderEntryIssues } from '@/components/shared/OrderEntryIssues'
import { collectOrderIssues } from '@/lib/orderEntry'
import { handleEntryKeyDown } from '@/lib/orderEntryNavigation'
import KeepAliveSection from '@/components/shared/KeepAliveSection'
import { OrderFulfillmentPanel } from '@/components/shared/OrderFulfillmentPanel'
import { DocumentActivityPanel } from '@/components/shared/DocumentActivityPanel'
import { SaleOrderItemsSection } from './components/SaleOrderItemsSection'
/**
 * SaleFormPage — 销售单新建 / 查看页面（独立路由）
 *
 * 路由：
 *   /sale/new    → 新建模式（空表单）
 *   /sale/:id    → 查看模式（已有订单详情 + 操作按钮）
 *
 * 路径由 TabPathContext 提供，不依赖 useLocation，
 * 确保 keep-alive 多标签场景下路径隔离正确。
 */

import { useState, useContext, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Clock, Loader2, Pencil, Save, Warehouse, X } from 'lucide-react'
import { PrintPreviewOverlay } from '@/components/print/SaleOrderPrintTemplate'
import { Button }  from '@/components/ui/button'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { UnsavedBadge } from '@/components/shared/EditModeBadge'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { useWorkspaceTabTitle } from '@/hooks/useWorkspaceTabTitle'
import { ActionBar }      from '@/components/shared/ActionBar'
import { ConfirmDialog }  from '@/components/shared/ConfirmDialog'
import ShipSelectDialog from '@/pages/sale/components/ShipSelectDialog'
import StockShortageDialog, { type StockShortageItem } from '@/pages/sale/components/StockShortageDialog'
import ReserveAllocationDialog from '@/pages/sale/components/ReserveAllocationDialog'
import ReleaseAllocationDialog from '@/pages/sale/components/ReleaseAllocationDialog'
import { SectionCard }    from '@/components/shared/SectionCard'
import { CustomerFinder, ProductFinder } from '@/components/finder'
import { useCreateSale, useSaleDetail, useShipSale, useCancelSale, useDeleteSale } from '@/hooks/useSale'
import { getSaleWorkflowStatus } from '@/lib/saleWorkflowStatus'
import DataTable from '@/components/shared/DataTable'
import type { TableColumn } from '@/types'
import { cn } from '@/lib/utils'
import type { SaleOrder, SaleOrderItem } from '@/types/sale'
import { FulfillmentProgressCard } from './components/FulfillmentProgressCard'
import { SaleOrderHeaderFields } from './components/SaleOrderHeaderFields'
import { SaleOrderItemsTable } from './components/SaleOrderItemsTable'
import { SaleOrderSummaryCard } from './components/SaleOrderSummaryCard'
import { SaleOrderOverview } from './components/SaleOrderOverview'
import { SaleOrderDetailTabs, type SaleDetailTab } from './components/SaleOrderDetailTabs'
import { SaleOrderInfoCard } from './components/SaleOrderInfoCard'
import { SaleOrderScanDetails, SaleOrderPackingDetails, SaleOrderPickingProgress } from './components/SaleOrderWarehouseViews'
import { validateSaleForm, serializeSaleItems } from './validate'
import { useSaleOrderForm } from './useSaleOrderForm'
import { useSaleEditEntry } from './useSaleEditEntry'

// ─── 主页面 ───────────────────────────────────────────────────────────────────

export default function SaleFormPage() {
  const tabPath  = useContext(TabPathContext)
  const navigate = useNavigate()
  const pathname = tabPath.split(/[?#]/)[0]
  const isNew    = pathname === '/sale/new' || tabPath === ''
  const reorder = readReorderSource(tabPath)
  const handlingId = readHandlingSourceId(tabPath)
  const rawSaleId = isNew ? null : tabPath.split('?')[0].split('/').pop() ?? null
  const saleId   = rawSaleId && /^\d+$/.test(rawSaleId) ? Number(rawSaleId) : null

  // ── 关闭当前 Tab 并返回 ──
  function closeTab() {
    const { removeTab } = useWorkspaceStore.getState()
    removeTab(buildWorkspaceTabRegistrationFromPath(tabPath || '/sale/new').key)
    navigate('/sale')
  }

  // ─── ① 新建模式 ─────────────────────────────────────────────────────────────

  if (handlingId === 'invalid' || (handlingId !== null && !isNew)) return <p role="alert">处理来源参数无效，请从处理来源列表重新打开；原参数保留</p>
  if ((isNew || pathname === '/sale/new-kit') && reorder === 'invalid') return <p role="alert">来源参数无效，请从原销售单重新打开；未载入任何草稿。</p>
  if (pathname === '/sale/new-kit') return <NewCommercialSale tabPath={tabPath} onDone={closeTab} sourceId={typeof reorder === 'number' ? reorder : undefined} />

  if (isNew && typeof handlingId === 'number') return <HandlingCreateView sourceId={handlingId} tabPath={tabPath} closeTab={closeTab} />
  if (isNew) return <NewCommercialSale tabPath={tabPath} onDone={id => { closeTab(); if (id) navigate(`/sale/${id}`) }} sourceId={typeof reorder === 'number' ? reorder : undefined} sourceModel="ordinary" ordinaryOnlySave />

  // ─── ② 查看模式 ─────────────────────────────────────────────────────────────

  if (!saleId) {
    return (
      <div className="flex h-40 flex-col items-center justify-center gap-3 text-muted-foreground">
        <p className="text-sm">销售单路由无效，请从列表重新打开</p>
      </div>
    )
  }

  return <DetailView saleId={saleId} tabPath={tabPath} closeTab={closeTab} />
}

function SaleModelGate({ saleId, tabPath, closeTab }: { saleId: number; tabPath: string; closeTab: () => void }) {
  const query = useCommercialSaleRead(saleId)
  const [initial, setInitial] = useState<SaleOrder | null>(null)
  const [sourceError, setSourceError] = useState('')
  // Same-owner cache is not an opening baseline; only this mounted read may initialize it once.
  useEffect(() => {
    if (!initial && query.isFetchedAfterMount && query.data && !query.isFetching && !query.isError) {
      try {
        assertKitReadOwner(query.readOwner)
        setInitial(query.data)
      } catch (error) {
        setSourceError(error instanceof Error ? error.message : '原单来源已变化')
      }
    }
  }, [initial, query.data, query.isFetchedAfterMount, query.isFetching, query.isError, query.readOwner])
  if (!initial) {
    if (query.isError || sourceError) return <div role="alert">
      <p>原单读取失败，请保留当前输入后重读。</p>
      <Button variant="outline" onClick={() => { setSourceError(''); void query.refetch() }}>重新读取原单</Button>
    </div>
    return <p role="status">读取原销售单…</p>
  }
  if (initial.commercialModel === 'kit-v1') return <CommercialSalePage initial={initial} owner={query.readOwner} tabPath={tabPath} onClose={closeTab} />
  return <p role="alert">原来源订单类型已变化，请保留输入并关闭后重新打开核对。</p>
}

// ════════════════════════════════════════════════════════════════════════════
// 新建视图
// ════════════════════════════════════════════════════════════════════════════

interface HandlingCreateProps { source: ReturnType<typeof useDisposalHandlingSource>; write: ReturnType<typeof useDisposalHandlingOperation>; operationUuid: string; requestKey: string }
function HandlingCreateView({ sourceId, tabPath, closeTab }: { sourceId: number; tabPath: string; closeTab: () => void }) {
  const source = useDisposalHandlingSource(sourceId, 1), [operationUuid] = useState(() => crypto.randomUUID()), [requestKey] = useState(() => createRequestKey('handling-sale'))
  const write = useDisposalHandlingOperation(buildWorkspaceTabRegistrationFromPath(tabPath).key, source.active, () => source.isCurrent() && mayHandle(PERMISSIONS.INVENTORY_DISPOSAL_VIEW, PERMISSIONS.SALE_ORDER_CREATE))
  return <CreateView tabPath={tabPath} closeTab={closeTab} handling={{ source, write, operationUuid, requestKey }} />
}
function CreateView({ closeTab, tabPath, reorder, handling }: { closeTab: () => void; tabPath: string; reorder?: { source: ReturnType<typeof useSaleReorderSource>; write: ReturnType<typeof useRepeatSaleCreate> }; handling?: HandlingCreateProps }) {
  const createMutate = useCreateSale()
  const [imported, setImported] = useState(false)
  const frozen = !!reorder && (reorder.write.blocked || !reorder.source.current || !reorder.source.active) || !!handling && (handling.write.blocked || !handling.source.current || !handling.source.active)
  const {
    customerId, customerName,
    warehouseId, setWarehouseId, warehouseName, setWarehouseName,
    remark, setRemark, carrierId, setCarrierId, shippingProduct, setShippingProduct, freightType, setFreightType,
    receiverName, setReceiverName, receiverPhone, setReceiverPhone, receiverAddress, setReceiverAddress,
    discountAmount, setDiscountAmount, total, discount, discountedTotal,
    quantityRefs, carrierOptions,
    items, priceLoading, priceErrors,
    finderOpen, setFinderOpen, setFinderItemKey,
    customerFinderOpen, setCustomerFinderOpen,
    setCustomerError, setWarehouseError,
    setInvalidItemKeys,
    isDirty, addItem, removeItem, updateItem,
    handleCustomerConfirm, handleFinderConfirm, initializeIdentities, initializeHandling,
  } = useSaleOrderForm(tabPath, undefined, reorder?.source.owner ?? handling?.source.owner, reorder ? () => reorder.source.isActiveCurrent() && !reorder.write.blocked && mayCreateReorder() : handling ? () => handling.source.isCurrent() && !handling.write.blocked && mayHandle(PERMISSIONS.INVENTORY_DISPOSAL_VIEW, PERMISSIONS.SALE_ORDER_CREATE) : undefined, !!handling)
  function importSource(include: boolean) {
    const data = reorder?.source.data
    if (!data?.customer || data.customerError || frozen || imported || data.items.some(i => i.error)) return
    if (initializeIdentities(data.customer, ordinaryReorderDrafts(data, include))) setImported(true)
    else toast.warning('当前新单已有输入，未覆盖；请保留输入后重新打开独立来源草稿')
  }
  const confirmed = () => { if (reorder?.source.isActiveCurrent()) closeTab() }

  const [validationAttempted, setValidationAttempted] = useState(false)
  const allIssues = collectOrderIssues({ kind: 'sale', partyId: customerId, partyName: customerName, warehouseId, warehouseName, items, receiverPhone, discountAmount, priceLoading, priceErrors })
  const issues = validationAttempted ? allIssues : []

  async function handleSubmit() {
    if ((reorder || handling) && (frozen || !imported)) return
    setValidationAttempted(true)
    const filledItems = validateSaleForm({
      items, customerId, customerName, warehouseId, warehouseName, receiverPhone, discountAmount, priceLoading, priceErrors,
      setCustomerError, setWarehouseError, setInvalidItemKeys,
    })
    if (!filledItems) return
    try {
      const payload = {
        customerId: +customerId, customerName,
        warehouseId: +warehouseId, warehouseName,
        remark: remark || undefined,
        discountAmount: Number(discountAmount) || 0,
        shippingProduct: shippingProduct || null,
        carrierId: carrierId ? +carrierId : null,
        freightType: freightType ? +freightType : null,
        receiverName: receiverName || undefined,
        receiverPhone: receiverPhone || undefined,
        receiverAddress: receiverAddress || undefined,
        items: serializeSaleItems(filledItems),
        ...(handling?.source.data ? { disposalSource: { sourceId: handling.source.data.source.id, expectedRevision: handling.source.data.source.revision, operationUuid: handling.operationUuid } } : {}),
      }
      if (handling?.source.data) {
        const source = handling.source.data.source
        if (!handling.source.isCurrent() || filledItems.length !== 1 || filledItems[0].productId !== source.productId || filledItems[0].unit !== source.unit || filledItems[0].entryUnit !== source.unit || +warehouseId !== source.warehouseId || filledItems[0].quantity > source.budget.availableQuantity) { toast.warning('请核对来源商品、原仓及可关联基本量'); return }
        const result = await handling.write.submit({ kind: 'sale', draftIdentity: buildWorkspaceTabRegistrationFromPath(tabPath).key, sourceId: source.id, intentUuid: source.intentUuid, operationUuid: handling.operationUuid, requestKey: handling.requestKey, action: 'disposal.handling.sale.create', path: '/sale', body: payload }, (body, key, config) => createSaleApi(body, key, config))
        if (result && handling.write.canApply(result)) { toast.success('销售草稿已关联，仍按原流程执行'); closeTab() }
        return
      }
      if (reorder) { const answer = await reorder.write.submit(payload); if (answer && reorder.write.canApply(answer)) confirmed() }
      else { await createMutate.mutateAsync(payload); closeTab() }
    } catch (_) {}
  }

  return (
    <div data-order-entry onKeyDown={handleEntryKeyDown} className="flex flex-col gap-2.5">
      <ActionBar
        title="新建销售单"
        subtitle={<UnsavedBadge show={isDirty} />}
        rightActions={
          <>

            <Button onClick={handleSubmit} disabled={createMutate.isPending || frozen || (!!reorder && !imported) || (!!handling && !imported)} className="gap-1.5">
              {createMutate.isPending
                ? <><Loader2 className="h-4 w-4 animate-spin" />保存中…</>
                : <><Save className="h-4 w-4" />保存草稿</>}
            </Button>
          </>
        }
      />

      {handling && <><p>处理来源：{handling.source.data?.source.productName ?? '核对中'}；仅原商品、原仓、基本单位，客户由员工选择。可关联 {handling.source.data?.source.budget.availableQuantity ?? '—'}</p>{handling.source.error && <p role="alert">{handling.source.error}</p>}<Button disabled={frozen || imported || !handling.source.data} onClick={() => { if (handling.source.data && initializeHandling(handling.source.data.source, handling.source.data.product)) setImported(true); else toast.warning('已有输入，来源未覆盖草稿；请保留并核对') }}>载入来源商品</Button><HandlingOperationPanel write={handling.write} /></>}
      {reorder && <><ReorderSourcePanel data={reorder.source.data} error={reorder.source.error} loading={reorder.source.loading} imported={imported} disabled={frozen} onImport={importSource} onReload={reorder.source.reload} /><RepeatCreateRecoveryPanel write={reorder.write} active={reorder.source.active} onConfirmed={confirmed} /></>}
      <fieldset disabled={frozen} className="contents">

      <OrderEntryIssues issues={issues} />
      <SaleOrderHeaderFields
        readOwner={reorder?.source.owner ?? handling?.source.owner}
        warehouseReadOnly={!!handling}
        warehouseName={warehouseName}
        headerReadOnly={frozen}
        interactionGuard={reorder ? { epoch: reorder.source.owner.epoch, isCurrent: () => reorder.source.isActiveCurrent() && !reorder.write.blocked && mayCreateReorder() && mayReorder(PERMISSIONS.CUSTOMER_VIEW) } : handling ? { epoch: handling.source.owner.epoch, isCurrent: () => handling.source.isCurrent() && !handling.write.blocked && mayHandle(PERMISSIONS.INVENTORY_DISPOSAL_VIEW, PERMISSIONS.SALE_ORDER_CREATE) } : undefined}
        customerId={customerId} customerName={customerName} customerError={issues.some(i => i.target === 'party')} setCustomerFinderOpen={setCustomerFinderOpen}
        warehouseId={warehouseId} setWarehouseId={handling ? () => {} : setWarehouseId} setWarehouseName={handling ? () => {} : setWarehouseName}
        warehouseError={issues.some(i => i.target === 'warehouse')} setWarehouseError={setWarehouseError}
        carrierId={carrierId} setCarrierId={setCarrierId} carrierOptions={carrierOptions}
        shippingProduct={shippingProduct} setShippingProduct={setShippingProduct}
        shippingProductDisabled={frozen}
        freightType={freightType} setFreightType={setFreightType}
        receiverName={receiverName} setReceiverName={setReceiverName}
        receiverPhone={receiverPhone} setReceiverPhone={setReceiverPhone}
        receiverAddress={receiverAddress} setReceiverAddress={setReceiverAddress}
        remark={remark} setRemark={setRemark}
      />

      {/* 商品明细：跟采购单/调拨单/退货单一致，点击"添加商品"弹出选品对话框 */}
      <SaleOrderItemsSection allowAdd={!handling} hasItems={items.length > 0} onAdd={handling ? () => toast.warning("处理来源仅允许一条原商品明细") : addItem}>
          <SaleOrderItemsTable
            lockedIdentity={!!handling}
            quantityRead={handling ? { owner: handling.source.owner, isCurrent: () => handling.source.isCurrent() && !handling.write.blocked && mayHandle(PERMISSIONS.PRODUCT_VIEW) } : undefined}
            readEnabled={!handling || (handling.source.current && handling.source.active && !handling.write.blocked)}
            items={items} invalidItemKeys={new Set(issues.flatMap(i => i.itemKey === undefined ? [] : [i.itemKey]))} quantityRefs={quantityRefs} priceLoading={priceLoading} priceErrors={priceErrors}
            setFinderItemKey={setFinderItemKey} setFinderOpen={setFinderOpen}
            updateItem={updateItem} removeItem={removeItem}
          />
      </SaleOrderItemsSection>

      <SaleOrderSummaryCard items={items} total={total} discount={discount} discountedTotal={discountedTotal}
        discountAmount={discountAmount} onDiscountChange={setDiscountAmount}
        warningText="存在低于进价的销售行，提交后会记录到时间线" />

      {/* 商品选择中心 */}
      {!handling && <ProductFinder
        mode="sale"
        warehouseName={warehouseName}
        open={handling ? false : finderOpen}
        readGuard={reorder ? () => reorder.source.isActiveCurrent() && !reorder.write.blocked && mayCreateReorder() : undefined}
        readOwner={reorder?.source.owner}
        warehouseId={warehouseId ? +warehouseId : null}
        onConfirm={handleFinderConfirm}
        onClose={() => { setFinderOpen(false); setFinderItemKey(null) }}
      />}

      {/* 客户 / 仓库 Finder */}
      <CustomerFinder
        open={handling ? customerFinderOpen : customerFinderOpen && !frozen}
        readOwner={reorder?.source.owner ?? handling?.source.owner}
        readGuard={handling ? { epoch: handling.source.owner.epoch, isCurrent: () => handling.source.isCurrent() && !handling.write.blocked && mayHandle(PERMISSIONS.CUSTOMER_VIEW, PERMISSIONS.SALE_ORDER_CREATE, PERMISSIONS.INVENTORY_DISPOSAL_VIEW) } : undefined}
        onClose={() => setCustomerFinderOpen(false)}
        onConfirm={handleCustomerConfirm}
      />

      {/* 底部安全间距 */}
      <div className="h-4" />
      </fieldset>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// 编辑视图（草稿状态 status=1 可编辑）
// ════════════════════════════════════════════════════════════════════════════

// 查看视图（已有销售单详情 + 状态操作）
// ════════════════════════════════════════════════════════════════════════════

function DetailView({ saleId, closeTab, tabPath }: { saleId: number; tabPath: string; closeTab: () => void }) {
  const { data: order, isLoading, isFetching, isPaused, isError, refetch } = useSaleDetail(saleId)
  const { can } = usePermission()
  // Once classified, this resource stays behind the owned read even if legacy bootstrap finishes later.
  const commercialResource = useRef({ saleId, identified: false })
  if (commercialResource.current.saleId !== saleId) commercialResource.current = { saleId, identified: false }
  if (order?.commercialModel === 'kit-v1') commercialResource.current.identified = true
  const needsCommercialRead = commercialResource.current.identified
  const active = useActiveWorkspaceTab()
  const handoff = readSaleHandoff(tabPath, saleId)
  const hasHandoff = handoff !== null && handoff !== 'invalid'
  const [checkedPath, setCheckedPath] = useState('')
  useEffect(() => {
    setCheckedPath('')
    if (!active || !hasHandoff) return
    let current = true
    void refetch({ cancelRefetch: false }).then(result => { if (current && !result.isError) setCheckedPath(tabPath) })
    return () => { current = false }
  }, [active, hasHandoff, tabPath, refetch])
  const handoffReady = !hasHandoff || (active && checkedPath === tabPath && !isFetching && !isPaused && !isError)
  // 直接访问或刷新 /#/sale/3260 时，标签原本是路由兜底的「销售单 #3260」（数据库主键，
  // 用户认不出是哪张单）；数据到位后换成真实单号，与「从列表点进来」保持一致。
  useWorkspaceTabTitle(needsCommercialRead ? undefined : order?.orderNo)
  const shipMutate     = useShipSale()
  const deleteMutate   = useDeleteSale()
  const cancelMutate   = useCancelSale()

  const [printOpen, setPrintOpen] = useState(false)
  const [detailTab, setDetailTab] = useState<SaleDetailTab>(() => hasHandoff ? handoff.focus : 'info')
  useEffect(() => {
    const context = readSaleHandoff(tabPath, saleId)
    if (context === 'invalid') setDetailTab('info')
    else if (context) setDetailTab(context.focus)
  }, [saleId, tabPath])
  const [adjustMode, setAdjustMode] = useState(false)
  const [editing, setEditing] = useState(false)
  const [shipDialogOpen, setShipDialogOpen] = useState(false)
  const [reserveDialogOpen, setReserveDialogOpen] = useState(false)
  const [releaseDialogOpen, setReleaseDialogOpen] = useState(false)
  const [shortageDialog, setShortageDialog] = useState<{ orderId: number; shortages: StockShortageItem[] } | null>(null)

  const [confirmState, setConfirmState] = useState<{
    open: boolean; title: string; description: string; variant: 'default' | 'destructive'; confirmText: string; onConfirm: () => void
  }>({ open: false, title: '', description: '', variant: 'default', confirmText: '确认', onConfirm: () => {} })

  const isPending = shipMutate.isPending || deleteMutate.isPending || cancelMutate.isPending
  useSaleEditEntry(tabPath, !needsCommercialRead && !!order && !isFetching && !isPaused && !isError, () => {
    if (order?.status === 1 && can(PERMISSIONS.SALE_ORDER_UPDATE) && !isPending) setEditing(true)
  })

  if (editing) return <ExistingSaleEditor saleId={saleId} tabPath={tabPath} onDone={() => setEditing(false)} />
  if (adjustMode) return <ExistingSaleEditor saleId={saleId} tabPath={tabPath} adjust onDone={() => setAdjustMode(false)} />

  if (needsCommercialRead) return <SaleModelGate key={saleId} saleId={saleId} tabPath={tabPath} closeTab={closeTab} />

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center text-muted-body">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />加载中…
      </div>
    )
  }

  if (!order && isError) return <div role="alert" className="space-y-3 p-4 text-sm"><p>原单读取失败，请重新读取后查看任务。</p><Button variant="outline" onClick={() => void refetch()}>重新读取原单</Button></div>

  if (!order) {
    return (
      <div className="flex h-40 flex-col items-center justify-center gap-3 text-muted-foreground">
        <p className="text-sm">销售单不存在或已删除</p>
      </div>
    )
  }

  // 分仓/分批：多仓订单、或已有部分发货的订单，明细已锁定（后端拒绝改单），不进改单视图。
  // 占库期（状态2/6）无 taskId 也可改单（占库期改单）；执行期（状态3）需有 taskId。
  const canAdjust = (order.status === 2 || order.status === 3 || order.status === 6)
    && !order.warehouseTaskCancelRequestedAt && !order.warehouseTaskAdjustmentRequestedAt
    && !order.executionAdjustmentBlocked && !order.isMultiWarehouse && (order.shippedTotalQty ?? 0) === 0
  const ws = getSaleWorkflowStatus(order)

  return (
    <div className="flex flex-col gap-2.5">
      {handoff === 'invalid' && <p role="alert" className="text-sm text-destructive-ink">交接参数无效，请从原事项重新打开；当前只显示本单信息。</p>}
      <ActionBar
        title={order.orderNo}
        subtitle={
          <SoftStatusLabel label={ws.label} tone={ws.tone} title={ws.detail} />
        }
        rightActions={
          <>
            <ReturnSourceButton kind="sale" sourceId={order.id} sourceNo={order.orderNo} />
            <ReorderSourceButton sourceId={order.id} model="ordinary" disabled={isFetching || isError || isPaused} />
            {can(PERMISSIONS.SALE_ORDER_DELETE) && order.status === 5 && (
              <Button variant="outline" className="text-destructive-ink border-destructive/30 hover:bg-destructive/5" disabled={isPending}
                onClick={() => setConfirmState({
                  open: true, title: '确认删除订单', description: '删除后订单将无法恢复。', variant: 'destructive', confirmText: '确认删除',
                  onConfirm: () => {
                    setConfirmState(s => ({ ...s, open: false }))
                    deleteMutate.mutate(order.id, { onSuccess: () => closeTab() })
                  },
                })}>
                <X className="h-4 w-4 mr-1" />删除订单
              </Button>
            )}
            {can(PERMISSIONS.SALE_ORDER_CANCEL) && (order.status === 1 || order.status === 2 || order.status === 3 || order.status === 6) && (
              <Button variant="outline" className="text-destructive-ink border-destructive/30 hover:bg-destructive/5" disabled={isPending}
                onClick={() => setConfirmState({
                  open: true, title: '取消订单',
                  description: order.status === 3
                    ? ((order.shippedTotalQty ?? 0) > 0
                      ? '该订单已有部分商品出库：未发货的商品明细将被删除，已出库部分保留，订单直接变为已出库状态，是否继续？'
                      : '将同步取消关联仓库任务并释放锁定资源，是否继续？')
                    : (order.status === 2 || order.status === 6)
                      ? '将释放已占用库存并取消销售单，是否继续？'
                      : '取消后订单将变为已取消状态，是否继续？',
                  variant: 'destructive', confirmText: '确认取消',
                  onConfirm: () => { setConfirmState(s => ({ ...s, open: false })); cancelMutate.mutate(order.id) },
                })}>
                <X className="h-4 w-4 mr-1" />取消订单
              </Button>
            )}
            {can(PERMISSIONS.SALE_ORDER_RESERVE) && (order.status === 1 || order.status === 6) && (
              <Button variant="outline" disabled={isPending} onClick={() => setReserveDialogOpen(true)}>
                <Warehouse className="h-4 w-4 mr-1" />{order.status === 6 ? '补占库存' : '占用库存'}
              </Button>
            )}
            {can(PERMISSIONS.SALE_ORDER_RELEASE) && (order.status === 2 || order.status === 6) && (
              <Button variant="outline" disabled={isPending} onClick={() => setReleaseDialogOpen(true)}>
                <Warehouse className="h-4 w-4 mr-1" />取消占库
              </Button>
            )}
            {/* 打印与订单状态无关（模板只依赖订单基础信息 + 明细），每个状态都可打印，与采购单一致 */}
            <Button variant="outline" onClick={() => setPrintOpen(true)}>打印订单</Button>
            {can(PERMISSIONS.SALE_ORDER_SHIP) && (order.status === 2 || order.status === 6) && (
              <Button disabled={isPending} onClick={() => setShipDialogOpen(true)}>
                发起出库
              </Button>
            )}
            {/* 分批：履约中且仍有未派发行时可继续发剩余 */}
            {can(PERMISSIONS.SALE_ORDER_SHIP) && order.status === 3 && order.hasUndispatchedItems && (
              <Button disabled={isPending} onClick={() => setShipDialogOpen(true)}>
                继续发货
              </Button>
            )}
            {can(PERMISSIONS.SALE_ORDER_UPDATE) && canAdjust && (
              <Button variant="outline" disabled={isPending} onClick={() => setAdjustMode(true)}>
                <Pencil className="h-4 w-4 mr-1" />修改订单
              </Button>
            )}
            {can(PERMISSIONS.SALE_ORDER_UPDATE) && order.status === 1 && (
              <Button variant="outline" disabled={isPending} onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4 mr-1" />编辑
              </Button>
            )}
          </>
        }
      />

      <SaleOrderOverview order={order} />

      {order.warehouseTaskAdjustmentRequestedAt && (
        <div className="flex items-center gap-2 rounded-lg border border-warning/25 bg-warning/[0.06] px-4 py-3 text-sm text-foreground">
          <Clock className="h-4 w-4 shrink-0 text-warning-ink" />
          改单待仓库确认：有商品的归还/拆箱还未经 PDA 扫码确认，确认完成前该订单的拣货/分拣/复核/打包/出库都会被阻止，也暂时不能再次修改订单。
        </div>
      )}

      <SaleOrderDetailTabs value={detailTab} onChange={setDetailTab} />

      <KeepAliveSection active={detailTab === 'info'} className="space-y-3"><>
          <SaleOrderInfoCard order={order} />

          {/* 商品明细 */}
          <SectionCard title="商品明细" compact noPadding>
            <div data-sale-detail-items>
              <div data-workspace-scroll tabIndex={0} aria-label="销售商品明细" className="max-h-[min(60vh,36rem)] overflow-auto [&>div]:rounded-none [&>div]:border-0 [&>div]:overflow-visible [&_[data-table-scroll]]:overflow-visible [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10">
                <DataTable
                  virtualized
                  columns={[
                    { key: 'productName', title: '商品', width: 440, render: (_, item) => (
                      <div className="space-y-1 whitespace-normal [overflow-wrap:anywhere]">
                        <div className="font-medium"><span className="mr-2 font-mono text-xs text-muted-foreground">{item.productCode}</span>{item.productName}</div>
                        {(item.spec || item.color || item.articleNumber) && <div className="text-xs text-muted-foreground">{[item.spec && `型号 ${item.spec}`, item.color && `颜色 ${item.color}`, item.articleNumber && `供应商型号 ${item.articleNumber}`].filter(Boolean).join(' · ')}</div>}
                      </div>
                    ) },
                    { key: 'unit', title: '单位', width: 70, render: (_, item) => <span className="text-center">{(item.entryUnit && item.entryUnit !== item.unit) ? item.entryUnit : item.unit}</span> },
                    // 分仓订单：展示每行的发货仓库
                    ...(order.isMultiWarehouse ? [{
                      key: 'warehouseName' as const, title: '发货仓库', width: 120,
                      render: (v: unknown) => <span className="text-sm">{(v as string) || order.warehouseName || '-'}</span>,
                    }] : []),
                    {
                      key: 'quantity', title: '数量', width: 120, align: 'right',
                      render: (v, item) => (item.entryUnit && item.entryUnit !== item.unit && item.entryQty != null)
                        ? <span className="tabular-nums">{item.entryQty} {item.entryUnit}<span className="ml-1 text-xs text-muted-foreground">（{Number(v)} {item.unit}）</span></span>
                        : <span className="tabular-nums">{String(v)}</span>,
                    },
                    // 进入履约后展示已发/应发进度
                    ...((order.shippedTotalQty ?? 0) > 0 || order.status >= 3 ? [{
                      key: 'shippedQty' as const, title: '已发/应发', width: 100, align: 'right' as const,
                      render: (v: unknown, item: SaleOrderItem) => {
                        const shipped = Number(v ?? 0)
                        const done = shipped >= item.quantity
                        return <span className={cn('tabular-nums', done ? 'text-success-ink' : shipped > 0 ? 'text-primary' : 'text-muted-foreground')}>{shipped}/{item.quantity}</span>
                      },
                    }] : []),
                    {
                      key: 'unitPrice', title: '单价', width: 130, align: 'right',
                      render: (v, item) => (
                        <div className="space-y-1">
                          <div className="tabular-nums">
                            {(item.entryUnit && item.entryUnit !== item.unit && item.entryQty && item.entryQty > 0)
                              ? <span title={`¥${Number(v).toFixed(4)} / ${item.unit}`}>{money(item.amount / item.entryQty)}/{item.entryUnit}</span>
                              : <>{money(Number(v))}</>}
                          </div>
                          {item.belowCost && item.costPrice != null && (
                            <div className="inline-flex items-center gap-1 text-[11px] text-destructive-ink">
                              <AlertTriangle className="h-3 w-3" />
                              低于进价 {money(Number(item.costPrice))}
                            </div>
                          )}
                        </div>
                      ),
                    },
                    { key: 'amount', title: '金额', width: 110, align: 'right', render: v => <span className="font-semibold tabular-nums">{money(Number(v))}</span> },
                    { key: 'remark', title: '备注', width: 180, expandableText: true },
                  ] satisfies TableColumn<SaleOrderItem>[]}
                  data={order.items ?? []}
                  rowKey="id"
                  emptyText="暂无商品明细"
                />
              </div>
              <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-2 border-t px-4 py-3 text-sm">
                <span className="mr-auto tabular-nums"><span className="text-muted-foreground">明细</span> {order.items?.length ?? 0} 行</span>
                <span className="tabular-nums"><span className="mr-2 text-muted-foreground">折扣金额</span>{Number(order.discountAmount ?? 0) > 0 ? money(-Number(order.discountAmount)) : money(0)}</span>
                <strong className="tabular-nums"><span className="mr-2 font-normal">订单金额</span>{money(Math.max(0, Number(order.totalAmount) - Number(order.discountAmount ?? 0)))}</strong>
              </div>
            </div>
          </SectionCard>
        </></KeepAliveSection>

      <KeepAliveSection active={detailTab === 'fulfillment'} className="space-y-3">
        <OrderFulfillmentPanel key={order.id} type="sale" id={order.id} />
      </KeepAliveSection>

      <KeepAliveSection active={detailTab === 'progress'} className="space-y-3"><div className="card-base space-y-4 p-4">
          {!handoffReady || isError ? <div className="space-y-2 text-sm" role={isError ? 'alert' : 'status'}><p>{isError ? '原单读取失败，无法核对最新任务；请重新读取后交接。' : isPaused ? '网络已暂停，等待恢复后重新读取原单任务。' : '正在重新读取原单任务…'}</p>{isError && <Button variant="outline" onClick={() => { setCheckedPath(''); void refetch().then(result => { if (!result.isError) setCheckedPath(tabPath) }) }}>重新读取原单</Button>}</div> : (
            <div className="space-y-4">
              <FulfillmentProgressCard order={order} targetTaskId={handoff && handoff !== 'invalid' ? handoff.taskId : undefined} />
              <SaleOrderPickingProgress order={order} />
            </div>
          )}
          {!order.taskNo && !hasHandoff && <p className="py-8 text-center text-sm text-muted-foreground">尚未创建仓库任务，订单状态为 {getSaleWorkflowStatus(order).label}</p>}
        </div></KeepAliveSection>

      <KeepAliveSection active={detailTab === 'scan'} className="space-y-3"><SaleOrderScanDetails order={order} /></KeepAliveSection>

      <KeepAliveSection active={detailTab === 'pack'} className="space-y-3"><SaleOrderPackingDetails order={order} /></KeepAliveSection>

      <KeepAliveSection active={detailTab === 'log'} className="space-y-3"><DocumentActivityPanel type="sale" id={order.id} view="log" /></KeepAliveSection>

      {/* 底部安全间距 */}
      <div className="h-4" />

      <ConfirmDialog
        open={confirmState.open}
        title={confirmState.title}
        description={confirmState.description}
        variant={confirmState.variant}
        confirmText={confirmState.confirmText}
        cancelText="返回订单"
        loading={isPending}
        onConfirm={confirmState.onConfirm}
        onCancel={() => setConfirmState(s => ({ ...s, open: false }))}
      />

      {/* 打印预览全屏遮罩 */}
      {printOpen && (
        <PrintPreviewOverlay order={order} onClose={() => setPrintOpen(false)} />
      )}

      {/* 发货选择弹窗（分批发货：可选本次发哪些行） */}
      <ShipSelectDialog
        open={shipDialogOpen}
        onClose={() => setShipDialogOpen(false)}
        order={order}
        loading={shipMutate.isPending}
        onConfirm={(items) => {
          shipMutate.mutate({ id: order.id, items }, { onSuccess: () => setShipDialogOpen(false) })
        }}
      />

      <ReserveAllocationDialog
        open={reserveDialogOpen}
        orderId={order.id}
        onClose={() => setReserveDialogOpen(false)}
        onShortage={(orderId, shortages) => { setReserveDialogOpen(false); setShortageDialog({ orderId, shortages }) }}
      />
      <ReleaseAllocationDialog
        open={releaseDialogOpen}
        orderId={order.id}
        items={order.items ?? []}
        onClose={() => setReleaseDialogOpen(false)}
      />
      <StockShortageDialog
        open={!!shortageDialog}
        onClose={() => setShortageDialog(null)}
        shortages={shortageDialog?.shortages ?? []}
      />
    </div>
  )
}
