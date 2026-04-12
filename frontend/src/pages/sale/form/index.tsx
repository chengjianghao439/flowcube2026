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
import { AlertTriangle, Loader2, Printer, Save, Trash2, Truck, Warehouse, X } from 'lucide-react'
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
import { StatusBadge }    from '@/components/shared/StatusBadge'
import { ConfirmDialog }  from '@/components/shared/ConfirmDialog'
import { FocusModePanel } from '@/components/shared/FocusModePanel'
import { CustomerFinder, WarehouseFinder, ProductFinder, FinderTrigger } from '@/components/finder'
import { useCreateSale, useUpdateSale, useSaleDetail, useReserveSale, useReleaseSale, useShipSale, useCancelSale, useDeleteSale } from '@/hooks/useSale'
import { useCarriersActive } from '@/hooks/useCarriers'
import { LimitedInput } from '@/components/shared/LimitedInput'
import { LimitedTextarea } from '@/components/shared/LimitedTextarea'
import { getCustomerPriceApi } from '@/api/price-lists'

const PHONE_RE = /^1\d{10}$/
import type { SaleOrderItem } from '@/types/sale'
import type { ProductFinderResult } from '@/types/products'
import type { FinderResult } from '@/types/finder'

interface DraftItem extends Omit<SaleOrderItem, 'id' | 'amount'> {
  _key: number
  priceSource?: 'list' | 'default' | 'manual'
}

function PriceMetaHint({ item, loading = false }: { item: DraftItem; loading?: boolean }) {
  const belowCost = item.costPrice != null && item.costPrice > 0 && item.unitPrice < item.costPrice
  const label =
    item.priceSource === 'list'
      ? (item.resolvedPriceLevel ? `等级价 ${item.resolvedPriceLevel}` : '等级价')
      : item.priceSource === 'manual'
        ? '手工价'
        : '默认价'
  const badgeClass =
    item.priceSource === 'list'
      ? 'border-blue-200 bg-blue-50 text-blue-700'
      : item.priceSource === 'manual'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : 'border-slate-200 bg-slate-50 text-slate-600'

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <Badge variant="outline" className={badgeClass}>{label}</Badge>
      {loading && <span className="text-[11px] text-blue-600">查询等级价中...</span>}
      {!loading && item.priceSource === 'manual' && item.resolvedPrice != null && (
        <span className="text-[11px] text-muted-foreground">参考等级价 ¥{Number(item.resolvedPrice).toFixed(2)}</span>
      )}
      {belowCost && (
        <span className="inline-flex items-center gap-1 text-[11px] text-destructive">
          <AlertTriangle className="h-3 w-3" />
          低于进价 ¥{Number(item.costPrice).toFixed(2)}
        </span>
      )}
    </div>
  )
}

// ─── 信息区块 ─────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card-base p-5">
      <h3 className="text-section-title mb-4 pb-2 border-b border-border/50">{title}</h3>
      {children}
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
    const { removeTab, tabs } = useWorkspaceStore.getState()
    const nextKey = removeTab(tabPath || '/sale/new')
    const nextTab = tabs.find(t => t.key === nextKey)
    navigate(nextTab?.path ?? '/sale')
  }

  // ─── ① 新建模式 ─────────────────────────────────────────────────────────────

  if (isNew) return <CreateView closeTab={closeTab} tabPath={tabPath} />

  // ─── ② 查看模式 ─────────────────────────────────────────────────────────────

  if (!saleId) {
    return (
      <div className="flex h-40 flex-col items-center justify-center gap-3 text-muted-foreground">
        <p className="text-muted-body">销售单路由无效，请从列表重新打开</p>
        <Button size="sm" variant="outline" onClick={closeTab}>关闭页面</Button>
      </div>
    )
  }

  return <DetailView saleId={saleId} tabPath={tabPath} closeTab={closeTab} />
}

// ════════════════════════════════════════════════════════════════════════════
// 新建视图
// ════════════════════════════════════════════════════════════════════════════

