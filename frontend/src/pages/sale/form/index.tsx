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

import { useState, useCallback, useContext, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Clock, Loader2, PackageOpen, Pencil, Plus, Save, Warehouse, X } from 'lucide-react'
import { PrintPreviewOverlay } from '@/components/print/SaleOrderPrintTemplate'
import { Button }  from '@/components/ui/button'
import { Input }   from '@/components/ui/input'
import { Label }   from '@/components/ui/label'
import { Badge }   from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { toast } from '@/lib/toast'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { ActionBar }      from '@/components/shared/ActionBar'
import { ConfirmDialog }  from '@/components/shared/ConfirmDialog'
import ShipSelectDialog from '@/pages/sale/components/ShipSelectDialog'
import { SectionCard }    from '@/components/shared/SectionCard'
import { CustomerFinder, ProductFinder, FinderTrigger } from '@/components/finder'
import { WarehouseSelect } from '@/components/shared/WarehouseSelect'
import { useCreateSale, useUpdateSale, useAdjustSale, useSaleDetail, useReserveSale, useReleaseSale, useShipSale, useCancelSale, useDeleteSale } from '@/hooks/useSale'
import { useCarriersActive } from '@/hooks/useCarriers'
import { getSaleWorkflowStatus } from '@/lib/saleWorkflowStatus'
import { LimitedInput } from '@/components/shared/LimitedInput'
import { LimitedTextarea } from '@/components/shared/LimitedTextarea'
import DataTable from '@/components/shared/DataTable'
import type { TableColumn } from '@/types'
import { getCustomerPriceApi } from '@/api/price-lists'
import { cn } from '@/lib/utils'

const PHONE_RE = /^1\d{10}$/

function parsePositiveInteger(value: string) {
  if (!value.trim()) return 0
  const num = Number.parseInt(value, 10)
  return Number.isFinite(num) ? num : 0
}

function parsePrice(value: string) {
  if (!value.trim()) return 0
  const num = Number.parseFloat(value)
  return Number.isFinite(num) ? num : 0
}
import type { SaleOrder, SaleOrderItem } from '@/types/sale'
import type { ProductFinderResult } from '@/types/products'
import type { FinderResult } from '@/types/finder'

interface DraftItem extends Omit<SaleOrderItem, 'id' | 'amount'> {
  _key: number
  spec?: string | null
  color?: string | null
  priceSource?: 'list' | 'default' | 'manual'
}

interface ScanRow {
  rowKey: string
  productCode: string
  articleNumber?: string | null
  spec?: string | null
  productName: string
  color?: string | null
  unit: string
  barcode: string
  qtyLabel: string
  operatorName: string | null
  scannedAt: string | null
}

/** CreateView 和 EditView 共用的表单校验：通过则返回过滤后的有效明细，否则弹 toast 提示并返回 null */
function validateSaleForm(input: {
  items: DraftItem[]
  customerId: string
  customerName: string
  warehouseId: string
  warehouseName: string
  receiverPhone: string
  setCustomerError: (v: boolean) => void
  setWarehouseError: (v: boolean) => void
  setInvalidItemKeys: (v: Set<number>) => void
}): DraftItem[] | null {
  const { items, customerId, customerName, warehouseId, warehouseName, receiverPhone, setCustomerError, setWarehouseError, setInvalidItemKeys } = input
  const filledItems = items.filter(i => i.productId > 0)
  const missingCustomer = !customerId || !customerName
  const missingWarehouse = !warehouseId || !warehouseName
  setCustomerError(missingCustomer)
  setWarehouseError(missingWarehouse)
  if (missingCustomer) { toast.warning('请选择客户'); return null }
  if (missingWarehouse) { toast.warning('请选择仓库'); return null }
  if (!filledItems.length) { toast.warning('请添加至少一条明细'); return null }
  const badItemKeys = new Set(filledItems.filter(i => i.quantity <= 0 || i.unitPrice <= 0).map(i => i._key))
  setInvalidItemKeys(badItemKeys)
  if (filledItems.find(i => !Number.isInteger(i.quantity) || i.quantity <= 0)) { toast.warning('销售数量必须为大于 0 的整数'); return null }
  if (filledItems.find(i => i.unitPrice <= 0)) { toast.warning('商品价格必须大于 0'); return null }
  if (receiverPhone && !PHONE_RE.test(receiverPhone)) { toast.warning('请输入正确的手机号'); return null }
  return filledItems
}

// ─── 信息区块 ─────────────────────────────────────────────────────────────────

