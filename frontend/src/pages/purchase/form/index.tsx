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

import { useMemo, useState, useContext } from 'react'
import { useNavigate } from 'react-router-dom'
import { Save, Loader2, Building2, Package2, CalendarDays, ReceiptText, Plus } from 'lucide-react'
import { Button }  from '@/components/ui/button'
import { Input }   from '@/components/ui/input'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { toast } from '@/lib/toast'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { ActionBar }      from '@/components/shared/ActionBar'
import { StatusBadge }    from '@/components/shared/StatusBadge'
import { ConfirmDialog }  from '@/components/shared/ConfirmDialog'
import { SupplierFinder, WarehouseFinder, ProductFinder, FinderTrigger } from '@/components/finder'
import {
  useCreatePurchase, usePurchaseDetail,
  useConfirmPurchase, useCancelPurchase,
} from '@/hooks/usePurchase'
import type { PurchaseOrderItem } from '@/types/purchase'
import type { ProductFinderResult } from '@/types/products'
import type { FinderResult } from '@/types/finder'

interface DraftItem extends Omit<PurchaseOrderItem, 'id' | 'amount'> {
  _key: number
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

function HeroMetric({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint: string
}) {
  return (
    <div className="rounded-2xl border border-white/50 bg-white/80 px-4 py-3 shadow-sm backdrop-blur">
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  )
}

function PurchaseField({
  icon,
  label,
  required,
  children,
}: {
  icon: React.ReactNode
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white px-4 py-4 shadow-sm transition-shadow hover:shadow-md">
      <div className="mb-3 flex items-center gap-2 text-slate-600">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
          {icon}
        </span>
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-slate-900">{label}</span>
          {required && <span className="text-xs font-medium text-rose-500">*</span>}
        </div>
      </div>
      {children}
    </div>
  )
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────

export default function PurchaseFormPage() {
  const tabPath  = useContext(TabPathContext)
  const navigate = useNavigate()
  const isNew    = tabPath === '/purchase/new' || tabPath === ''
  const purchaseId = isNew ? null : Number(tabPath.split('/').pop())

  function closeTab() {
    const { removeTab, tabs } = useWorkspaceStore.getState()
    const nextKey = removeTab(tabPath || '/purchase/new')
    const nextTab = tabs.find(t => t.key === nextKey)
    navigate(nextTab?.path ?? '/purchase')
  }

  if (isNew) return <CreateView closeTab={closeTab} tabPath={tabPath} />
  return <DetailView purchaseId={purchaseId!} closeTab={closeTab} />
}

// ════════════════════════════════════════════════════════════════════════════
// 新建视图
// ════════════════════════════════════════════════════════════════════════════

function CreateView({ closeTab, tabPath }: { closeTab: () => void; tabPath: string }) {
  const navigate     = useNavigate()
  const createMutate = useCreatePurchase()

  const [supplierId,   setSupplierId]   = useState('')
  const [supplierName, setSupplierName] = useState('')
  const [warehouseId,  setWarehouseId]  = useState('')
  const [warehouseName, setWarehouseName] = useState('')
  const [expectedDate, setExpectedDate] = useState('')
  const [remark,       setRemark]       = useState('')
  const [items,        setItems]        = useState<DraftItem[]>([])
  const [counter,      setCounter]      = useState(0)
  const [finderOpen,    setFinderOpen]    = useState(false)
  const [finderItemKey, setFinderItemKey] = useState<number | null>(null)
  const [supplierFinderOpen,  setSupplierFinderOpen]  = useState(false)
  const [warehouseFinderOpen, setWarehouseFinderOpen] = useState(false)

  // 未保存变更保护：任意字段有值即视为 dirty
  const isDirty = !!(supplierId || warehouseId || expectedDate || remark || items.length)
  useDirtyGuard(tabPath, isDirty)

  const addItem = () => {
    setCounter(c => c + 1)
    setItems(p => [...p, { _key: counter, productId: 0, productCode: '', productName: '', unit: '', quantity: 1, unitPrice: 0, remark: '' }])
  }
  const removeItem = (k: number) => setItems(p => p.filter(i => i._key !== k))
  const updateItem = (k: number, field: string, val: string | number) =>
    setItems(p => p.map(i => i._key === k ? { ...i, [field]: val } : i))

  function handleFinderConfirm(product: ProductFinderResult) {
    if (finderItemKey === null) return
    const k = finderItemKey
    setItems(prev => prev.map(i =>
      i._key === k
        ? { ...i, productId: product.id, productCode: product.code, productName: product.name, unit: product.unit, unitPrice: product.costPrice ?? 0 }
        : i
    ))
  }

  function handleSupplierConfirm(result: FinderResult) {
    setSupplierId(String(result.id))
    setSupplierName(result.name)
  }

  function handleWarehouseConfirm(result: FinderResult) {
    setWarehouseId(String(result.id))
    setWarehouseName(result.name)
  }

  async function handleSubmit() {
    if (!supplierId || !supplierName) { toast.warning('请选择供应商'); return }
    if (!warehouseId || !warehouseName) { toast.warning('请选择仓库'); return }
    if (!items.length) { toast.warning('请添加至少一条明细'); return }
    if (items.find(i => !i.productId || i.quantity <= 0)) { toast.warning('请完整填写所有明细'); return }
    try {
      await createMutate.mutateAsync({
        supplierId: +supplierId, supplierName,
        warehouseId: +warehouseId, warehouseName,
        expectedDate: expectedDate || undefined, remark: remark || undefined,
        items: items.map(({ _key, ...rest }) => rest),
      })
      closeTab()
    } catch (_) {}
  }

  const total = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)
  const totalQuantity = items.reduce((s, i) => s + i.quantity, 0)
  const completionText = useMemo(() => {
    if (!supplierId && !warehouseId && items.length === 0) return '从供应商、仓库和商品开始，先搭好这张采购单。'
    if (!supplierId || !warehouseId) return '先补齐供应商和仓库，后面的商品录入会顺很多。'
    if (!items.length) return '基础信息已经准备好了，接下来录入本次采购商品。'
    return '采购计划已经成型，确认数量和价格后就可以提交。'
  }, [supplierId, warehouseId, items.length])
  const expectedDateLabel = expectedDate || '待安排'
  const supplierDisplay = supplierName || '未选择供应商'
  const warehouseDisplay = warehouseName || '未选择仓库'

  return (
    <div className="flex flex-col gap-6">
      <ActionBar
        title="新建采购单"
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

      <section className="relative overflow-hidden rounded-[28px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eef2ff_45%,#fff7ed_100%)] p-6 shadow-[0_24px_80px_-48px_rgba(15,23,42,0.4)]">
        <div className="absolute inset-y-0 right-0 hidden w-1/2 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.92),transparent_58%)] lg:block" />
        <div className="relative grid gap-6 lg:grid-cols-[1.4fr_0.9fr]">
          <div className="space-y-4">
            <div className="inline-flex items-center rounded-full border border-slate-200 bg-white/80 px-3 py-1 text-xs font-medium tracking-[0.14em] text-slate-600 shadow-sm backdrop-blur">
              极序 Flow · 采购计划录入
            </div>
            <div className="max-w-2xl space-y-3">
              <h1 className="text-3xl font-semibold tracking-tight text-slate-950 md:text-4xl">
                把采购计划先搭稳，再把到货节奏和金额控制清楚。
              </h1>
              <p className="max-w-xl text-sm leading-6 text-slate-600 md:text-base">
                这一页只负责采购计划与提交。供应商、仓库、预计到货和商品明细在同一视角里完成，减少来回切换。
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <HeroMetric label="供应商" value={supplierName ? '已锁定' : '待选择'} hint={supplierDisplay} />
              <HeroMetric label="到货日期" value={expectedDate ? '已安排' : '待安排'} hint={expectedDateLabel} />
              <HeroMetric label="采购金额" value={`¥${total.toFixed(2)}`} hint={`${items.length} 种商品 / ${totalQuantity} 件`} />
            </div>
          </div>

          <aside className="flex h-full flex-col justify-between rounded-[24px] border border-slate-200/80 bg-white/85 p-5 shadow-lg shadow-slate-200/40 backdrop-blur">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">当前节奏</p>
              <p className="mt-3 text-lg font-semibold text-slate-950">{completionText}</p>
              <div className="mt-4 space-y-3 text-sm text-slate-600">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 h-2 w-2 rounded-full bg-emerald-500" />
                  <p>先确定供应商和仓库，保证后续到货与收货链路一致。</p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 h-2 w-2 rounded-full bg-amber-500" />
                  <p>商品明细录入后，页面会实时汇总金额与数量，不需要跳到别处复核。</p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 h-2 w-2 rounded-full bg-sky-500" />
                  <p>提交后由收货订单承接到货、打印库存条码、PDA 收货与上架流程。</p>
                </div>
              </div>
            </div>

            <div className="mt-6 rounded-2xl bg-slate-950 px-4 py-4 text-white">
              <p className="text-xs uppercase tracking-[0.18em] text-white/60">提交前检查</p>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-white/60">供应商</p>
                  <p className="mt-1 font-medium">{supplierName || '未选择'}</p>
                </div>
                <div>
                  <p className="text-white/60">仓库</p>
                  <p className="mt-1 font-medium">{warehouseName || '未选择'}</p>
                </div>
                <div>
                  <p className="text-white/60">商品数</p>
                  <p className="mt-1 font-medium">{items.length} 种</p>
                </div>
                <div>
                  <p className="text-white/60">总件数</p>
                  <p className="mt-1 font-medium">{totalQuantity}</p>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/60">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">基础信息</p>
                <h3 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">本次采购的关键参数</h3>
              </div>
              <div className="hidden rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 md:block">
                先定主体，再录明细
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <PurchaseField icon={<Building2 className="h-4 w-4" />} label="供应商" required>
                <FinderTrigger
                  value={supplierName}
                  placeholder="点击选择供应商..."
                  onClick={() => setSupplierFinderOpen(true)}
                  onDoubleClick={() => { setSupplierFinderOpen(false); navigate('/suppliers') }}
                />
              </PurchaseField>

              <PurchaseField icon={<Package2 className="h-4 w-4" />} label="入库仓库" required>
                <FinderTrigger
                  value={warehouseName}
                  placeholder="点击选择仓库..."
                  onClick={() => setWarehouseFinderOpen(true)}
                  onDoubleClick={() => { setWarehouseFinderOpen(false); navigate('/warehouses') }}
                />
              </PurchaseField>

              <PurchaseField icon={<CalendarDays className="h-4 w-4" />} label="预计到货日期">
                <Input
                  type="date"
                  value={expectedDate}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setExpectedDate(e.target.value)}
                />
              </PurchaseField>

              <PurchaseField icon={<ReceiptText className="h-4 w-4" />} label="备注">
                <Input
                  value={remark}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRemark(e.target.value)}
                  placeholder="补充本次采购的特殊要求或说明"
                />
              </PurchaseField>
            </div>
          </section>