function CreateView({ closeTab, tabPath }: { closeTab: () => void; tabPath: string }) {
  const navigate     = useNavigate()
  const createMutate = useCreateSale()

  const [customerId,      setCustomerId]      = useState('')
  const [customerName,    setCustomerName]    = useState('')
  const [warehouseId,     setWarehouseId]     = useState('')
  const [warehouseName,   setWarehouseName]   = useState('')
  const [remark,          setRemark]          = useState('')
  const [carrierId,       setCarrierId]       = useState<string>('')
  const [freightType,     setFreightType]     = useState('')
  const [receiverName,    setReceiverName]    = useState('')
  const [receiverPhone,   setReceiverPhone]   = useState('')
  const [receiverAddress, setReceiverAddress] = useState('')
  const counterRef    = useRef(0)
  const quantityRefs  = useRef<Map<number, HTMLInputElement>>(new Map())
  const mkEmpty = (): DraftItem => ({ _key: ++counterRef.current, productId: 0, productCode: '', productName: '', unit: '', quantity: 1, unitPrice: 0, remark: '', priceSource: 'default', resolvedPrice: null, resolvedPriceLevel: null, costPrice: null })

  const { data: carrierOptions = [] } = useCarriersActive()

  const [items,        setItems]        = useState<DraftItem[]>(() => [mkEmpty()])
  const [priceLoading, setPriceLoading] = useState<Record<number, boolean>>({})
  const [finderOpen,    setFinderOpen]    = useState(false)
  const [finderItemKey, setFinderItemKey] = useState<number | null>(null)
  const [customerFinderOpen,  setCustomerFinderOpen]  = useState(false)
  const [warehouseFinderOpen, setWarehouseFinderOpen] = useState(false)

  // 未保存变更保护：已填写商品或表头字段有值才标脏
  const isDirty = !!(customerId || warehouseId || remark || carrierId || receiverName || items.some(i => i.productId > 0))
  useDirtyGuard(tabPath, isDirty)

  // 触发已有商品行的客户价格等级查询（只查价，不设 customerId）
  const handleCustomerChange = useCallback(async (cid: string) => {
    if (!cid) return
    setItems(prev => prev.map(i => {
      if (!i.productId) return i
      void (async () => {
        try {
          const r = await getCustomerPriceApi(+cid, i.productId)
          if (r.data.data?.salePrice !== undefined) {
            setItems(p => p.map(x => x._key === i._key ? { ...x, unitPrice: r.data.data!.salePrice, priceSource: 'list', resolvedPrice: r.data.data!.salePrice, resolvedPriceLevel: r.data.data!.priceLevel } : x))
          }
        } catch (_) {}
      })()
      return i
    }))
  }, [])

  function handleCustomerConfirm(result: FinderResult) {
    setCustomerId(String(result.id))
    setCustomerName(result.name)
    void handleCustomerChange(String(result.id))
  }

  function handleWarehouseConfirm(result: FinderResult) {
    setWarehouseId(String(result.id))
    setWarehouseName(result.name)
  }

  // 删除行：至少保留一行空行
  const removeItem = (k: number) => setItems(prev => {
    const filtered = prev.filter(i => i._key !== k)
    return filtered.length === 0 ? [mkEmpty()] : filtered
  })

  // 更新行：最后一行填完后自动追加新空行
  const updateItem = (k: number, field: string, val: string | number) =>
    setItems(prev => {
      const updated = prev.map(i => i._key === k ? { ...i, [field]: val, priceSource: field === 'unitPrice' ? 'manual' : i.priceSource } : i)
      const last = updated[updated.length - 1]
      if (last._key === k && last.productId > 0 && last.quantity > 0) return [...updated, mkEmpty()]
      return updated
    })

  // 数量框 Enter 键：跳到下一行商品，或新增行后自动打开选择器
  const handleQuantityKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, k: number) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    setItems(prev => {
      const idx = prev.findIndex(i => i._key === k)
      if (idx === -1) return prev
      const isLast = idx === prev.length - 1
      const cur = prev[idx]
      if (isLast) {
        if (cur.productId > 0 && cur.quantity > 0) {
          const newItem = mkEmpty()
          setTimeout(() => { setFinderItemKey(newItem._key); setFinderOpen(true) }, 50)
          return [...prev, newItem]
        }
      } else {
        const nextKey = prev[idx + 1]._key
        setTimeout(() => { setFinderItemKey(nextKey); setFinderOpen(true) }, 0)
      }
      return prev
    })
  }

  async function handleFinderConfirm(product: ProductFinderResult) {
    if (finderItemKey === null) return
    const k = finderItemKey
    setItems(prev => prev.map(i => i._key === k
      ? { ...i, productId: product.id, productCode: product.code, productName: product.name, unit: product.unit, quantity: 0, unitPrice: product.salePrice ?? 0, priceSource: 'default', costPrice: product.costPrice ?? null, resolvedPrice: null, resolvedPriceLevel: null }
      : i
    ))
    // 商品选择后自动聚焦到该行数量框
    setTimeout(() => { const inp = quantityRefs.current.get(k); if (inp) { inp.focus(); inp.select() } }, 0)
    if (customerId) {
      setPriceLoading(prev => ({ ...prev, [k]: true }))
      try {
        const r = await getCustomerPriceApi(+customerId, product.id)
        if (r.data.data?.salePrice !== undefined)
          setItems(prev => prev.map(i => i._key === k ? { ...i, unitPrice: r.data.data!.salePrice, priceSource: 'list', resolvedPrice: r.data.data!.salePrice, resolvedPriceLevel: r.data.data!.priceLevel } : i))
      } catch (_) {}
      setPriceLoading(prev => ({ ...prev, [k]: false }))
    }
  }

  async function handleSubmit() {
    const filledItems = items.filter(i => i.productId > 0)
    if (!customerId || !customerName) { toast.warning('请选择客户'); return }
    if (!warehouseId || !warehouseName) { toast.warning('请选择仓库'); return }
    if (!filledItems.length) { toast.warning('请添加至少一条明细'); return }
    if (filledItems.find(i => i.quantity <= 0)) { toast.warning('商品数量必须大于 0'); return }
    if (filledItems.find(i => i.unitPrice <= 0)) { toast.warning('商品价格必须大于 0'); return }
    if (receiverPhone && !PHONE_RE.test(receiverPhone)) { toast.warning('请输入正确的手机号'); return }
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

  const total = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)

  return (
    <div className="flex flex-col gap-4">
      <ActionBar
        title="新建销售单"
        rightActions={
          <>
            <Button variant="outline" onClick={closeTab} disabled={createMutate.isPending}>取消</Button>
            <Button onClick={handleSubmit} disabled={createMutate.isPending} className="gap-1.5">
              {createMutate.isPending
                ? <><Loader2 className="h-4 w-4 animate-spin" />提交中...</>
                : <><Save className="h-4 w-4" />提交保存</>}
            </Button>
          </>
        }
      />

      {/* 订单信息 */}
      <Section title="订单信息">
        {/* 三列主区域：第一行客户/仓库/承运商，第二行运费方式/收货人/联系电话 */}
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label>客户 *</Label>
            <FinderTrigger value={customerName} placeholder="点击选择客户..." onClick={() => setCustomerFinderOpen(true)} onDoubleClick={() => { setCustomerFinderOpen(false); navigate('/customers') }} />
          </div>
          <div className="space-y-1.5">
            <Label>出库仓库 *</Label>
            <FinderTrigger value={warehouseName} placeholder="点击选择仓库..." onClick={() => setWarehouseFinderOpen(true)} onDoubleClick={() => { setWarehouseFinderOpen(false); navigate('/warehouses') }} />
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
          <div className="space-y-1.5">
            <Label>收货人</Label>
            <LimitedInput maxLength={5} value={receiverName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReceiverName(e.target.value)} placeholder="请输入收货人" />
          </div>
          <div className="space-y-1.5">
            <Label>联系电话</Label>
            <LimitedInput maxLength={11} value={receiverPhone} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReceiverPhone(e.target.value)} placeholder="11位手机号" inputMode="numeric" />
          </div>
        </div>
        {/* 第三行：收货地址 + 备注 各占一半 */}
        <div className="mt-4 grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>收货地址</Label>
            <LimitedTextarea maxLength={30} value={receiverAddress} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setReceiverAddress(e.target.value)} placeholder="请输入详细收货地址" rows={3} />
          </div>
          <div className="space-y-1.5">
            <Label>备注</Label>
            <LimitedTextarea maxLength={30} value={remark} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setRemark(e.target.value)} placeholder="选填" rows={3} />
          </div>
        </div>
      </Section>

      {/* 商品明细 */}
      <Section title="商品明细">
        <div className="text-table-head mb-2 grid grid-cols-[1fr_70px_110px_110px_90px_36px] gap-3">
          <span>商品</span>
          <span className="text-center">单位</span>
          <span>数量</span>
          <span>单价 (¥)</span>
          <span className="text-right">金额</span>
          <span />
        </div>

        {items.map(item => (
          <div key={item._key} className="mb-2 grid grid-cols-[1fr_70px_110px_110px_90px_36px] gap-3 items-center">
            <button
              type="button"
              onClick={() => { setFinderItemKey(item._key); setFinderOpen(true) }}
              onDoubleClick={() => { setFinderOpen(false); setFinderItemKey(null); navigate('/products') }}
              className="truncate rounded-md border border-border bg-background px-3 py-2 text-left text-sm transition-colors hover:border-primary hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {item.productName
                ? <span className="flex items-center gap-1.5">
                    <span className="font-medium truncate">{item.productName}</span>
                    <span className="shrink-0 text-doc-code-muted">({item.productCode})</span>
                  </span>
                : <span className="text-muted-foreground">点击选择商品...</span>}
            </button>

            <div className="text-center text-muted-body">{item.unit || '—'}</div>

            <Input
              type="number" min="0.01" step="0.01" placeholder="数量"
              value={item.quantity}
              ref={(el: HTMLInputElement | null) => { if (el) quantityRefs.current.set(item._key, el); else quantityRefs.current.delete(item._key) }}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateItem(item._key, 'quantity', +e.target.value)}
              onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => handleQuantityKeyDown(e, item._key)}
              className="text-sm"
            />

            <div>
              <Input
                type="number" min="0" step="0.01" placeholder="单价"
                value={item.unitPrice}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateItem(item._key, 'unitPrice', +e.target.value)}
                className={`text-sm ${item.priceSource === 'list' ? 'border-blue-300 bg-blue-50/80' : item.priceSource === 'manual' ? 'border-amber-300 bg-amber-50/70' : ''}`}
              />
              <PriceMetaHint item={item} loading={!!priceLoading[item._key]} />
            </div>

            <div className="text-right text-sm font-medium">
              ¥{(item.quantity * item.unitPrice).toFixed(2)}
            </div>

            <Button
              type="button" size="sm" variant="ghost"
              className="h-8 w-9 p-0 text-muted-foreground hover:text-destructive"
              onClick={() => removeItem(item._key)}
            >✕</Button>
          </div>
        ))}
      </Section>

      {/* 金额统计：仅统计已选商品的行 */}
      {items.some(i => i.productId > 0) && (
        <Section title="金额统计">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5 text-muted-body">
              <p>商品种数：{items.filter(i => i.productId > 0).length} 种</p>
              <p>合计数量：{items.filter(i => i.productId > 0).reduce((s, i) => s + i.quantity, 0)}</p>
              {items.some(i => i.productId > 0 && i.costPrice != null && i.unitPrice < Number(i.costPrice)) && (
                <p className="inline-flex items-center gap-1 text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  存在低于进价的销售行，提交后会记录到时间线
                </p>
              )}
            </div>
            <div className="text-right">
              <p className="mb-1 text-helper">合计金额</p>
              <p className="text-3xl font-bold text-foreground">¥{total.toFixed(2)}</p>
            </div>
          </div>
        </Section>
      )}

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
      <WarehouseFinder
        open={warehouseFinderOpen}
        onClose={() => setWarehouseFinderOpen(false)}
        onConfirm={handleWarehouseConfirm}
      />

      {/* 底部安全间距 */}
      <div className="h-4" />
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// 编辑视图（草稿状态 status=1 可编辑）
// ════════════════════════════════════════════════════════════════════════════