function FulfillmentProgressCard({ order }: { order: SaleOrder }) {
  const steps = [
    { status: 2, label: '拣货中' },
    { status: 3, label: '待分拣' },
    { status: 4, label: '待复核' },
    { status: 5, label: '待打包' },
    { status: 6, label: '待出库' },
    { status: 7, label: '已出库' },
  ]
  const current = order.warehouseTaskStatus ?? 0
  const currentIdx = steps.findIndex(s => s.status === current)
  const isCancelled = current === 8
  const isPicking = current >= 2

  // 分仓：一个订单有多个仓库任务时，改为逐仓列出各任务的仓库/状态（各仓进度可能不同），
  // 而不是只展示单个任务的步骤条。单仓订单（tasks<=1）走下面的原单任务展示。
  const tasks = order.tasks ?? []
  if (tasks.length > 1) {
    const wtTone = (s: number) => s === 7 ? 'border-success/30 bg-success/10 text-success'
      : s === 8 ? 'border-destructive/30 bg-destructive/10 text-destructive'
      : 'border-blue-200 bg-blue-50 text-blue-700'
    return (
      <div className="rounded-lg border border-border bg-card p-5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">分仓履约进度</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              该订单从 {tasks.length} 个仓库分别发货，已发 {order.shippedTotalQty ?? 0}/{order.orderedTotalQty ?? 0}
            </p>
          </div>
          {order.closedReason === 'partial_ship_close' && (
            <Badge variant="outline" className="rounded-full border-success/30 bg-success/10 text-success">部分发货结案</Badge>
          )}
        </div>
        <div className="space-y-2">
          {tasks.map(t => (
            <div key={t.taskId} className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2 text-sm">
              <div className="min-w-0">
                <span className="font-medium">{t.warehouseName || `仓库#${t.warehouseId}`}</span>
                <span className="ml-2 text-xs text-muted-foreground">{t.taskNo}</span>
                {t.shortageReportedAt && <span className="ml-2 text-xs text-destructive">缺货待处理</span>}
              </div>
              <Badge variant="outline" className={cn('rounded-full', wtTone(t.status))}>
                {t.statusName || `阶段 ${t.status}`}
              </Badge>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (!order.taskNo) return null

  return (
    <div className="rounded-lg border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">作业进度</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">仓库任务：{order.taskNo}</p>
        </div>
        {isCancelled ? (
          <Badge variant="destructive" className="rounded-full">已取消</Badge>
        ) : isPicking ? (
          <Badge variant="outline" className="rounded-full border-blue-200 bg-blue-50 text-blue-700">
            {order.warehouseTaskStatusName || `阶段 ${current}`}
          </Badge>
        ) : null}
      </div>

      {isPicking && !isCancelled && (
        <div className="flex items-center gap-1">
          {steps.map((step, idx) => {
            const isDone = idx < currentIdx
            const isCurrent = idx === currentIdx
            return (
              <div key={step.status} className="flex items-center gap-1 flex-1 last:flex-none">
                <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap ${
                  isDone ? 'bg-primary/10 text-primary'
                    : isCurrent ? 'bg-amber-50 text-amber-700 border border-amber-200'
                    : 'bg-muted/30 text-muted-foreground'
                }`}>
                  <span>{isDone ? '✓' : isCurrent ? '●' : '○'}</span>
                  <span>{step.label}</span>
                </div>
                {idx < steps.length - 1 && (
                  <div className={`h-px flex-1 min-w-[8px] ${isDone ? 'bg-primary/30' : 'bg-border'}`} />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

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
  const counterRef    = useRef((order?.items ?? []).length)
  const quantityRefs  = useRef<Map<number, HTMLInputElement>>(new Map())
  const mkEmpty = (): DraftItem => ({ _key: ++counterRef.current, productId: 0, productCode: '', productName: '', articleNumber: null, spec: null, color: null, unit: '', quantity: 1, unitPrice: 0, remark: '', priceSource: 'default', resolvedPrice: null, resolvedPriceLevel: null, costPrice: null })

  const { data: carrierOptions = [] } = useCarriersActive()

  const [items, setItems] = useState<DraftItem[]>(() =>
    (order?.items ?? []).map((item, i) => ({
      _key: i, productId: item.productId, productCode: item.productCode,
      productName: item.productName, articleNumber: item.articleNumber ?? null, spec: item.spec ?? null, color: item.color ?? null,
      unit: item.unit, quantity: item.quantity,
      warehouseId: item.warehouseId ?? null, warehouseName: item.warehouseName ?? null,
      unitPrice: item.unitPrice, remark: item.remark ?? '', priceSource: 'default' as const, costPrice: item.costPrice ?? null, resolvedPrice: null, resolvedPriceLevel: null,
    })),
  )
  // 分仓发货开关：默认关（明细行不显示仓库列，全部继承订单头仓库=单仓订单）；
  // 编辑一个本就多仓的订单时自动开启
  const [multiWarehouse, setMultiWarehouse] = useState(order?.isMultiWarehouse ?? false)
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
    ? JSON.stringify({ customerId, warehouseId, remark, carrierId, freightType, receiverName, receiverPhone, receiverAddress, items })
    : null)
  const isDirty = order
    ? JSON.stringify({ customerId, warehouseId, remark, carrierId, freightType, receiverName, receiverPhone, receiverAddress, items }) !== editSnapshotRef.current
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

  // 行级发货仓库（分仓）：同时写 id + name
  const updateItemWarehouse = (k: number, id: number | null, name: string | null) =>
    setItems(prev => prev.map(i => i._key === k ? { ...i, warehouseId: id, warehouseName: name } : i))

  async function handleFinderConfirm(product: ProductFinderResult) {
    if (finderItemKey === null) return
    const k = finderItemKey
    setItems(prev => prev.map(i => i._key === k
      ? { ...i, productId: product.id, productCode: product.code, productName: product.name, articleNumber: product.articleNumber ?? null, spec: product.spec ?? null, color: product.color ?? null, unit: product.unit, quantity: 0, unitPrice: product.salePrice ?? 0, priceSource: 'default', costPrice: product.costPrice ?? null, resolvedPrice: null, resolvedPriceLevel: null }
      : i
    ))
    // 商品选择后自动聚焦到该行数量框
    setTimeout(() => { const inp = quantityRefs.current.get(k); if (inp) { inp.focus(); inp.select() } }, 0)
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

  return {
    customerId, setCustomerId, customerName, setCustomerName,
    warehouseId, setWarehouseId, warehouseName, setWarehouseName,
    remark, setRemark, carrierId, setCarrierId, freightType, setFreightType,
    receiverName, setReceiverName, receiverPhone, setReceiverPhone, receiverAddress, setReceiverAddress,
    quantityRefs, carrierOptions,
    items, priceLoading,
    finderOpen, setFinderOpen, finderItemKey, setFinderItemKey,
    customerFinderOpen, setCustomerFinderOpen,
    customerError, setCustomerError, warehouseError, setWarehouseError,
    invalidItemKeys, setInvalidItemKeys,
    isDirty, addItem, removeItem, updateItem, updateItemWarehouse,
    multiWarehouse, setMultiWarehouse,
    handleCustomerConfirm, handleFinderConfirm,
    total,
  }
}

/** CreateView / EditView 共用的"订单信息"表单区块，字段完全一致，只是初始值和写回目标不同（由调用方通过 props 传入）。 */
function SaleOrderHeaderFields({
  customerName, customerError, setCustomerFinderOpen,
  warehouseId, setWarehouseId, setWarehouseName, warehouseError, setWarehouseError,
  carrierId, setCarrierId, carrierOptions,
  freightType, setFreightType,
  receiverName, setReceiverName,
  receiverPhone, setReceiverPhone,
  receiverAddress, setReceiverAddress,
  remark, setRemark,
}: {
  customerName: string; customerError: boolean; setCustomerFinderOpen: (v: boolean) => void
  warehouseId: string; setWarehouseId: (v: string) => void; setWarehouseName: (v: string) => void
  warehouseError: boolean; setWarehouseError: (v: boolean) => void
  carrierId: string; setCarrierId: (v: string) => void; carrierOptions: { id: number; name: string }[]
  freightType: string; setFreightType: (v: string) => void
  receiverName: string; setReceiverName: (v: string) => void
  receiverPhone: string; setReceiverPhone: (v: string) => void
  receiverAddress: string; setReceiverAddress: (v: string) => void
  remark: string; setRemark: (v: string) => void
}) {
  const navigate = useNavigate()
  return (
    <SectionCard title="订单信息" compact>
      {/* 第一行：客户/仓库/承运商/运费方式——选择类字段，按可用宽度均分，不留死区 */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
        <div className="space-y-1.5">
          <Label>客户 *</Label>
          <FinderTrigger value={customerName} placeholder="点击选择客户..." onClick={() => setCustomerFinderOpen(true)} onDoubleClick={() => { setCustomerFinderOpen(false); navigate('/customers') }} className={cn(customerError && 'border-destructive/60 bg-destructive/5')} />
        </div>
        <div className="space-y-1.5">
          <Label>出库仓库 *</Label>
          <WarehouseSelect
            value={warehouseId ? +warehouseId : null}
            onChange={(id, name) => { setWarehouseId(id ? String(id) : ''); setWarehouseName(name); setWarehouseError(false) }}
            placeholder="选择仓库"
            className={cn(warehouseError && 'border-destructive/60 bg-destructive/5')}
          />
        </div>
        <div className="space-y-1.5">
          <Label>承运商</Label>
          <Select value={carrierId || '__none__'} onValueChange={v => setCarrierId(v === '__none__' ? '' : v)}>
            <SelectTrigger className="h-10 w-full">
              <SelectValue placeholder={carrierOptions.length === 0 ? '暂无承运商，请先创建' : '请选择承运商'} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">{carrierOptions.length === 0 ? '暂无承运商，请先创建' : '请选择承运商'}</SelectItem>
              {carrierOptions.map(c => (
                <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>运费方式</Label>
          <Select value={freightType || '__none__'} onValueChange={v => setFreightType(v === '__none__' ? '' : v)}>
            <SelectTrigger className="h-10 w-full">
              <SelectValue placeholder="请选择" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">请选择</SelectItem>
              <SelectItem value="1">寄付</SelectItem>
              <SelectItem value="2">到付</SelectItem>
              <SelectItem value="3">第三方付</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {/* 第二行：收货人/联系电话给够宽度装下字符计数角标，收货地址/备注均分剩余宽度 */}
      <div className="mt-4 flex items-start gap-4">
        <div className="w-40 shrink-0 space-y-1.5">
          <Label>收货人</Label>
          <LimitedInput maxLength={5} value={receiverName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReceiverName(e.target.value)} placeholder="请输入收货人" />
        </div>
        <div className="w-48 shrink-0 space-y-1.5">
          <Label>联系电话</Label>
          <LimitedInput maxLength={11} value={receiverPhone} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReceiverPhone(e.target.value)} placeholder="11位手机号" inputMode="numeric" />
        </div>
        <div className="flex-1 space-y-1.5">
          <Label>收货地址</Label>
          <LimitedTextarea maxLength={30} value={receiverAddress} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setReceiverAddress(e.target.value)} placeholder="请输入详细收货地址" rows={1} className="h-10 min-h-0 py-2 pb-2" />
        </div>
        <div className="flex-1 space-y-1.5">
          <Label>备注</Label>
          <Input maxLength={50} value={remark} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRemark(e.target.value)} placeholder="选填" />
        </div>
      </div>
    </SectionCard>
  )
}

/** CreateView / EditView 共用的可编辑商品明细表格（数量/单价输入 + 行内选品 + 删除行），与采购单/退货单/调拨单同款结构。 */
function SaleOrderItemsTable({
  items, invalidItemKeys, quantityRefs, priceLoading,
  setFinderItemKey, setFinderOpen, updateItem, removeItem,
  multiWarehouse = false, defaultWarehouseId = null, updateItemWarehouse,
}: {
  items: DraftItem[]
  invalidItemKeys: Set<number>
  quantityRefs: React.MutableRefObject<Map<number, HTMLInputElement>>
  priceLoading: Record<number, boolean>
  setFinderItemKey: (k: number | null) => void
  setFinderOpen: (v: boolean) => void
  updateItem: (k: number, field: string, val: string | number) => void
  removeItem: (k: number) => void
  multiWarehouse?: boolean
  defaultWarehouseId?: number | null
  updateItemWarehouse?: (k: number, id: number | null, name: string | null) => void
}) {
  const navigate = useNavigate()
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-table-head">
            <th className="w-28 pb-2 text-left">编码</th>
            <th className="w-20 pb-2 text-left">货号</th>
            <th className="w-20 pb-2 text-left">型号</th>
            <th className="pb-2 text-left">商品</th>
            <th className="w-20 pb-2 text-left">颜色</th>
            <th className="w-16 pb-2 text-center">单位</th>
            {multiWarehouse && <th className="w-40 pb-2 text-left">发货仓库</th>}
            <th className="w-20 pb-2 text-right">数量</th>
            <th className="w-24 pb-2 text-right">单价 (¥)</th>
            <th className="w-28 pb-2 text-right">金额</th>
            <th className="w-10 pb-2" />
          </tr>
        </thead>
        <tbody>
          {items.map(item => (
            <tr key={item._key} className="border-b border-border/40">
              <td className="py-2.5 text-doc-code-muted">{item.productCode || '—'}</td>
              <td className="py-2.5 text-muted-foreground">{item.articleNumber || '—'}</td>
              <td className="py-2.5 text-muted-foreground">{item.spec || '—'}</td>
              <td className="py-2.5 pr-3">
                <button
                  type="button"
                  onClick={() => { setFinderItemKey(item._key); setFinderOpen(true) }}
                  onDoubleClick={() => { setFinderOpen(false); setFinderItemKey(null); navigate('/products') }}
                  className={cn('block w-full overflow-hidden rounded-md border border-border bg-background px-3 py-2 text-left text-sm transition-colors hover:border-primary hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', invalidItemKeys.has(item._key) && 'border-destructive/60 bg-destructive/5')}
                >
                  {item.productName
                    ? <span className="truncate font-medium">{item.productName}</span>
                    : <span className="text-muted-foreground">点击选择商品...</span>}
                </button>
              </td>
              <td className="py-2.5 text-muted-foreground">{item.color || '—'}</td>

              <td className="py-2.5 text-center text-muted-body">{item.unit || '—'}</td>

              {multiWarehouse && (
                <td className="py-2.5 pr-2">
                  <WarehouseSelect
                    value={item.warehouseId ?? defaultWarehouseId}
                    onChange={(id, name) => updateItemWarehouse?.(item._key, id, name)}
                    placeholder="继承默认仓库"
                    className="h-9 text-sm"
                  />
                </td>
              )}

              <td className="py-2.5 pr-2">
                <Input
                  type="number" min="1" step="1" placeholder="数量"
                  value={item.quantity}
                  ref={(el: HTMLInputElement | null) => { if (el) quantityRefs.current.set(item._key, el); else quantityRefs.current.delete(item._key) }}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateItem(item._key, 'quantity', parsePositiveInteger(e.target.value))}
                  className="text-right text-sm"
                />
              </td>

              <td className="py-2.5">
                <Input
                  type="number" min="0" step="0.01" placeholder="单价"
                  value={item.unitPrice}
                  disabled={!!priceLoading[item._key]}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateItem(item._key, 'unitPrice', parsePrice(e.target.value))}
                  className={`text-right text-sm ${item.priceSource === 'list' ? 'border-blue-300 bg-blue-50/80' : item.priceSource === 'manual' ? 'border-amber-300 bg-amber-50/70' : ''}`}
                />
              </td>

              <td className="py-2.5 text-right font-medium tabular-nums">
                ¥{(item.quantity * item.unitPrice).toFixed(2)}
              </td>

              <td className="py-2.5 text-center">
                <Button
                  type="button" size="sm" variant="ghost"
                  className="h-8 w-9 p-0 text-muted-foreground hover:text-destructive"
                  onClick={() => removeItem(item._key)}
                >✕</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
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
    quantityRefs, carrierOptions,
    items, priceLoading,
    finderOpen, setFinderOpen, setFinderItemKey,
    customerFinderOpen, setCustomerFinderOpen,
    customerError, setCustomerError, warehouseError, setWarehouseError,
    invalidItemKeys, setInvalidItemKeys,
    isDirty, addItem, removeItem, updateItem, updateItemWarehouse,
    multiWarehouse, setMultiWarehouse,
    handleCustomerConfirm, handleFinderConfirm,
    total,
  } = useSaleOrderForm(tabPath)

  async function handleSubmit() {
    const filledItems = validateSaleForm({
      items, customerId, customerName, warehouseId, warehouseName, receiverPhone,
      setCustomerError, setWarehouseError, setInvalidItemKeys,
    })
    if (!filledItems) return
    try {
      await createMutate.mutateAsync({
        customerId: +customerId, customerName,
        warehouseId: +warehouseId, warehouseName,
        remark: remark || undefined,
        carrierId: carrierId ? +carrierId : null,
        freightType: freightType ? +freightType : null,
        receiverName: receiverName || undefined,
        receiverPhone: receiverPhone || undefined,
        receiverAddress: receiverAddress || undefined,
        items: filledItems.map(({ _key, ...r }) => r),
      })
      closeTab()
    } catch (_) {}
  }

  return (
    <div className="flex flex-col gap-3">
      <ActionBar
        title="新建销售单"
        subtitle={isDirty ? <span className="text-xs font-normal text-muted-foreground">未保存</span> : undefined}
        rightActions={
          <>

            <Button onClick={handleSubmit} disabled={createMutate.isPending} className="gap-1.5">
              {createMutate.isPending
                ? <><Loader2 className="h-4 w-4 animate-spin" />保存中...</>
                : <><Save className="h-4 w-4" />保存草稿</>}
            </Button>
          </>
        }
      />

      <SaleOrderHeaderFields
        customerName={customerName} customerError={customerError} setCustomerFinderOpen={setCustomerFinderOpen}
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
      <SectionCard
        title="商品明细"
        compact
        actions={
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground select-none cursor-pointer">
              <input type="checkbox" className="h-3.5 w-3.5" checked={multiWarehouse}
                onChange={e => setMultiWarehouse(e.target.checked)} />
              分仓发货（不同商品从不同仓库发）
            </label>
            <Button type="button" size="sm" variant="outline" onClick={addItem} className="gap-1.5">
              <Plus className="h-4 w-4" />
              添加商品
            </Button>
          </div>
        }
      >
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-12 text-center">
            <PackageOpen className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">还没有商品明细，点击上方"添加商品"开始录入</p>
          </div>
        ) : (
          <>
          <SaleOrderItemsTable
            items={items} invalidItemKeys={invalidItemKeys} quantityRefs={quantityRefs} priceLoading={priceLoading}
            setFinderItemKey={setFinderItemKey} setFinderOpen={setFinderOpen}
            updateItem={updateItem} removeItem={removeItem}
            multiWarehouse={multiWarehouse} updateItemWarehouse={updateItemWarehouse}
            defaultWarehouseId={warehouseId ? +warehouseId : null}
          />

          {/* 金额统计：仅统计已选商品的行 */}
          {items.some(i => i.productId > 0) && (
            <div className="mt-2 flex items-center justify-between border-t border-border pt-4">
              <div className="space-y-0.5 text-muted-body">
                <p>商品种数：{items.filter(i => i.productId > 0).length} 种　合计数量：{items.filter(i => i.productId > 0).reduce((s, i) => s + i.quantity, 0)}</p>
                {items.some(i => i.productId > 0 && i.costPrice != null && i.unitPrice < Number(i.costPrice)) && (
                  <p className="inline-flex items-center gap-1 text-destructive">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    存在低于进价的销售行，提交后会记录到时间线
                  </p>
                )}
              </div>
              <div className="text-right">
                <p className="text-helper">合计金额</p>
                <p className="text-2xl font-semibold text-foreground">¥{total.toFixed(2)}</p>
              </div>
            </div>
          )}
          </>
        )}
      </SectionCard>

      {/* 商品选择中心 */}
      <ProductFinder
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
    quantityRefs, carrierOptions,
    items, priceLoading,
    finderOpen, setFinderOpen, setFinderItemKey,
    customerFinderOpen, setCustomerFinderOpen,
    customerError, setCustomerError, warehouseError, setWarehouseError,
    invalidItemKeys, setInvalidItemKeys,
    addItem, removeItem, updateItem, updateItemWarehouse,
    multiWarehouse, setMultiWarehouse,
    handleCustomerConfirm, handleFinderConfirm,
    total,
  } = useSaleOrderForm(tabPath, order)

  async function handleSubmit() {
    const filledItems = validateSaleForm({
      items, customerId, customerName, warehouseId, warehouseName, receiverPhone,
      setCustomerError, setWarehouseError, setInvalidItemKeys,
    })
    if (!filledItems) return
    try {
      await updateMutate.mutateAsync({
        id: order.id,
        customerId: +customerId, customerName,
        warehouseId: +warehouseId, warehouseName,
        remark: remark || undefined,
        carrierId: carrierId ? +carrierId : null,
        freightType: freightType ? +freightType : null,
        receiverName: receiverName || undefined,
        receiverPhone: receiverPhone || undefined,
        receiverAddress: receiverAddress || undefined,
        items: filledItems.map(({ _key, ...r }) => r),
      })
      onDone()
    } catch (_) {}
  }

  return (
    <div className="flex flex-col gap-3">
      <ActionBar
        title={`${order.orderNo} · 编辑`}
        rightActions={
          <>
            <Button variant="outline" onClick={onDone} disabled={updateMutate.isPending}>
              取消编辑
            </Button>
            <Button onClick={handleSubmit} disabled={updateMutate.isPending} className="gap-1.5">
              {updateMutate.isPending
                ? <><Loader2 className="h-4 w-4 animate-spin" />保存中...</>
                : <><Save className="h-4 w-4" />保存</>}
            </Button>
          </>
        }
      />

      <SaleOrderHeaderFields
        customerName={customerName} customerError={customerError} setCustomerFinderOpen={setCustomerFinderOpen}
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
      <SectionCard
        title="商品明细"
        compact
        actions={
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground select-none cursor-pointer">
              <input type="checkbox" className="h-3.5 w-3.5" checked={multiWarehouse}
                onChange={e => setMultiWarehouse(e.target.checked)} />
              分仓发货（不同商品从不同仓库发）
            </label>
            <Button type="button" size="sm" variant="outline" onClick={addItem} className="gap-1.5">
              <Plus className="h-4 w-4" />
              添加商品
            </Button>
          </div>
        }
      >
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-12 text-center">
            <PackageOpen className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">还没有商品明细，点击上方"添加商品"开始录入</p>
          </div>
        ) : (
          <SaleOrderItemsTable
            items={items} invalidItemKeys={invalidItemKeys} quantityRefs={quantityRefs} priceLoading={priceLoading}
            setFinderItemKey={setFinderItemKey} setFinderOpen={setFinderOpen}
            updateItem={updateItem} removeItem={removeItem}
            multiWarehouse={multiWarehouse} updateItemWarehouse={updateItemWarehouse}
            defaultWarehouseId={warehouseId ? +warehouseId : null}
          />
        )}
      </SectionCard>

      {/* 金额统计：仅统计已选商品的行 */}
      {items.some(i => i.productId > 0) && (
        <SectionCard title="金额统计">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5 text-muted-body">
              <p>商品种数：{items.filter(i => i.productId > 0).length} 种</p>
              <p>合计数量：{items.filter(i => i.productId > 0).reduce((s, i) => s + i.quantity, 0)}</p>
              {items.some(i => i.productId > 0 && i.costPrice != null && i.unitPrice < Number(i.costPrice)) && (
                <p className="inline-flex items-center gap-1 text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  存在低于进价的销售行，保存后会记录到时间线
                </p>
              )}
            </div>
            <div>
              <p className="mb-1 text-xs">合计金额</p>
              <p className="text-3xl font-bold text-foreground">¥{total.toFixed(2)}</p>
            </div>
          </div>
        </SectionCard>
      )}

      <ProductFinder
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
// 改单视图（已占库/拣货中，仓库任务已存在——增减数量/加删商品行）
// ════════════════════════════════════════════════════════════════════════════

/**
 * 执行期改单：status∈{2,3} 且已发起出库（有关联仓库任务）时可用。提交后若涉及
 * 已拣/已打包实物的归还（pending=true），后端会把任务挂起等待 PDA 扫码确认，
 * 这里只需提示、不阻塞——具体进度请去 PDA「改单确认」查看。
 */
function AdjustView({ order, tabPath, onDone }: { order: NonNullable<ReturnType<typeof useSaleDetail>['data']>; tabPath: string; onDone: () => void }) {
  const adjustMutate = useAdjustSale()

  const {
    customerId, customerName,
    warehouseId, setWarehouseId, warehouseName, setWarehouseName,
    remark, setRemark, carrierId, setCarrierId, freightType, setFreightType,
    receiverName, setReceiverName, receiverPhone, setReceiverPhone, receiverAddress, setReceiverAddress,
    quantityRefs, carrierOptions,
    items, priceLoading,
    finderOpen, setFinderOpen, setFinderItemKey,
    customerFinderOpen, setCustomerFinderOpen,
    customerError, setCustomerError, warehouseError, setWarehouseError,
    invalidItemKeys, setInvalidItemKeys,
    addItem, removeItem, updateItem,
    handleCustomerConfirm, handleFinderConfirm,
    total,
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
        carrierId: carrierId ? +carrierId : null,
        freightType: freightType ? +freightType : null,
        receiverName: receiverName || undefined,
        receiverPhone: receiverPhone || undefined,
        receiverAddress: receiverAddress || undefined,
        items: filledItems.map(({ _key, ...r }) => r),
      })
      onDone()
    } catch (_) {}
  }

  return (
    <div className="flex flex-col gap-3">
      <ActionBar
        title={`${order.orderNo} · 修改订单`}
        rightActions={
          <>
            <Button variant="outline" onClick={onDone} disabled={adjustMutate.isPending}>
              <X className="h-4 w-4 mr-1" />取消
            </Button>
            <Button onClick={handleSubmit} disabled={adjustMutate.isPending} className="gap-1.5">
              {adjustMutate.isPending
                ? <><Loader2 className="h-4 w-4 animate-spin" />提交中...</>
                : <><Save className="h-4 w-4" />提交改单</>}
            </Button>
          </>
        }
      />

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        订单已发往仓库执行，增加数量需要重新拣货；减少数量若涉及已拣/已打包的实物，需要仓库扫码确认放回库位/拆箱后才会真正生效。
      </div>

      <SaleOrderHeaderFields
        customerName={customerName} customerError={customerError} setCustomerFinderOpen={setCustomerFinderOpen}
        warehouseId={warehouseId} setWarehouseId={setWarehouseId} setWarehouseName={setWarehouseName}
        warehouseError={warehouseError} setWarehouseError={setWarehouseError}
        carrierId={carrierId} setCarrierId={setCarrierId} carrierOptions={carrierOptions}
        freightType={freightType} setFreightType={setFreightType}
        receiverName={receiverName} setReceiverName={setReceiverName}
        receiverPhone={receiverPhone} setReceiverPhone={setReceiverPhone}
        receiverAddress={receiverAddress} setReceiverAddress={setReceiverAddress}
        remark={remark} setRemark={setRemark}
      />

      <SectionCard
        title="商品明细"
        compact
        actions={
          <Button type="button" size="sm" variant="outline" onClick={addItem} className="gap-1.5">
            <Plus className="h-4 w-4" />
            添加商品
          </Button>
        }
      >
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-12 text-center">
            <PackageOpen className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">还没有商品明细，点击上方"添加商品"开始录入</p>
          </div>
        ) : (
          <SaleOrderItemsTable
            items={items} invalidItemKeys={invalidItemKeys} quantityRefs={quantityRefs} priceLoading={priceLoading}
            setFinderItemKey={setFinderItemKey} setFinderOpen={setFinderOpen}
            updateItem={updateItem} removeItem={removeItem}
          />
        )}
      </SectionCard>

      {items.some(i => i.productId > 0) && (
        <SectionCard title="金额统计">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5 text-muted-body">
              <p>商品种数：{items.filter(i => i.productId > 0).length} 种</p>
              <p>合计数量：{items.filter(i => i.productId > 0).reduce((s, i) => s + i.quantity, 0)}</p>
            </div>
            <div>
              <p className="mb-1 text-xs">合计金额</p>
              <p className="text-3xl font-bold text-foreground">¥{total.toFixed(2)}</p>
            </div>
          </div>
        </SectionCard>
      )}

      <ProductFinder
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
  const releaseMutate  = useReleaseSale()
  const shipMutate     = useShipSale()
  const deleteMutate   = useDeleteSale()
  const cancelMutate   = useCancelSale()
  const reserveMutate  = useReserveSale()

  const [printOpen, setPrintOpen] = useState(false)
  const [detailTab, setDetailTab] = useState<'info'|'progress'|'scan'|'pack'|'log'>('info')
  const [adjustMode, setAdjustMode] = useState(false)
  const [editing, setEditing] = useState(false)
  const [shipDialogOpen, setShipDialogOpen] = useState(false)

  const [confirmState, setConfirmState] = useState<{
    open: boolean; title: string; description: string; variant: 'default' | 'destructive'; confirmText: string; onConfirm: () => void
  }>({ open: false, title: '', description: '', variant: 'default', confirmText: '确认', onConfirm: () => {} })

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center text-muted-body">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />加载中...
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

  const isPending = releaseMutate.isPending || shipMutate.isPending || deleteMutate.isPending || cancelMutate.isPending || reserveMutate.isPending
  // 分仓/分批：多仓订单、或已有部分发货的订单，明细已锁定（后端拒绝改单），不进改单视图
  const canAdjust = (order.status === 2 || order.status === 3) && !!order.taskId
    && !order.warehouseTaskCancelRequestedAt && !order.warehouseTaskAdjustmentRequestedAt
    && !order.isMultiWarehouse && (order.shippedTotalQty ?? 0) === 0

  return (
    <div className="flex flex-col gap-3">
      <ActionBar
        title={order.orderNo}
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
            {(order.status === 1 || order.status === 2 || order.status === 3) && (
              <Button variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/5" disabled={isPending}
                onClick={() => setConfirmState({
                  open: true, title: '取消订单',
                  description: order.status === 3
                    ? '将同步取消关联仓库任务并释放锁定资源，是否继续？'
                    : order.status === 2
                      ? '将释放已占用库存并取消销售单，是否继续？'
                      : '取消后订单将变为已取消状态，是否继续？',
                  variant: 'destructive', confirmText: '确认取消',
                  onConfirm: () => { setConfirmState(s => ({ ...s, open: false })); cancelMutate.mutate(order.id) },
                })}>
                <X className="h-4 w-4 mr-1" />取消订单
              </Button>
            )}
            {order.status === 1 && (
              <Button variant="outline" disabled={isPending}
                onClick={() => setConfirmState({
                  open: true, title: '占用库存', description: '将预占该销售单所需库存，可用量减少，是否继续？', variant: 'default', confirmText: '占用库存',
                  onConfirm: () => { setConfirmState(s => ({ ...s, open: false })); reserveMutate.mutate(order.id) },
                })}>
                <Warehouse className="h-4 w-4 mr-1" />占用库存
              </Button>
            )}
            {order.status === 2 && (
              <Button variant="outline" disabled={isPending}
                onClick={() => setConfirmState({
                  open: true, title: '取消占库', description: '将释放已预占的库存并将订单恢复为草稿状态，是否继续？', variant: 'default', confirmText: '取消占库',
                  onConfirm: () => { setConfirmState(s => ({ ...s, open: false })); releaseMutate.mutate(order.id) },
                })}>
                <Warehouse className="h-4 w-4 mr-1" />取消占库
              </Button>
            )}
            {order.status === 4 && (
              <Button variant="outline" onClick={() => setPrintOpen(true)}>打印订单</Button>
            )}
            {order.status === 2 && (
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

      {order.warehouseTaskAdjustmentRequestedAt && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <Clock className="h-4 w-4 shrink-0" />
          改单待仓库确认：有商品的归还/拆箱还未经 PDA 扫码确认，确认完成前该订单的拣货/分拣/复核/打包/出库都会被阻止，也暂时不能再次修改订单。
        </div>
      )}

      {/* 选项卡切换 */}
      <div className="flex gap-1 rounded-lg border border-border bg-muted/30 p-1">
        {([
          ['info', '订单信息'],
          ['progress', '作业进度'],
          ['scan', '取货明细'],
          ['pack', '装箱进度'],
          ['log', '操作记录'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setDetailTab(key)}
            className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
              detailTab === key
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {detailTab === 'info' && (
        <>
          {/* 基础信息 */}
          <SectionCard title="基础信息" compact>
            <div className="space-y-2 text-sm">
              <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-x-8 gap-y-3">
                <div><span className="text-muted-foreground">客户：</span><span>{order.customerName}</span></div>
                <div><span className="text-muted-foreground">仓库：</span><span>{order.warehouseName}</span></div>
                <div><span className="text-muted-foreground">时间：</span><span>{formatDisplayDateTime(order.createdAt)}</span></div>
                <div><span className="text-muted-foreground">经办人：</span><span>{order.operatorName}</span></div>
                <div><span className="text-muted-foreground">承运商：</span><span>{order.carrier || '-'}</span></div>
                <div><span className="text-muted-foreground">运费方式：</span><span>{order.freightTypeName || '-'}</span></div>
                <div><span className="text-muted-foreground">收货人：</span><span>{order.receiverName || '-'}</span></div>
                <div><span className="text-muted-foreground">联系电话：</span><span>{order.receiverPhone || '-'}</span></div>
                <div className="col-span-2"><span className="text-muted-foreground">收货地址：</span><span>{order.receiverAddress || '-'}</span></div>
                <div><span className="text-muted-foreground">备注：</span><span>{order.remark || '-'}</span></div>
              </div>
            </div>
          </SectionCard>

          {/* 商品明细 */}
          <SectionCard title="商品明细" compact>
            <DataTable
              columns={[
                { key: 'productCode', title: '编码', width: 130 },
                { key: 'articleNumber', title: '货号', width: 110, render: v => (v as string) || '-' },
                { key: 'spec', title: '型号', width: 110, render: v => (v as string) || '-' },
                { key: 'productName', title: '名称', width: 180 },
                { key: 'color', title: '颜色', width: 100, render: v => (v as string) || '-' },
                { key: 'unit', title: '单位', width: 70, render: v => <span className="text-center">{String(v)}</span> },
                // 分仓订单：展示每行的发货仓库
                ...(order.isMultiWarehouse ? [{
                  key: 'warehouseName' as const, title: '发货仓库', width: 120,
                  render: (v: unknown) => <span className="text-sm">{(v as string) || order.warehouseName || '-'}</span>,
                }] : []),
                { key: 'quantity', title: '数量', width: 90, render: v => <span className="tabular-nums">{String(v)}</span> },
                // 进入履约后展示已发/应发进度
                ...((order.shippedTotalQty ?? 0) > 0 || order.status >= 3 ? [{
                  key: 'shippedQty' as const, title: '已发/应发', width: 100,
                  render: (v: unknown, item: SaleOrderItem) => {
                    const shipped = Number(v ?? 0)
                    const done = shipped >= item.quantity
                    return <span className={cn('tabular-nums', done ? 'text-success' : shipped > 0 ? 'text-primary' : 'text-muted-foreground')}>{shipped}/{item.quantity}</span>
                  },
                }] : []),
                {
                  key: 'unitPrice', title: '单价', width: 130,
                  render: (v, item) => (
                    <div className="space-y-1">
                      <div className="tabular-nums">¥{Number(v).toFixed(2)}</div>
                      {item.belowCost && item.costPrice != null && (
                        <div className="inline-flex items-center gap-1 text-[11px] text-destructive">
                          <AlertTriangle className="h-3 w-3" />
                          低于进价 ¥{Number(item.costPrice).toFixed(2)}
                        </div>
                      )}
                    </div>
                  ),
                },
                { key: 'amount', title: '金额', width: 110, render: v => <span className="font-semibold tabular-nums">¥{Number(v).toFixed(2)}</span> },
              ] satisfies TableColumn<SaleOrderItem>[]}
              data={order.items ?? []}
              rowKey="id"
              emptyText="暂无商品明细"
            />
          </SectionCard>

          {/* 金额统计 */}
          <SectionCard title="金额统计">
            <div className="flex items-center justify-between">
              <p className="text-sm">共 {order.items?.length ?? 0} 种商品</p>
              <div><p className="mb-1 text-xs">合计金额</p><p className="text-3xl font-bold">¥{Number(order.totalAmount).toFixed(2)}</p></div>
            </div>
          </SectionCard>
        </>
      )}

      {detailTab === 'progress' && (
        <div className="card-base p-5">
          {order.taskNo ? (
            <div className="space-y-4">
              <FulfillmentProgressCard order={order} />
              <DataTable
                columns={[
                  { key: 'productCode', title: '编码', width: 130 },
                  { key: 'articleNumber', title: '货号', width: 110, render: v => (v as string) || '-' },
                  { key: 'spec', title: '型号', width: 110, render: v => (v as string) || '-' },
                  { key: 'productName', title: '名称', width: 180 },
                  { key: 'color', title: '颜色', width: 100, render: v => (v as string) || '-' },
                  { key: 'unit', title: '单位', width: 70 },
                  { key: 'quantity', title: '订单数量', width: 90 },
                  { key: 'picked', title: '取货数量', width: 90, render: v => (v as number) || '-' },
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
        <div className="card-base p-5">
          {order.taskNo ? (
            <DataTable
              columns={[
                { key: 'productCode', title: '编码', width: 130 },
                { key: 'articleNumber', title: '货号', width: 110, render: v => (v as string) || '-' },
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
        <div className="card-base p-5">
          {order.taskNo ? (
            <div className="space-y-4">
              {(() => {
                const pkgs = order.packages ?? []
                const done = pkgs.filter(p => p.status === 2).length
                const totalItems = pkgs.reduce((s, p) => s + p.items.reduce((ss, it) => ss + it.qty, 0), 0)
                return (
                  <div className="grid grid-cols-4 gap-3 text-sm">
                    <div className="rounded-lg border bg-muted/30 p-3 text-center">
                      <p className="text-2xl font-bold">{pkgs.length}</p>
                      <p className="text-xs text-muted-foreground">箱子总数</p>
                    </div>
                    <div className="rounded-lg border bg-muted/30 p-3 text-center">
                      <p className="text-2xl font-bold text-success">{done}</p>
                      <p className="text-xs text-muted-foreground">已完成</p>
                    </div>
                    <div className="rounded-lg border bg-muted/30 p-3 text-center">
                      <p className="text-2xl font-bold">{pkgs.length - done}</p>
                      <p className="text-xs text-muted-foreground">未完成</p>
                    </div>
                    <div className="rounded-lg border bg-muted/30 p-3 text-center">
                      <p className="text-2xl font-bold">{totalItems}</p>
                      <p className="text-xs text-muted-foreground">装箱总件</p>
                    </div>
                  </div>
                )
              })()}
              {(order.packages ?? []).length > 0 ? (
                (order.packages ?? []).map(pkg => (
                  <div key={pkg.id} className="rounded-lg border border-border/70 bg-card px-4 py-3">
                    <div className="mb-2 text-sm font-medium">{pkg.barcode}</div>
                    <DataTable
                      columns={[
                        { key: 'productCode', title: '编码', width: 130 },
                        { key: 'articleNumber', title: '货号', width: 110, render: v => (v as string) || '-' },
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
        <div className="card-base p-5">
          {order.timeline?.length ? (
            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_auto_1fr] gap-4 border-b pb-2 text-table-head text-sm">
                <span>事项</span>
                <span className="text-center">时间</span>
                <span className="text-right">操作人</span>
              </div>
              {order.timeline.map(event => (
                <div key={event.id} className="grid grid-cols-[1fr_auto_1fr] gap-4 items-center rounded-lg border border-border/70 bg-card px-4 py-3 text-sm">
                  <span>{event.title}</span>
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
        onConfirm={(itemIds) => {
          shipMutate.mutate({ id: order.id, itemIds }, { onSuccess: () => setShipDialogOpen(false) })
        }}
      />
    </div>
  )
}