          <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/60">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">商品明细</p>
                <h3 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">把数量和采购成本一次录清楚</h3>
              </div>
              <Button type="button" variant="outline" onClick={addItem} className="gap-2 rounded-full">
                <Plus className="h-4 w-4" />
                添加商品
              </Button>
            </div>

            {items.length === 0 ? (
              <div className="rounded-[20px] border border-dashed border-slate-300 bg-slate-50/80 px-6 py-16 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-slate-500 shadow-sm">
                  <Package2 className="h-6 w-6" />
                </div>
                <h4 className="mt-4 text-lg font-semibold text-slate-900">还没有商品明细</h4>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
                  从这里开始录入本次采购的商品、数量和单价。录完后页面会实时汇总金额，提交前就能先看清计划体量。
                </p>
                <Button type="button" onClick={addItem} className="mt-6 gap-2">
                  <Plus className="h-4 w-4" />
                  添加第一条商品
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-[minmax(0,1.4fr)_72px_110px_120px_96px_40px] gap-3 px-2 text-xs font-medium uppercase tracking-[0.12em] text-slate-500">
                  <span>商品</span>
                  <span className="text-center">单位</span>
                  <span>数量</span>
                  <span>单价</span>
                  <span className="text-right">金额</span>
                  <span />
                </div>

                {items.map(item => (
                  <div key={item._key} className="grid grid-cols-[minmax(0,1.4fr)_72px_110px_120px_96px_40px] items-center gap-3 rounded-[20px] border border-slate-200 bg-slate-50/70 p-3 transition-colors hover:border-slate-300 hover:bg-slate-50">
                    <button
                      type="button"
                      onClick={() => { setFinderItemKey(item._key); setFinderOpen(true) }}
                      onDoubleClick={() => { setFinderOpen(false); setFinderItemKey(null); navigate('/products') }}
                      className="min-w-0 rounded-2xl border border-slate-200 bg-white px-3 py-3 text-left text-sm shadow-sm transition-colors hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {item.productName ? (
                        <span className="flex flex-col gap-1">
                          <span className="truncate font-medium text-slate-900">{item.productName}</span>
                          <span className="truncate text-xs text-slate-500">{item.productCode}</span>
                        </span>
                      ) : (
                        <span className="text-slate-500">点击选择商品...</span>
                      )}
                    </button>

                    <div className="text-center text-sm text-slate-600">{item.unit || '—'}</div>

                    <Input
                      type="number"
                      min="0.01"
                      step="0.01"
                      placeholder="数量"
                      value={item.quantity}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateItem(item._key, 'quantity', +e.target.value)}
                      className="border-slate-200 bg-white"
                    />

                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="单价"
                      value={item.unitPrice}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateItem(item._key, 'unitPrice', +e.target.value)}
                      className="border-slate-200 bg-white"
                    />

                    <div className="text-right text-sm font-semibold text-slate-900">
                      ¥{(item.quantity * item.unitPrice).toFixed(2)}
                    </div>

                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-9 w-9 rounded-full p-0 text-slate-500 hover:text-destructive"
                      onClick={() => removeItem(item._key)}
                    >
                      ✕
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/60">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">采购摘要</p>
            <div className="mt-4 space-y-4">
              <div className="rounded-2xl bg-slate-950 px-4 py-4 text-white">
                <p className="text-xs uppercase tracking-[0.18em] text-white/60">合计金额</p>
                <p className="mt-3 text-3xl font-semibold tracking-tight">¥{total.toFixed(2)}</p>
                <p className="mt-2 text-sm text-white/65">提交后，这个金额会进入采购计划与后续收货链路。</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.14em] text-slate-500">商品种数</p>
                  <p className="mt-2 text-xl font-semibold text-slate-900">{items.length}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.14em] text-slate-500">总数量</p>
                  <p className="mt-2 text-xl font-semibold text-slate-900">{totalQuantity}</p>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/60">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">流程提醒</p>
            <div className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                采购单负责计划与提交，不直接进入 PDA。
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                后续正式主链是：采购单 → 收货订单 → PDA 收货任务 → 打印库存条码 → 上架 → 审核。
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                建议先把供应商、仓库和预计到货日定下来，再录商品，会更接近真实收货安排。
              </div>
            </div>
          </section>
        </aside>
      </div>

      {/* 商品选择中心 */}
      <ProductFinder
        open={finderOpen}
        warehouseId={warehouseId ? +warehouseId : null}
        onConfirm={handleFinderConfirm}
        onClose={() => { setFinderOpen(false); setFinderItemKey(null) }}
      />

      {/* 供应商 / 仓库 Finder */}
      <SupplierFinder
        open={supplierFinderOpen}
        onClose={() => setSupplierFinderOpen(false)}
        onConfirm={handleSupplierConfirm}
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
// 查看视图（已有采购单详情 + 状态操作）
// ════════════════════════════════════════════════════════════════════════════