function EditView({ order, closeTab }: { order: NonNullable<ReturnType<typeof useSaleDetail>['data']>; closeTab: () => void }) {
  const navigate      = useNavigate()
  const updateMutate  = useUpdateSale()
  const reserveMutate = useReserveSale()
  const cancelMutate  = useCancelSale()
  const [reserveConfirmOpen, setReserveConfirmOpen] = useState(false)
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false)

  const [customerId,      setCustomerId]      = useState(String(order.customerId))
  const [customerName,    setCustomerName]    = useState(order.customerName ?? '')
  const [warehouseId,     setWarehouseId]     = useState(String(order.warehouseId))
  const [warehouseName,   setWarehouseName]   = useState(order.warehouseName ?? '')
  const [remark,          setRemark]          = useState(order.remark ?? '')
  const [carrierId,       setCarrierId]       = useState(order.carrierId ? String(order.carrierId) : '')
  const [freightType,     setFreightType]     = useState(order.freightType ? String(order.freightType) : '')
  const [receiverName,    setReceiverName]    = useState(order.receiverName ?? '')
  const [receiverPhone,   setReceiverPhone]   = useState(order.receiverPhone ?? '')
  const [receiverAddress, setReceiverAddress] = useState(order.receiverAddress ?? '')
  const counterRef    = useRef((order.items ?? []).length)
  const quantityRefs  = useRef<Map<number, HTMLInputElement>>(new Map())
  const mkEmpty = (): DraftItem => ({ _key: ++counterRef.current, productId: 0, productCode: '', productName: '', unit: '', quantity: 1, unitPrice: 0, remark: '', priceSource: 'default', resolvedPrice: null, resolvedPriceLevel: null, costPrice: null })

  const { data: carrierOptions = [] } = useCarriersActive()

  const [items, setItems] = useState<DraftItem[]>(() => {
    const loaded = (order.items ?? []).map((item, i) => ({
      _key: i, productId: item.productId, productCode: item.productCode,
      productName: item.productName, unit: item.unit, quantity: item.quantity,
      unitPrice: item.unitPrice, remark: item.remark ?? '', priceSource: 'default' as const, costPrice: item.costPrice ?? null, resolvedPrice: null, resolvedPriceLevel: null,
    }))
    // 已有明细末尾追加一行空行，保持 Excel 式输入体验
    return [...loaded, mkEmpty()]
  })
  const [priceLoading, setPriceLoading] = useState<Record<number, boolean>>({})
  const [finderOpen,    setFinderOpen]    = useState(false)
  const [finderItemKey, setFinderItemKey] = useState<number | null>(null)
  const [customerFinderOpen,  setCustomerFinderOpen]  = useState(false)
  const [warehouseFinderOpen, setWarehouseFinderOpen] = useState(false)

  const handleCustomerChange = useCallback(async (cid: string) => {
    if (!cid) return
    setItems(prev => prev.map(i => {
      if (!i.productId) return i
      ;(async () => {
        try {
          const r = await getCustomerPriceApi(+cid, i.productId)
          if (r.data.data?.salePrice !== undefined)
            setItems(p => p.map(x => x._key === i._key ? { ...x, unitPrice: r.data.data!.salePrice, priceSource: 'list', resolvedPrice: r.data.data!.salePrice, resolvedPriceLevel: r.data.data!.priceLevel } : x))
        } catch (_) {}
      })()
      return i
    }))
  }, [])

  function handleCustomerConfirm(result: FinderResult) {
    setCustomerId(String(result.id))
    setCustomerName(result.name)
    void handleCustomerChange(String(result.id))
  }

  function handleWarehouseConfirm(result: FinderResult) {
    setWarehouseId(String(result.id))
    setWarehouseName(result.name)
  }

  // 删除行：至少保留一行空行
  const removeItem = (k: number) => setItems(prev => {
    const filtered = prev.filter(i => i._key !== k)
    return filtered.length === 0 ? [mkEmpty()] : filtered
  })

  // 更新行：最后一行填完后自动追加新空行
  const updateItem = (k: number, field: string, val: string | number) =>
    setItems(prev => {
      const updated = prev.map(i => i._key === k ? { ...i, [field]: val, priceSource: field === 'unitPrice' ? 'manual' : i.priceSource } : i)
      const last = updated[updated.length - 1]
      if (last._key === k && last.productId > 0 && last.quantity > 0) return [...updated, mkEmpty()]
      return updated
    })

  // 数量框 Enter 键：跳到下一行商品，或新增行后自动打开选择器
  const handleQuantityKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, k: number) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    setItems(prev => {
      const idx = prev.findIndex(i => i._key === k)
      if (idx === -1) return prev
      const isLast = idx === prev.length - 1
      const cur = prev[idx]
      if (isLast) {
        if (cur.productId > 0 && cur.quantity > 0) {
          const newItem = mkEmpty()
          setTimeout(() => { setFinderItemKey(newItem._key); setFinderOpen(true) }, 50)
          return [...prev, newItem]
        }
      } else {
        const nextKey = prev[idx + 1]._key
        setTimeout(() => { setFinderItemKey(nextKey); setFinderOpen(true) }, 0)
      }
      return prev
    })
  }

  async function handleFinderConfirm(product: ProductFinderResult) {
    if (finderItemKey === null) return
    const k = finderItemKey
    setItems(prev => prev.map(i => i._key === k
      ? { ...i, productId: product.id, productCode: product.code, productName: product.name, unit: product.unit, quantity: 0, unitPrice: product.salePrice ?? 0, priceSource: 'default', costPrice: product.costPrice ?? null, resolvedPrice: null, resolvedPriceLevel: null }
      : i
    ))
    // 商品选择后自动聚焦到该行数量框
    setTimeout(() => { const inp = quantityRefs.current.get(k); if (inp) { inp.focus(); inp.select() } }, 0)
    if (customerId) {
      setPriceLoading(prev => ({ ...prev, [k]: true }))
      try {
        const r = await getCustomerPriceApi(+customerId, product.id)
        if (r.data.data?.salePrice !== undefined)
          setItems(prev => prev.map(i => i._key === k ? { ...i, unitPrice: r.data.data!.salePrice, priceSource: 'list', resolvedPrice: r.data.data!.salePrice, resolvedPriceLevel: r.data.data!.priceLevel } : i))
      } catch (_) {}
      setPriceLoading(prev => ({ ...prev, [k]: false }))
    }
  }

  async function handleSubmit() {
    const filledItems = items.filter(i => i.productId > 0)
    if (!customerId || !customerName) { toast.warning('请选择客户'); return }
    if (!warehouseId || !warehouseName) { toast.warning('请选择仓库'); return }
    if (!filledItems.length) { toast.warning('请添加至少一条明细'); return }
    if (filledItems.find(i => i.quantity <= 0)) { toast.warning('商品数量必须大于 0'); return }
    if (filledItems.find(i => i.unitPrice <= 0)) { toast.warning('商品价格必须大于 0'); return }
    if (receiverPhone && !PHONE_RE.test(receiverPhone)) { toast.warning('请输入正确的手机号'); return }
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
    } catch (_) {}
  }

  const total = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)

  return (
    <div className="flex flex-col gap-4">
      <ActionBar
        title={order.orderNo}
        subtitle={<StatusBadge type="sale" status={order.status} />}
        rightActions={
          <>
            <Button variant="outline" onClick={closeTab} disabled={updateMutate.isPending || reserveMutate.isPending || cancelMutate.isPending}>关闭</Button>
            <Button variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/5"
              onClick={() => setCancelConfirmOpen(true)}
              disabled={updateMutate.isPending || reserveMutate.isPending || cancelMutate.isPending}>
              <X className="h-4 w-4 mr-1" />取消订单
            </Button>
            <Button variant="outline" onClick={() => setReserveConfirmOpen(true)}
              disabled={updateMutate.isPending || reserveMutate.isPending || cancelMutate.isPending}>
              <Warehouse className="h-4 w-4 mr-1" />占用库存
            </Button>
            <Button onClick={handleSubmit} disabled={updateMutate.isPending || reserveMutate.isPending || cancelMutate.isPending} className="gap-1.5">
              {updateMutate.isPending
                ? <><Loader2 className="h-4 w-4 animate-spin" />保存中...</>
                : <><Save className="h-4 w-4" />保存</>}
            </Button>
          </>
        }
      />

      {/* 订单信息 */}
      <Section title="订单信息">
        {/* 三列主区域：第一行客户/仓库/承运商，第二行运费方式/收货人/联系电话 */}
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label>客户 *</Label>
            <FinderTrigger value={customerName} placeholder="点击选择客户..." onClick={() => setCustomerFinderOpen(true)} onDoubleClick={() => { setCustomerFinderOpen(false); navigate('/customers') }} />
          </div>
          <div className="space-y-1.5">
            <Label>出库仓库 *</Label>
            <FinderTrigger value={warehouseName} placeholder="点击选择仓库..." onClick={() => setWarehouseFinderOpen(true)} onDoubleClick={() => { setWarehouseFinderOpen(false); navigate('/warehouses') }} />
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
          <div className="space-y-1.5">
            <Label>收货人</Label>
            <LimitedInput maxLength={5} value={receiverName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReceiverName(e.target.value)} placeholder="请输入收货人" />
          </div>
          <div className="space-y-1.5">
            <Label>联系电话</Label>
            <LimitedInput maxLength={11} value={receiverPhone} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReceiverPhone(e.target.value)} placeholder="11位手机号" inputMode="numeric" />
          </div>
        </div>
        {/* 第三行：收货地址 + 备注 各占一半 */}
        <div className="mt-4 grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>收货地址</Label>
            <LimitedTextarea maxLength={30} value={receiverAddress} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setReceiverAddress(e.target.value)} placeholder="请输入详细收货地址" rows={3} />
          </div>
          <div className="space-y-1.5">
            <Label>备注</Label>
            <LimitedTextarea maxLength={30} value={remark} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setRemark(e.target.value)} placeholder="选填" rows={3} />
          </div>
        </div>
      </Section>

      {/* 商品明细 */}
      <Section title="商品明细">
        <div className="text-table-head mb-2 grid grid-cols-[1fr_70px_110px_110px_90px_36px] gap-3">
          <span>商品</span><span className="text-center">单位</span><span>数量</span><span>单价 (¥)</span><span className="text-right">金额</span><span />
        </div>
        {items.map(item => (
          <div key={item._key} className="mb-2 grid grid-cols-[1fr_70px_110px_110px_90px_36px] gap-3 items-center">
            <button
              type="button"
              onClick={() => { setFinderItemKey(item._key); setFinderOpen(true) }}
              onDoubleClick={() => { setFinderOpen(false); setFinderItemKey(null); navigate('/products') }}
              className="truncate rounded-md border border-border bg-background px-3 py-2 text-left text-sm transition-colors hover:border-primary hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {item.productName
                ? <span className="flex items-center gap-1.5"><span className="font-medium truncate">{item.productName}</span><span className="shrink-0 text-doc-code-muted">({item.productCode})</span></span>
                : <span className="text-muted-foreground">点击选择商品...</span>}
            </button>
            <div className="text-center text-muted-body">{item.unit || '—'}</div>
            <Input type="number" min="0.01" step="0.01" placeholder="数量" value={item.quantity}
              ref={(el: HTMLInputElement | null) => { if (el) quantityRefs.current.set(item._key, el); else quantityRefs.current.delete(item._key) }}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateItem(item._key, 'quantity', +e.target.value)}
              onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => handleQuantityKeyDown(e, item._key)}
              className="text-sm" />
            <div>
              <Input type="number" min="0" step="0.01" placeholder="单价" value={item.unitPrice}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateItem(item._key, 'unitPrice', +e.target.value)}
                className={`text-sm ${item.priceSource === 'list' ? 'border-blue-300 bg-blue-50/80' : item.priceSource === 'manual' ? 'border-amber-300 bg-amber-50/70' : ''}`} />
              <PriceMetaHint item={item} loading={!!priceLoading[item._key]} />
            </div>
            <div className="text-right text-sm font-medium">¥{(item.quantity * item.unitPrice).toFixed(2)}</div>
            <Button type="button" size="sm" variant="ghost" className="h-8 w-9 p-0 text-muted-foreground hover:text-destructive" onClick={() => removeItem(item._key)}>✕</Button>
          </div>
        ))}
      </Section>

      {/* 金额统计：仅统计已选商品的行 */}
      {items.some(i => i.productId > 0) && (
        <Section title="金额统计">
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
            <div className="text-right">
              <p className="mb-1 text-helper">合计金额</p>
              <p className="text-3xl font-bold text-foreground">¥{total.toFixed(2)}</p>
            </div>
          </div>
        </Section>
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
      <WarehouseFinder
        open={warehouseFinderOpen}
        onClose={() => setWarehouseFinderOpen(false)}
        onConfirm={handleWarehouseConfirm}
      />

      <ConfirmDialog
        open={reserveConfirmOpen}
        title="占用库存"
        description="将预占该销售单所需库存，可用量减少。请确保已保存最新改动，是否继续？"
        confirmText="占用库存"
        loading={reserveMutate.isPending}
        onConfirm={() => { setReserveConfirmOpen(false); reserveMutate.mutate(order.id) }}
        onCancel={() => setReserveConfirmOpen(false)}
      />

      <ConfirmDialog
        open={cancelConfirmOpen}
        title="取消订单"
        description="取消后订单将变为已取消状态，是否继续？"
        variant="destructive"
        confirmText="确认取消"
        loading={cancelMutate.isPending}
        onConfirm={() => { setCancelConfirmOpen(false); cancelMutate.mutate(order.id) }}
        onCancel={() => setCancelConfirmOpen(false)}
      />

      <div className="h-4" />
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// 查看视图（已有销售单详情 + 状态操作）
// ════════════════════════════════════════════════════════════════════════════

function DetailView({ saleId, tabPath, closeTab }: { saleId: number; tabPath: string; closeTab: () => void }) {
  const navigate       = useNavigate()
  const { data: order, isLoading } = useSaleDetail(saleId)
  const releaseMutate  = useReleaseSale()
  const shipMutate     = useShipSale()
  const deleteMutate   = useDeleteSale()

  const [printOpen, setPrintOpen] = useState(false)

  const [confirmState, setConfirmState] = useState<{
    open: boolean; title: string; description: string; variant: 'default' | 'destructive'; onConfirm: () => void
  }>({ open: false, title: '', description: '', variant: 'default', onConfirm: () => {} })

  function ask(
    title: string, description: string,
    variant: 'default' | 'destructive',
    onConfirm: () => void,
  ) {
    setConfirmState({ open: true, title, description, variant, onConfirm })
  }
  const closeAsk = () => setConfirmState(s => ({ ...s, open: false }))

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
        <p className="text-muted-body">销售单不存在或已删除</p>
        <Button size="sm" variant="outline" onClick={closeTab}>关闭页面</Button>
      </div>
    )
  }

  // 草稿状态直接进入可编辑视图
  if (order.status === 1) {
    return <EditView order={order} closeTab={closeTab} />
  }

  const isPending = releaseMutate.isPending || shipMutate.isPending || deleteMutate.isPending

  return (
    <div className="flex flex-col gap-4">
      <ActionBar
        title={order.orderNo}
        subtitle={<StatusBadge type="sale" status={order.status} />}
        rightActions={
          <>
            {/* RESERVED（已占库）：发货 + 取消占库 */}
            {order.status === 2 && (
              <>
                <Button disabled={isPending} className="gap-1.5"
                  onClick={() => ask('发起出库', '将创建仓库出库任务，由仓库人员执行拣货后完成出库，是否继续？', 'default', () => {
                    closeAsk(); shipMutate.mutate(order.id)
                  })}>
                  <Truck className="h-4 w-4" />发货
                </Button>
                <Button variant="outline" disabled={isPending} className="gap-1.5"
                  onClick={() => ask('取消占库', '将释放已预占的库存并将订单恢复为草稿状态，是否继续？', 'destructive', () => {
                    closeAsk(); releaseMutate.mutate(order.id)
                  })}>
                  取消占库
                </Button>
              </>
            )}

            {/* PICKING（发货中）：查看仓库任务 */}
            {order.status === 3 && order.taskNo && (
              <Button variant="outline" disabled={isPending}
                className="gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-950"
                onClick={() => navigate('/warehouse-tasks')}>
                <Warehouse className="h-4 w-4" />查看任务 · {order.taskNo}
              </Button>
            )}

            {/* SHIPPED（已出库）：打印 */}
            {order.status === 4 && (
              <Button variant="outline" className="gap-1.5" onClick={() => setPrintOpen(true)}>
                <Printer className="h-4 w-4" />打印订单
              </Button>
            )}

            {/* CANCELLED（已取消）：删除 */}
            {order.status === 5 && (
              <Button variant="destructive" disabled={isPending} className="gap-1.5"
                onClick={() => ask('确认删除订单', '删除后订单将无法恢复。', 'destructive', () => {
                  closeAsk(); deleteMutate.mutate(order.id, { onSuccess: closeTab })
                })}>
                <Trash2 className="h-4 w-4" />删除订单
              </Button>
            )}

            <Button variant="outline" onClick={closeTab}>关闭</Button>
          </>
        }
      />

      <FocusModePanel
        badge="下一步推荐入口"
        title="销售详情负责确认订单状态，并把占库、仓库任务和出库衔接起来"
        description="这页最适合先确认客户、收货信息和商品价格，再根据当前状态决定是继续占库、查看仓库任务，还是回到岗位工作台与异常工作台处理卡点。"
        summary={`当前状态：${order.statusName}`}
        steps={[
          '先确认客户、物流信息和商品明细，避免带错单进入仓库执行。',
          '已占库或发货中时，优先回仓库任务或岗位工作台看现场推进。',
          '遇到打印、波次或物流异常时，切到异常工作台和打印查询继续处理。',
        ]}
        actions={[
          { label: '打开岗位工作台', variant: 'default', onClick: () => navigate('/reports/role-workbench') },
          { label: '打开异常工作台', onClick: () => navigate('/reports/exception-workbench') },
          { label: '查看仓库任务', onClick: () => navigate('/warehouse-tasks') },
        ]}
      />

      {/* 基础信息 */}
      <Section title="基础信息">
        <dl className="grid grid-cols-3 gap-x-6 gap-y-3 text-sm">
          {[
            ['客户',     order.customerName],
            ['仓库',     order.warehouseName],
            ['销售日期', order.saleDate ?? '—'],
            ['经办人',   order.operatorName],
            ['创建时间', formatDisplayDateTime(order.createdAt)],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="mb-0.5 text-helper">{label}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
          {order.remark && (
            <div className="col-span-3">
              <dt className="mb-0.5 text-helper">备注</dt>
              <dd>{order.remark}</dd>
            </div>
          )}
        </dl>
      </Section>

      {/* 物流信息 */}
      {(order.carrier || order.freightType || order.receiverName || order.receiverPhone || order.receiverAddress) && (
        <Section title="物流信息">
          <dl className="grid grid-cols-3 gap-x-6 gap-y-3 text-sm">
            {order.carrier && (
              <div>
                <dt className="mb-0.5 text-helper">承运商</dt>
                <dd className="font-medium">{order.carrier}</dd>
              </div>
            )}
            {order.freightType && (
              <div>
                <dt className="mb-0.5 text-helper">运费方式</dt>
                <dd className="font-medium">{order.freightTypeName}</dd>
              </div>
            )}
            {order.receiverName && (
              <div>
                <dt className="mb-0.5 text-helper">收货人</dt>
                <dd className="font-medium">{order.receiverName}</dd>
              </div>
            )}
            {order.receiverPhone && (
              <div>
                <dt className="mb-0.5 text-helper">联系电话</dt>
                <dd className="font-medium">{order.receiverPhone}</dd>
              </div>
            )}
            {order.receiverAddress && (
              <div className="col-span-3">
                <dt className="mb-0.5 text-helper">收货地址</dt>
                <dd className="font-medium">{order.receiverAddress}</dd>
              </div>
            )}
          </dl>
        </Section>
      )}

      {/* 商品明细 */}
      <Section title="商品明细">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-table-head">
                <th className="pb-2 text-left">商品</th>
                <th className="pb-2 text-left">编码</th>
                <th className="w-16 pb-2 text-center">单位</th>
                <th className="w-20 pb-2 text-right">数量</th>
                <th className="w-24 pb-2 text-right">单价</th>
                <th className="w-24 pb-2 text-right">金额</th>
              </tr>
            </thead>
            <tbody>
              {(order.items ?? []).map(item => (
                <tr key={item.id} className="border-b border-border/40 hover:bg-muted/20 transition-colors">
                  <td className="py-2.5 font-medium">{item.productName}</td>
                  <td className="py-2.5"><span className="text-doc-code-muted">{item.productCode}</span></td>
                  <td className="py-2.5 text-center text-muted-foreground">{item.unit}</td>
                  <td className="py-2.5 text-right">{item.quantity}</td>
                  <td className="py-2.5 text-right">
                    <div className="space-y-1">
                      <div>¥{Number(item.unitPrice).toFixed(2)}</div>
                      {item.belowCost && item.costPrice != null && (
                        <div className="inline-flex items-center gap-1 text-[11px] text-destructive">
                          <AlertTriangle className="h-3 w-3" />
                          低于进价 ¥{Number(item.costPrice).toFixed(2)}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="py-2.5 text-right font-semibold">¥{Number(item.amount).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {!!order.timeline?.length && (
        <Section title="操作时间线">
          <div className="space-y-3">
            {order.timeline.map(event => (
              <div key={event.id} className="rounded-lg border border-border/70 bg-card px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{event.title}</p>
                      <Badge variant="outline" className="text-[11px]">{event.eventType}</Badge>
                    </div>
                    {event.description && <p className="text-sm text-muted-foreground">{event.description}</p>}
                  </div>
                  <div className="shrink-0 text-right text-xs text-muted-foreground">
                    <p>{event.createdByName || '系统'}</p>
                    <p>{formatDisplayDateTime(event.createdAt)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* 金额统计 */}
      <Section title="金额统计">
        <div className="flex items-center justify-between">
          <p className="text-muted-body">
            共 {order.items?.length ?? 0} 种商品
          </p>
          <div className="text-right">
            <p className="mb-1 text-helper">合计金额</p>
            <p className="text-3xl font-bold">¥{Number(order.totalAmount).toFixed(2)}</p>
          </div>
        </div>
      </Section>

      {/* 底部安全间距 */}
      <div className="h-4" />

      <ConfirmDialog
        open={confirmState.open}
        title={confirmState.title}
        description={confirmState.description}
        variant={confirmState.variant}
        confirmText={confirmState.variant === 'destructive' ? '确认取消' : '确认'}
        loading={isPending}
        onConfirm={confirmState.onConfirm}
        onCancel={() => setConfirmState(s => ({ ...s, open: false }))}
      />

      {/* 打印预览全屏遮罩 */}
      {printOpen && (
        <PrintPreviewOverlay order={order} onClose={() => setPrintOpen(false)} />
      )}
    </div>
  )
}
