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

import { useState, useCallback, useContext, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Activity, AlertTriangle, ClipboardList, Clock, History, Loader2, PackageCheck, Pencil, Save, ScanLine, Warehouse, X } from 'lucide-react'
import { PrintPreviewOverlay } from '@/components/print/SaleOrderPrintTemplate'
import { Button }  from '@/components/ui/button'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { ActionBar }      from '@/components/shared/ActionBar'
import { ConfirmDialog }  from '@/components/shared/ConfirmDialog'
import ShipSelectDialog from '@/pages/sale/components/ShipSelectDialog'
import StockShortageDialog, { type StockShortageItem } from '@/pages/sale/components/StockShortageDialog'
import ReserveAllocationDialog from '@/pages/sale/components/ReserveAllocationDialog'
import ReleaseAllocationDialog from '@/pages/sale/components/ReleaseAllocationDialog'
import { SectionCard }    from '@/components/shared/SectionCard'
import { CustomerFinder, ProductFinder } from '@/components/finder'
import { useCreateSale, useUpdateSale, useAdjustSale, useSaleDetail, useShipSale, useCancelSale, useDeleteSale } from '@/hooks/useSale'
import { useCarriersActive } from '@/hooks/useCarriers'
import { toast } from '@/lib/toast'
import { getSaleWorkflowStatus } from '@/lib/saleWorkflowStatus'
import { getReceivableStatus } from '@/lib/receivableStatus'
import DataTable from '@/components/shared/DataTable'
import type { TableColumn } from '@/types'
import { getCustomerPriceApi } from '@/api/price-lists'
import { cn } from '@/lib/utils'
import type { SaleOrderItem } from '@/types/sale'
import type { ProductFinderResult, ProductUnit } from '@/types/products'
import type { FinderResult } from '@/types/finder'
import { getProductApi } from '@/api/products'
import { FulfillmentProgressCard } from './components/FulfillmentProgressCard'
import { SaleOrderHeaderFields } from './components/SaleOrderHeaderFields'
import { SaleOrderItemsTable } from './components/SaleOrderItemsTable'
import { SaleOrderSummaryCard } from './components/SaleOrderSummaryCard'
import { SaleOrderOverview } from './components/SaleOrderOverview'
import { validateSaleForm, type DraftItem, type ScanRow } from './validate'

// ─── 主页面 ───────────────────────────────────────────────────────────────────