function DetailView({ purchaseId, closeTab }: { purchaseId: number; closeTab: () => void }) {
  const navigate = useNavigate()
  const { data: order, isLoading } = usePurchaseDetail(purchaseId)
  const confirmMutate = useConfirmPurchase()
  const cancelMutate  = useCancelPurchase()

  const [confirmState, setConfirmState] = useState<{
    open: boolean
    title: string
    description: string
    variant: 'default' | 'destructive'
    confirmText?: string
    onConfirm: () => void
  }>({ open: false, title: '', description: '', variant: 'default', onConfirm: () => {} })

  function ask(
    title: string, description: string,
    variant: 'default' | 'destructive',
    onConfirm: () => void,
    confirmText?: string,
  ) {
    setConfirmState({ open: true, title, description, variant, onConfirm, confirmText })
  }

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
        <p className="text-sm">采购单不存在或已删除</p>
        <Button size="sm" variant="outline" onClick={closeTab}>关闭页面</Button>
      </div>
    )
  }

  const canConfirm = order.status === 1
  const canCancel  = order.status === 1 || order.status === 2
  const isPending  = confirmMutate.isPending || cancelMutate.isPending

  return (
    <div className="flex flex-col gap-4">
      <ActionBar
        title={order.orderNo}
        subtitle={<StatusBadge type="purchase" status={order.status} />}
        rightActions={
          <>
            {canCancel && (
              <Button variant="destructive" disabled={isPending}
                onClick={() => ask('取消采购单', '取消后此采购单将无法恢复，请确认操作。', 'destructive', () => {
                  setConfirmState(s => ({ ...s, open: false }))
                  cancelMutate.mutate(order.id)
                })}>
                取消
              </Button>
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
            <Button variant="outline" onClick={closeTab}>关闭</Button>
          </>
        }
      />

      {/* 基础信息 */}
      <Section title="基础信息">
        <dl className="grid grid-cols-3 gap-x-6 gap-y-3 text-sm">
          {[
            ['供应商',     order.supplierName],
            ['仓库',       order.warehouseName],
            ['预计到货',   order.expectedDate ?? '—'],
            ['经办人',     order.operatorName],
            ['创建时间',   formatDisplayDateTime(order.createdAt)],
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

      <Section title="商品明细">
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/[0.08] px-4 py-3 text-muted-body">
          当前采购单只负责计划与提交。收货、打印库存条码、PDA 执行与上架，将迁移到独立的收货入库单流程。
        </div>
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
                  <td className="py-2.5 text-right">¥{Number(item.unitPrice).toFixed(2)}</td>
                  <td className="py-2.5 text-right font-semibold">¥{Number(item.amount).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

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
    </div>
  )
}