export default function SaleFormPage() {
  const tabPath  = useContext(TabPathContext)
  const navigate = useNavigate()
  const isNew    = tabPath === '/sale/new' || tabPath === ''
  const rawSaleId = isNew ? null : tabPath.split('/').pop() ?? null
  const saleId   = rawSaleId && /^\d+$/.test(rawSaleId) ? Number(rawSaleId) : null

  // ── 关闭当前 Tab 并返回 ──
  function closeTab() {
    const { removeTab } = useWorkspaceStore.getState()
    removeTab(tabPath || '/sale/new')
    navigate('/sale')
  }

  // ─── ① 新建模式 ─────────────────────────────────────────────────────────────

  if (isNew) return <CreateView closeTab={closeTab} tabPath={tabPath} />

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

/** CreateView / EditView 共用的表单状态与操作逻辑；传 order 则从已有订单初始化（编辑），不传则从空白开始（新建）。 */
function useSaleOrderForm(tabPath: string, order?: NonNullable<ReturnType<typeof useSaleDetail>['data']>) {
  const [customerId,      setCustomerId]      = useState(order ? String(order.customerId) : '')
  const [customerName,    setCustomerName]    = useState(order?.customerName ?? '')
  const [warehouseId,     setWarehouseId]     = useState(order ? String(order.warehouseId) : '')
  const [warehouseName,   setWarehouseName]   = useState(order?.warehouseName ?? '')
  const [remark,          setRemark]          = useState(order?.remark ?? '')
  const [carrierId,       setCarrierId]       = useState(order?.carrierId ? String(order.carrierId) : '')
  const [freightType,     setFreightType]     = useState(order?.freightType ? String(order.freightType) : '')
  const [receiverName,    setReceiverName]    = useState(order?.receiverName ?? '')
  const [receiverPhone,   setReceiverPhone]   = useState(order?.receiverPhone ?? '')
  const [receiverAddress, setReceiverAddress] = useState(order?.receiverAddress ?? '')
  const [discountAmount,  setDiscountAmount]  = useState(order?.discountAmount ? String(order.discountAmount) : '')
  const counterRef    = useRef((order?.items ?? []).length)
  const quantityRefs  = useRef<Map<number, HTMLInputElement>>(new Map())
  const mkEmpty = (): DraftItem => ({ _key: ++counterRef.current, productId: 0, productCode: '', productName: '', articleNumber: null, spec: null, color: null, unit: '', entryUnit: '', units: [], quantity: 1, unitPrice: 0, remark: '', priceSource: 'default', resolvedPrice: null, resolvedPriceLevel: null, costPrice: null })

  const { data: carrierOptions = [] } = useCarriersActive()

  const [items, setItems] = useState<DraftItem[]>(() =>
    (order?.items ?? []).map((item, i) => ({
      _key: i, productId: item.productId, productCode: item.productCode,
      productName: item.productName, articleNumber: item.articleNumber ?? null, spec: item.spec ?? null, color: item.color ?? null,
      unit: item.unit, entryUnit: item.entryUnit ?? item.unit, units: [],
      // 表单的数量/单价是「录入单位」口径：数量=entryQty(箱)，单价=每录入单位价（由 amount/entryQty 精确还原）
      quantity: item.entryQty ?? item.quantity,
      warehouseId: item.warehouseId ?? null, warehouseName: item.warehouseName ?? null,
      unitPrice: item.entryQty && item.entryQty > 0 ? Math.round((item.amount / item.entryQty) * 100) / 100 : item.unitPrice,
      remark: item.remark ?? '', priceSource: 'default' as const, costPrice: item.costPrice ?? null, resolvedPrice: null, resolvedPriceLevel: null,
    })),
  )
  // 编辑/改单态：为每个明细行商品拉多计量单位，供单位下拉回显（新建态在 handleFinderConfirm 里拉）
  useEffect(() => {
    const src = order?.items ?? []
    const productIds = [...new Set(src.filter(i => i.productId > 0).map(i => i.productId))]
    if (!productIds.length) return
    let cancelled = false
    Promise.all(productIds.map(pid =>
      getProductApi(pid).then(p => [pid, p?.units ?? []] as [number, ProductUnit[]]).catch(() => [pid, [] as ProductUnit[]] as [number, ProductUnit[]]),
    )).then(pairs => {
      if (cancelled) return
      const map = new Map<number, ProductUnit[]>(pairs)
      setItems(prev => prev.map(i => (map.has(i.productId) ? { ...i, units: map.get(i.productId)! } : i)))
    })
    return () => { cancelled = true }
  }, [order])
  const [priceLoading, setPriceLoading] = useState<Record<number, boolean>>({})
  const [finderOpen,    setFinderOpen]    = useState(false)
  const [finderItemKey, setFinderItemKey] = useState<number | null>(null)
  const [customerFinderOpen,  setCustomerFinderOpen]  = useState(false)
  const [customerError, setCustomerError] = useState(false)
  const [warehouseError, setWarehouseError] = useState(false)
  const [invalidItemKeys, setInvalidItemKeys] = useState<Set<number>>(new Set())

  // 编辑态初始值本就非空，"是否非空"不能代表"是否改过"，改成和进入编辑时的快照比较；
  // 新建态没有快照可比，沿用"任意字段非空即算改过"。
  const editSnapshotRef = useRef(order
    ? JSON.stringify({ customerId, warehouseId, remark, carrierId, freightType, receiverName, receiverPhone, receiverAddress, discountAmount, items })
    : null)
  const isDirty = order
    ? JSON.stringify({ customerId, warehouseId, remark, carrierId, freightType, receiverName, receiverPhone, receiverAddress, discountAmount, items }) !== editSnapshotRef.current
    : !!(customerId || warehouseId || remark || carrierId || receiverName || items.length)
  useDirtyGuard(tabPath, isDirty)

  // 添加商品：新增一行并立即弹出选品对话框，与采购单/调拨单/退货单一致
  const addItem = () => {
    const item = mkEmpty()
    setItems(prev => [...prev, item])
    setFinderItemKey(item._key)
    setFinderOpen(true)
  }

  // 触发已有商品行的客户价格等级查询（只查价，不设 customerId）
  const handleCustomerChange = useCallback(async (cid: string) => {
    if (!cid) return
    setItems(prev => prev.map(i => {
      if (!i.productId) return i
      void (async () => {
        try {
          const r = await getCustomerPriceApi(+cid, i.productId)
          if (r?.salePrice !== undefined) {
            setItems(p => p.map(x => x._key === i._key ? { ...x, unitPrice: r!.salePrice, priceSource: 'list', resolvedPrice: r!.salePrice, resolvedPriceLevel: r!.priceLevel } : x))
          }
        } catch (_) {}
      })()
      return i
    }))
  }, [])

  function handleCustomerConfirm(result: FinderResult) {
    setCustomerId(String(result.id))
    setCustomerName(result.name)
    setCustomerError(false)
    void handleCustomerChange(String(result.id))
  }

  const removeItem = (k: number) => setItems(prev => prev.filter(i => i._key !== k))

  const updateItem = (k: number, field: string, val: string | number) =>
    setItems(prev => prev.map(i => i._key === k ? { ...i, [field]: val, priceSource: field === 'unitPrice' ? 'manual' : i.priceSource } : i))

  async function handleFinderConfirm(product: ProductFinderResult) {
    if (finderItemKey === null) return
    const k = finderItemKey
    setItems(prev => prev.map(i => i._key === k
      ? { ...i, productId: product.id, productCode: product.code, productName: product.name, articleNumber: product.articleNumber ?? null, spec: product.spec ?? null, color: product.color ?? null, unit: product.unit, entryUnit: product.unit, units: [], quantity: 0, unitPrice: product.salePrice ?? 0, priceSource: 'default', costPrice: product.costPrice ?? null, resolvedPrice: null, resolvedPriceLevel: null }
      : i
    ))
    // 商品选择后自动聚焦到该行数量框
    setTimeout(() => { const inp = quantityRefs.current.get(k); if (inp) { inp.focus(); inp.select() } }, 0)
    // 拉该商品多计量单位，供单位下拉（无辅助单位则只保留基本单位、下拉不出现）
    getProductApi(product.id)
      .then(full => { const units = full?.units ?? []; setItems(prev => prev.map(i => (i._key === k && i.productId === product.id ? { ...i, units } : i))) })
      .catch(() => { /* 拉取失败：按基本单位录入 */ })
    if (customerId) {
      setPriceLoading(prev => ({ ...prev, [k]: true }))
      try {
        const r = await getCustomerPriceApi(+customerId, product.id)
        if (r?.salePrice !== undefined)
          setItems(prev => prev.map(i => i._key === k ? { ...i, unitPrice: r!.salePrice, priceSource: 'list', resolvedPrice: r!.salePrice, resolvedPriceLevel: r!.priceLevel } : i))
      } catch (_) {}
      setPriceLoading(prev => ({ ...prev, [k]: false }))
    }
  }

  const total = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)
  const discount = Math.max(0, Number(discountAmount) || 0)
  const discountedTotal = Math.max(0, total - discount)

  return {
    customerId, setCustomerId, customerName, setCustomerName,
    warehouseId, setWarehouseId, warehouseName, setWarehouseName,
    remark, setRemark, carrierId, setCarrierId, freightType, setFreightType,
    receiverName, setReceiverName, receiverPhone, setReceiverPhone, receiverAddress, setReceiverAddress,
    discountAmount, setDiscountAmount, total, discount, discountedTotal,
    quantityRefs, carrierOptions,
    items, priceLoading,
    finderOpen, setFinderOpen, finderItemKey, setFinderItemKey,
    customerFinderOpen, setCustomerFinderOpen,
    customerError, setCustomerError, warehouseError, setWarehouseError,
    invalidItemKeys, setInvalidItemKeys,
    isDirty, addItem, removeItem, updateItem,
    handleCustomerConfirm, handleFinderConfirm,
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 新建视图
// ════════════════════════════════════════════════════════════════════════════

function CreateView({ closeTab, tabPath }: { closeTab: () => void; tabPath: string }) {
  const createMutate = useCreateSale()
  const {
    customerId, customerName,
    warehouseId, setWarehouseId, warehouseName, setWarehouseName,
    remark, setRemark, carrierId, setCarrierId, freightType, setFreightType,
    receiverName, setReceiverName, receiverPhone, setReceiverPhone, receiverAddress, setReceiverAddress,
    discountAmount, setDiscountAmount, total, discount, discountedTotal,
    quantityRefs, carrierOptions,
    items, priceLoading,
    finderOpen, setFinderOpen, setFinderItemKey,
    customerFinderOpen, setCustomerFinderOpen,
    customerError, setCustomerError, warehouseError, setWarehouseError,
    invalidItemKeys, setInvalidItemKeys,
    isDirty, addItem, removeItem, updateItem,
    handleCustomerConfirm, handleFinderConfirm,
  } = useSaleOrderForm(tabPath)

  async function handleSubmit() {
    const filledItems = validateSaleForm({
      items, customerId, customerName, warehouseId, warehouseName, receiverPhone,
      setCustomerError, setWarehouseError, setInvalidItemKeys,
    })
    if (!filledItems) return
    if (discount > total) {
      toast.warning('折扣金额不能超过订单合计')
      return
    }
    try {
      await createMutate.mutateAsync({
        customerId: +customerId, customerName,
        warehouseId: +warehouseId, warehouseName,
        remark: remark || undefined,
        discountAmount: Number(discountAmount) || 0,
        carrierId: carrierId ? +carrierId : null,
        freightType: freightType ? +freightType : null,
        receiverName: receiverName || undefined,
        receiverPhone: receiverPhone || undefined,
        receiverAddress: receiverAddress || undefined,
        items: filledItems.map(({ _key, units, ...r }) => r),
      })
      closeTab()
    } catch (_) {}
  }

  return (
    <div className="flex flex-col gap-2.5">
      <ActionBar
        title="新建销售单"
        subtitle={isDirty ? <span className="text-xs font-normal text-muted-foreground">未保存</span> : undefined}
        rightActions={
          <>

            <Button onClick={handleSubmit} disabled={createMutate.isPending} className="gap-1.5">
              {createMutate.isPending
                ? <><Loader2 className="h-4 w-4 animate-spin" />保存中…</>
                : <><Save className="h-4 w-4" />保存草稿</>}
            </Button>
          </>
        }
      />

      <SaleOrderHeaderFields
        customerId={customerId} customerName={customerName} customerError={customerError} setCustomerFinderOpen={setCustomerFinderOpen}
        warehouseId={warehouseId} setWarehouseId={setWarehouseId} setWarehouseName={setWarehouseName}
        warehouseError={warehouseError} setWarehouseError={setWarehouseError}
        carrierId={carrierId} setCarrierId={setCarrierId} carrierOptions={carrierOptions}
        freightType={freightType} setFreightType={setFreightType}
        receiverName={receiverName} setReceiverName={setReceiverName}
        receiverPhone={receiverPhone} setReceiverPhone={setReceiverPhone}
        receiverAddress={receiverAddress} setReceiverAddress={setReceiverAddress}
        remark={remark} setRemark={setRemark}
      />

      {/* 商品明细：跟采购单/调拨单/退货单一致，点击"添加商品"弹出选品对话框 */}
      <SaleOrderItemsSection hasItems={items.length > 0} onAdd={addItem}>
          <SaleOrderItemsTable
            items={items} invalidItemKeys={invalidItemKeys} quantityRefs={quantityRefs} priceLoading={priceLoading}
            setFinderItemKey={setFinderItemKey} setFinderOpen={setFinderOpen}
            updateItem={updateItem} removeItem={removeItem}
          />
      </SaleOrderItemsSection>

      <SaleOrderSummaryCard items={items} total={total} discount={discount} discountedTotal={discountedTotal}
        discountAmount={discountAmount} onDiscountChange={setDiscountAmount}
        warningText="存在低于进价的销售行，提交后会记录到时间线" />

      {/* 商品选择中心 */}
      <ProductFinder
        mode="sale"
        warehouseName={warehouseName}
        open={finderOpen}
        warehouseId={warehouseId ? +warehouseId : null}
        onConfirm={handleFinderConfirm}
        onClose={() => { setFinderOpen(false); setFinderItemKey(null) }}
      />

      {/* 客户 / 仓库 Finder */}
      <CustomerFinder
        open={customerFinderOpen}
        onClose={() => setCustomerFinderOpen(false)}
        onConfirm={handleCustomerConfirm}
      />

      {/* 底部安全间距 */}
      <div className="h-4" />
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// 编辑视图（草稿状态 status=1 可编辑）
// ════════════════════════════════════════════════════════════════════════════

function EditView({ order, tabPath, onDone }: { order: NonNullable<ReturnType<typeof useSaleDetail>['data']>; tabPath: string; onDone: () => void }) {
  const updateMutate  = useUpdateSale()

  const {
    customerId, customerName,
    warehouseId, setWarehouseId, warehouseName, setWarehouseName,
    remark, setRemark, carrierId, setCarrierId, freightType, setFreightType,
    receiverName, setReceiverName, receiverPhone, setReceiverPhone, receiverAddress, setReceiverAddress,
    discountAmount, setDiscountAmount, total, discount, discountedTotal,
    quantityRefs, carrierOptions,
    items, priceLoading,
    finderOpen, setFinderOpen, setFinderItemKey,
    customerFinderOpen, setCustomerFinderOpen,
    customerError, setCustomerError, warehouseError, setWarehouseError,
    invalidItemKeys, setInvalidItemKeys,
    addItem, removeItem, updateItem,
    handleCustomerConfirm, handleFinderConfirm,
  } = useSaleOrderForm(tabPath, order)

  async function handleSubmit() {
    const filledItems = validateSaleForm({
      items, customerId, customerName, warehouseId, warehouseName, receiverPhone,
      setCustomerError, setWarehouseError, setInvalidItemKeys,
    })
    if (!filledItems) return
    if (discount > total) {
      toast.warning('折扣金额不能超过订单合计')
      return
    }
    try {
      await updateMutate.mutateAsync({
        id: order.id,
        customerId: +customerId, customerName,
        warehouseId: +warehouseId, warehouseName,
        remark: remark || undefined,
        discountAmount: Number(discountAmount) || 0,
        carrierId: carrierId ? +carrierId : null,
        freightType: freightType ? +freightType : null,
        receiverName: receiverName || undefined,
        receiverPhone: receiverPhone || undefined,
        receiverAddress: receiverAddress || undefined,
        items: filledItems.map(({ _key, units, ...r }) => r),
      })
      onDone()
    } catch (_) {}
  }

  return (
    <div className="flex flex-col gap-2.5">
      <ActionBar
        title={`${order.orderNo} · 编辑`}
        rightActions={
          <>
            <Button variant="outline" onClick={onDone} disabled={updateMutate.isPending}>
              取消编辑
            </Button>
            <Button onClick={handleSubmit} disabled={updateMutate.isPending} className="gap-1.5">
              {updateMutate.isPending
                ? <><Loader2 className="h-4 w-4 animate-spin" />保存中…</>
                : <><Save className="h-4 w-4" />保存</>}
            </Button>
          </>
        }
      />

      <SaleOrderHeaderFields
        customerId={customerId} customerName={customerName} customerError={customerError} setCustomerFinderOpen={setCustomerFinderOpen}
        warehouseId={warehouseId} setWarehouseId={setWarehouseId} setWarehouseName={setWarehouseName}
        warehouseError={warehouseError} setWarehouseError={setWarehouseError}
        carrierId={carrierId} setCarrierId={setCarrierId} carrierOptions={carrierOptions}
        freightType={freightType} setFreightType={setFreightType}
        receiverName={receiverName} setReceiverName={setReceiverName}
        receiverPhone={receiverPhone} setReceiverPhone={setReceiverPhone}
        receiverAddress={receiverAddress} setReceiverAddress={setReceiverAddress}
        remark={remark} setRemark={setRemark}
      />

      {/* 商品明细：跟采购单/调拨单/退货单一致，点击"添加商品"弹出选品对话框 */}
      <SaleOrderItemsSection hasItems={items.length > 0} onAdd={addItem}>
          <SaleOrderItemsTable
            items={items} invalidItemKeys={invalidItemKeys} quantityRefs={quantityRefs} priceLoading={priceLoading}
            setFinderItemKey={setFinderItemKey} setFinderOpen={setFinderOpen}
            updateItem={updateItem} removeItem={removeItem}
          />
      </SaleOrderItemsSection>

      <SaleOrderSummaryCard items={items} total={total} discount={discount} discountedTotal={discountedTotal}
        discountAmount={discountAmount} onDiscountChange={setDiscountAmount}
        warningText="存在低于进价的销售行，保存后会记录到时间线" />

      <ProductFinder
        mode="sale"
        warehouseName={warehouseName}
        open={finderOpen}
        warehouseId={warehouseId ? +warehouseId : null}
        onConfirm={handleFinderConfirm}
        onClose={() => { setFinderOpen(false); setFinderItemKey(null) }}
      />

      <CustomerFinder
        open={customerFinderOpen}
        onClose={() => setCustomerFinderOpen(false)}
        onConfirm={handleCustomerConfirm}
      />

      <div className="h-4" />
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// 改单视图（已占库/部分占库/拣货中——增减数量/加删商品行）
// ════════════════════════════════════════════════════════════════════════════

/**
 * 改单：status∈{2,6}（占库期，未发货）走占库期改单，已占量按新明细对齐；
 * status=3（已发起出库，有关联仓库任务）走执行期改单，提交后若涉及已拣/已打包
 * 实物的归还（pending=true），后端会把任务挂起等待 PDA 扫码确认，这里只需提示、
 * 不阻塞——具体进度请去 PDA「改单确认」查看。
 */
function AdjustView({ order, tabPath, onDone }: { order: NonNullable<ReturnType<typeof useSaleDetail>['data']>; tabPath: string; onDone: () => void }) {
  const adjustMutate = useAdjustSale()

  const {
    customerId, customerName,
    warehouseId, setWarehouseId, warehouseName, setWarehouseName,
    remark, setRemark, carrierId, setCarrierId, freightType, setFreightType,
    receiverName, setReceiverName, receiverPhone, setReceiverPhone, receiverAddress, setReceiverAddress,
    discountAmount, total, discount, discountedTotal,
    quantityRefs, carrierOptions,
    items, priceLoading,
    finderOpen, setFinderOpen, setFinderItemKey,
    customerFinderOpen, setCustomerFinderOpen,
    customerError, setCustomerError, warehouseError, setWarehouseError,
    invalidItemKeys, setInvalidItemKeys,
    addItem, removeItem, updateItem,
    handleCustomerConfirm, handleFinderConfirm,
  } = useSaleOrderForm(tabPath, order)

  async function handleSubmit() {
    const filledItems = validateSaleForm({
      items, customerId, customerName, warehouseId, warehouseName, receiverPhone,
      setCustomerError, setWarehouseError, setInvalidItemKeys,
    })
    if (!filledItems) return
    try {
      await adjustMutate.mutateAsync({
        id: order.id,
        customerId: +customerId, customerName,
        warehouseId: +warehouseId, warehouseName,
        remark: remark || undefined,
        discountAmount: Number(discountAmount) || 0,
        carrierId: carrierId ? +carrierId : null,
        freightType: freightType ? +freightType : null,
        receiverName: receiverName || undefined,
        receiverPhone: receiverPhone || undefined,
        receiverAddress: receiverAddress || undefined,
        items: filledItems.map(({ _key, units, ...r }) => r),
      })
      onDone()
    } catch (_) {}
  }

  return (
    <div className="flex flex-col gap-2.5">
      <ActionBar
        title={`${order.orderNo} · 修改订单`}
        rightActions={
          <>
            <Button variant="outline" onClick={onDone} disabled={adjustMutate.isPending}>
              <X className="h-4 w-4 mr-1" />取消
            </Button>
            <Button onClick={handleSubmit} disabled={adjustMutate.isPending} className="gap-1.5">
              {adjustMutate.isPending
                ? <><Loader2 className="h-4 w-4 animate-spin" />提交中…</>
                : <><Save className="h-4 w-4" />提交改单</>}
            </Button>
          </>
        }
      />

      <div className="flex gap-2 rounded-lg border border-warning/25 bg-warning/[0.06] px-4 py-3 text-sm leading-6 text-foreground">
        <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-warning" />
        <span>订单已发往仓库执行。增加数量将触发重新拣货；减少数量若涉及已拣或已打包的商品，需经仓库扫码确认放回库位 / 拆箱后方可生效。</span>
      </div>

      <SaleOrderHeaderFields
        customerId={customerId} customerName={customerName} customerError={customerError} setCustomerFinderOpen={setCustomerFinderOpen}
        warehouseId={warehouseId} setWarehouseId={setWarehouseId} setWarehouseName={setWarehouseName}
        warehouseError={warehouseError} setWarehouseError={setWarehouseError}
        carrierId={carrierId} setCarrierId={setCarrierId} carrierOptions={carrierOptions}
        freightType={freightType} setFreightType={setFreightType}
        receiverName={receiverName} setReceiverName={setReceiverName}
        receiverPhone={receiverPhone} setReceiverPhone={setReceiverPhone}
        receiverAddress={receiverAddress} setReceiverAddress={setReceiverAddress}
        remark={remark} setRemark={setRemark}
      />

      <SaleOrderItemsSection hasItems={items.length > 0} onAdd={addItem}>
          <SaleOrderItemsTable
            items={items} invalidItemKeys={invalidItemKeys} quantityRefs={quantityRefs} priceLoading={priceLoading}
            setFinderItemKey={setFinderItemKey} setFinderOpen={setFinderOpen}
            updateItem={updateItem} removeItem={removeItem}
          />
      </SaleOrderItemsSection>

      <SaleOrderSummaryCard items={items} total={total} discount={discount} discountedTotal={discountedTotal}
        discountAmount={discountAmount} editableDiscount={false} />

      <ProductFinder
        mode="sale"
        warehouseName={warehouseName}
        open={finderOpen}
        warehouseId={warehouseId ? +warehouseId : null}
        onConfirm={handleFinderConfirm}
        onClose={() => { setFinderOpen(false); setFinderItemKey(null) }}
      />

      <CustomerFinder
        open={customerFinderOpen}
        onClose={() => setCustomerFinderOpen(false)}
        onConfirm={handleCustomerConfirm}
      />

      <div className="h-4" />
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// 查看视图（已有销售单详情 + 状态操作）
// ════════════════════════════════════════════════════════════════════════════

function DetailView({ saleId, closeTab, tabPath }: { saleId: number; tabPath: string; closeTab: () => void }) {
  const { data: order, isLoading } = useSaleDetail(saleId)
  const shipMutate     = useShipSale()
  const deleteMutate   = useDeleteSale()
  const cancelMutate   = useCancelSale()

  const [printOpen, setPrintOpen] = useState(false)
  const [detailTab, setDetailTab] = useState<'info'|'progress'|'scan'|'pack'|'log'>('info')
  const [adjustMode, setAdjustMode] = useState(false)
  const [editing, setEditing] = useState(false)
  const [shipDialogOpen, setShipDialogOpen] = useState(false)
  const [reserveDialogOpen, setReserveDialogOpen] = useState(false)
  const [releaseDialogOpen, setReleaseDialogOpen] = useState(false)
  const [shortageDialog, setShortageDialog] = useState<{ orderId: number; shortages: StockShortageItem[] } | null>(null)

  const [confirmState, setConfirmState] = useState<{
    open: boolean; title: string; description: string; variant: 'default' | 'destructive'; confirmText: string; onConfirm: () => void
  }>({ open: false, title: '', description: '', variant: 'default', confirmText: '确认', onConfirm: () => {} })

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center text-muted-body">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />加载中…
      </div>
    )
  }

  if (!order) {
    return (
      <div className="flex h-40 flex-col items-center justify-center gap-3 text-muted-foreground">
        <p className="text-sm">销售单不存在或已删除</p>
      </div>
    )
  }

  // 草稿状态默认先展示只读详情，点击"编辑"再进入可编辑视图（与采购单一致）
  if (order.status === 1 && editing) {
    return <EditView order={order} tabPath={tabPath} onDone={() => setEditing(false)} />
  }

  // 已发起出库后仍要改单：切到独立的改单视图，提交/取消后回到只读详情
  if (adjustMode) {
    return <AdjustView order={order} tabPath={tabPath} onDone={() => setAdjustMode(false)} />
  }

  const isPending = shipMutate.isPending || deleteMutate.isPending || cancelMutate.isPending
  // 分仓/分批：多仓订单、或已有部分发货的订单，明细已锁定（后端拒绝改单），不进改单视图。
  // 占库期（状态2/6）无 taskId 也可改单（占库期改单）；执行期（状态3）需有 taskId。
  const canAdjust = (order.status === 2 || order.status === 3 || order.status === 6)
    && !order.warehouseTaskCancelRequestedAt && !order.warehouseTaskAdjustmentRequestedAt
    && !order.executionAdjustmentBlocked && !order.isMultiWarehouse && (order.shippedTotalQty ?? 0) === 0
  const ws = getSaleWorkflowStatus(order)

  return (
    <div className="flex flex-col gap-2.5">
      <ActionBar
        title={order.orderNo}
        subtitle={
          <SoftStatusLabel label={ws.label} tone={ws.tone} title={ws.detail} />
        }
        rightActions={
          <>
            {order.status === 5 && (
              <Button variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/5" disabled={isPending}
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
            {(order.status === 1 || order.status === 2 || order.status === 3 || order.status === 6) && (
              <Button variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/5" disabled={isPending}
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
            {(order.status === 1 || order.status === 6) && (
              <Button variant="outline" disabled={isPending} onClick={() => setReserveDialogOpen(true)}>
                <Warehouse className="h-4 w-4 mr-1" />{order.status === 6 ? '补占库存' : '占用库存'}
              </Button>
            )}
            {(order.status === 2 || order.status === 6) && (
              <Button variant="outline" disabled={isPending} onClick={() => setReleaseDialogOpen(true)}>
                <Warehouse className="h-4 w-4 mr-1" />取消占库
              </Button>
            )}
            {/* 打印与订单状态无关（模板只依赖订单基础信息 + 明细），每个状态都可打印，与采购单一致 */}
            <Button variant="outline" onClick={() => setPrintOpen(true)}>打印订单</Button>
            {(order.status === 2 || order.status === 6) && (
              <Button disabled={isPending} onClick={() => setShipDialogOpen(true)}>
                发起出库
              </Button>
            )}
            {/* 分批：履约中且仍有未派发行时可继续发剩余 */}
            {order.status === 3 && order.hasUndispatchedItems && (
              <Button disabled={isPending} onClick={() => setShipDialogOpen(true)}>
                继续发货
              </Button>
            )}
            {canAdjust && (
              <Button variant="outline" disabled={isPending} onClick={() => setAdjustMode(true)}>
                <Pencil className="h-4 w-4 mr-1" />修改订单
              </Button>
            )}
            {order.status === 1 && (
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
          <Clock className="h-4 w-4 shrink-0 text-warning" />
          改单待仓库确认：有商品的归还/拆箱还未经 PDA 扫码确认，确认完成前该订单的拣货/分拣/复核/打包/出库都会被阻止，也暂时不能再次修改订单。
        </div>
      )}

      {/* 选项卡切换 */}
      <div className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-muted/30 p-1">
        {([
          ['info', '订单信息', ClipboardList],
          ['progress', '作业进度', Activity],
          ['scan', '取货明细', ScanLine],
          ['pack', '装箱进度', PackageCheck],
          ['log', '操作记录', History],
        ] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            aria-pressed={detailTab === key}
            onClick={() => setDetailTab(key)}
            className={`flex min-w-28 flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-[background-color,color,box-shadow] ${
              detailTab === key
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {detailTab === 'info' && (
        <>
          {/* 基础信息 */}
          <SectionCard title="基础信息" compact contentClassName="p-3">
            <div className="space-y-2 text-sm">
              <div className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2 xl:grid-cols-6">
                <div><span className="text-muted-foreground">客户：</span><span>{order.customerName}</span></div>
                <div><span className="text-muted-foreground">仓库：</span><span>{order.warehouseName}</span></div>
                <div><span className="text-muted-foreground">时间：</span><span>{formatDisplayDateTime(order.createdAt)}</span></div>
                <div><span className="text-muted-foreground">经办人：</span><span>{order.operatorName}</span></div>
                <div><span className="text-muted-foreground">承运商：</span><span>{order.carrier || '-'}</span></div>
                <div><span className="text-muted-foreground">运费方式：</span><span>{order.freightTypeName || '-'}</span></div>
                <div><span className="text-muted-foreground">收货人：</span><span>{order.receiverName || '-'}</span></div>
                <div><span className="text-muted-foreground">联系电话：</span><span>{order.receiverPhone || '-'}</span></div>
                <div className="sm:col-span-2"><span className="text-muted-foreground">收货地址：</span><span>{order.receiverAddress || '-'}</span></div>
                <div><span className="text-muted-foreground">备注：</span><span>{order.remark || '-'}</span></div>
                {(() => {
                  const rs = getReceivableStatus(order)
                  return (
                    <div>
                      <span className="text-muted-foreground">回款：</span>
                      <SoftStatusLabel label={rs.label} tone={rs.tone} />
                      {rs.dueDate && (
                        <span className="ml-1.5 text-xs text-muted-foreground">账期至 {rs.dueDate.slice(0, 10)}</span>
                      )}
                    </div>
                  )
                })()}
              </div>
            </div>
          </SectionCard>

          {/* 商品明细 */}
          <SectionCard title="商品明细" compact>
            <DataTable
              columns={[
                { key: 'productCode', title: '编码', width: 130 },
                { key: 'articleNumber', title: '供应商型号', width: 110, render: v => (v as string) || '-' },
                { key: 'spec', title: '型号', width: 110, render: v => (v as string) || '-' },
                { key: 'productName', title: '名称', width: 180 },
                { key: 'color', title: '颜色', width: 100, render: v => (v as string) || '-' },
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
                    return <span className={cn('tabular-nums', done ? 'text-success' : shipped > 0 ? 'text-primary' : 'text-muted-foreground')}>{shipped}/{item.quantity}</span>
                  },
                }] : []),
                {
                  key: 'unitPrice', title: '单价', width: 130, align: 'right',
                  render: (v, item) => (
                    <div className="space-y-1">
                      <div className="tabular-nums">
                        {(item.entryUnit && item.entryUnit !== item.unit && item.entryQty && item.entryQty > 0)
                          ? <span title={`¥${Number(v).toFixed(4)} / ${item.unit}`}>¥{(item.amount / item.entryQty).toFixed(2)}/{item.entryUnit}</span>
                          : <>¥{Number(v).toFixed(2)}</>}
                      </div>
                      {item.belowCost && item.costPrice != null && (
                        <div className="inline-flex items-center gap-1 text-[11px] text-destructive">
                          <AlertTriangle className="h-3 w-3" />
                          低于进价 ¥{Number(item.costPrice).toFixed(2)}
                        </div>
                      )}
                    </div>
                  ),
                },
                { key: 'amount', title: '金额', width: 110, align: 'right', render: v => <span className="font-semibold tabular-nums">¥{Number(v).toFixed(2)}</span> },
              ] satisfies TableColumn<SaleOrderItem>[]}
              data={order.items ?? []}
              rowKey="id"
              emptyText="暂无商品明细"
            />
          </SectionCard>

          <SectionCard title="订单汇总" compact>
            <div className="flex items-center justify-between gap-8 text-sm">
              <p className="text-muted-foreground">共 <span className="font-medium tabular-nums text-foreground">{order.items?.length ?? 0}</span> 行商品明细</p>
              <dl className="flex items-center gap-10 text-right">
                <div><dt className="text-xs text-muted-foreground">商品金额</dt><dd className="mt-1 tabular-nums">¥{Number(order.totalAmount).toFixed(2)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">折扣金额</dt><dd className="mt-1 tabular-nums">-¥{Number(order.discountAmount ?? 0).toFixed(2)}</dd></div>
                <div className="border-l pl-8"><dt className="text-xs text-muted-foreground">订单净额</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">¥{Math.max(0, Number(order.totalAmount) - Number(order.discountAmount ?? 0)).toFixed(2)}</dd></div>
              </dl>
            </div>
          </SectionCard>
        </>
      )}

      {detailTab === 'progress' && (
        <div className="card-base p-4">
          {order.taskNo ? (
            <div className="space-y-4">
              <FulfillmentProgressCard order={order} />
              <DataTable
                columns={[
                  { key: 'productCode', title: '编码', width: 130 },
                  { key: 'articleNumber', title: '供应商型号', width: 110, render: v => (v as string) || '-' },
                  { key: 'spec', title: '型号', width: 110, render: v => (v as string) || '-' },
                  { key: 'productName', title: '名称', width: 180 },
                  { key: 'color', title: '颜色', width: 100, render: v => (v as string) || '-' },
                  { key: 'unit', title: '单位', width: 70 },
                  { key: 'quantity', title: '订单数量', width: 90, align: 'right' },
                  { key: 'picked', title: '取货数量', width: 90, align: 'right', render: v => <span className="tabular-nums">{Number(v ?? 0)}</span> },
                ] satisfies TableColumn<SaleOrderItem & { picked: number }>[]}
                data={(order.items ?? []).map(item => ({ ...item, picked: (item.scans ?? []).reduce((s, sc) => s + sc.qty, 0) }))}
                rowKey="id"
                emptyText="暂无商品明细"
              />
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">尚未创建仓库任务，订单状态为 {getSaleWorkflowStatus(order).label}</p>
          )}
        </div>
      )}

      {detailTab === 'scan' && (
        <div className="card-base p-4">
          {order.taskNo ? (
            <DataTable
              columns={[
                { key: 'productCode', title: '编码', width: 130 },
                { key: 'articleNumber', title: '供应商型号', width: 110, render: v => (v as string) || '-' },
                { key: 'spec', title: '型号', width: 110, render: v => (v as string) || '-' },
                { key: 'productName', title: '名称', width: 180 },
                { key: 'color', title: '颜色', width: 100, render: v => (v as string) || '-' },
                { key: 'unit', title: '单位', width: 70 },
                { key: 'barcode', title: '条码', width: 140 },
                { key: 'qtyLabel', title: '条码数量', width: 100 },
                { key: 'operatorName', title: '操作人', width: 110, render: v => (v as string) || '-' },
                { key: 'scannedAt', title: '操作时间', width: 150, render: v => v ? formatDisplayDateTime(v as string) : '-' },
              ] satisfies TableColumn<ScanRow>[]}
              data={(order.items ?? []).flatMap((item): ScanRow[] => {
                const scans = item.scans ?? []
                if (scans.length === 0) {
                  return [{
                    rowKey: `${item.id}`, productCode: item.productCode, articleNumber: item.articleNumber,
                    spec: item.spec, productName: item.productName, color: item.color, unit: item.unit,
                    barcode: '-', qtyLabel: `0/${item.quantity}`, operatorName: null, scannedAt: null,
                  }]
                }
                return scans.map((sc, si) => ({
                  rowKey: `${item.id}-${si}`, productCode: item.productCode, articleNumber: item.articleNumber,
                  spec: item.spec, productName: item.productName, color: item.color, unit: item.unit,
                  barcode: sc.barcode, qtyLabel: String(sc.qty), operatorName: sc.operatorName, scannedAt: sc.scannedAt,
                }))
              })}
              rowKey="rowKey"
              emptyText="暂无扫码记录"
            />
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">尚未创建仓库任务</p>
          )}
        </div>
      )}

      {detailTab === 'pack' && (
        <div className="card-base p-4">
          {order.taskNo ? (
            <div className="space-y-4">
              {(() => {
                const pkgs = order.packages ?? []
                const done = pkgs.filter(p => p.status === 2).length
                const totalLines = pkgs.reduce((sum, pkg) => sum + pkg.items.length, 0)
                return (
                  <div className="grid grid-cols-4 divide-x rounded-lg border py-3 text-sm">
                    <div className="px-4 text-center">
                      <p className="text-2xl font-semibold tabular-nums">{pkgs.length}</p>
                      <p className="text-xs text-muted-foreground">箱子总数</p>
                    </div>
                    <div className="px-4 text-center">
                      <p className="text-2xl font-semibold tabular-nums text-success">{done}</p>
                      <p className="text-xs text-muted-foreground">已完成</p>
                    </div>
                    <div className="px-4 text-center">
                      <p className="text-2xl font-semibold tabular-nums">{pkgs.length - done}</p>
                      <p className="text-xs text-muted-foreground">未完成</p>
                    </div>
                    <div className="px-4 text-center">
                      <p className="text-2xl font-semibold tabular-nums">{totalLines}</p>
                      <p className="text-xs text-muted-foreground">装箱明细行数</p>
                    </div>
                  </div>
                )
              })()}
              {(order.packages ?? []).length > 0 ? (
                (order.packages ?? []).map(pkg => (
                  <div key={pkg.id} className="rounded-lg border border-border/70 bg-card px-4 py-3">
                    <div className="mb-3 flex items-center justify-between border-b pb-3 text-sm"><span className="font-mono font-medium">{pkg.barcode}</span><SoftStatusLabel label={pkg.status === 2 ? '已完成' : '未完成'} tone={pkg.status === 2 ? 'success' : 'active'} /></div>
                    <DataTable
                      columns={[
                        { key: 'productCode', title: '编码', width: 130 },
                        { key: 'articleNumber', title: '供应商型号', width: 110, render: v => (v as string) || '-' },
                        { key: 'spec', title: '型号', width: 110, render: v => (v as string) || '-' },
                        { key: 'productName', title: '名称', width: 180 },
                        { key: 'color', title: '颜色', width: 100, render: v => (v as string) || '-' },
                        { key: 'unit', title: '单位', width: 70 },
                        { key: 'qty', title: '数量', width: 80 },
                        { key: 'packedAt', title: '操作时间', width: 150, render: v => v ? formatDisplayDateTime(v as string) : '-' },
                      ]}
                      data={pkg.items.map((it, idx) => ({ ...it, rowKey: idx }))}
                      rowKey="rowKey"
                      emptyText="暂无装箱明细"
                    />
                  </div>
                ))
              ) : (
                <p className="py-4 text-center text-sm text-muted-foreground">暂无装箱记录</p>
              )}
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">尚未创建仓库任务</p>
          )}
        </div>
      )}

      {detailTab === 'log' && (
        <div className="card-base p-4">
          {order.timeline?.length ? (
            <div className="divide-y">
              <div className="grid grid-cols-[minmax(0,1fr)_180px_140px] gap-4 px-4 pb-3 text-table-head text-sm">
                <span>事项</span>
                <span className="text-center">时间</span>
                <span className="text-right">操作人</span>
              </div>
              {order.timeline.map(event => (
                <div key={event.id} className="grid grid-cols-[minmax(0,1fr)_180px_140px] items-start gap-4 px-4 py-3 text-sm">
                  <div><p className="font-medium">{event.title}</p>{event.description && <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">{event.description}</p>}</div>
                  <span className="text-center text-muted-foreground">{formatDisplayDateTime(event.createdAt)}</span>
                  <span className="text-right text-muted-foreground">{event.createdByName || '系统'}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">暂无操作记录</p>
          )}
        </div>
      )}

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
