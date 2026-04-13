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

import { useContext, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Plus, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { toast } from '@/lib/toast'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { ActionBar } from '@/components/shared/ActionBar'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { SupplierFinder, WarehouseFinder, ProductFinder, FinderTrigger } from '@/components/finder'
import {
  useCreatePurchase,
  usePurchaseDetail,
  useConfirmPurchase,
  useCancelPurchase,
} from '@/hooks/usePurchase'
import type { PurchaseOrderItem } from '@/types/purchase'
import type { ProductFinderResult } from '@/types/products'
import type { FinderResult } from '@/types/finder'

interface DraftItem extends Omit<PurchaseOrderItem, 'id' | 'amount'> {
  _key: number
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card-base p-5">
      <h3 className="text-section-title mb-4 border-b border-border/50 pb-2">{title}</h3>
      {children}
    </div>
  )
}

export default function PurchaseFormPage() {
  const tabPath = useContext(TabPathContext)
  const navigate = useNavigate()
  const isNew = tabPath === '/purchase/new' || tabPath === ''
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

function CreateView({ closeTab, tabPath }: { closeTab: () => void; tabPath: string }) {
  const navigate = useNavigate()
  const createMutate = useCreatePurchase()

  const [supplierId, setSupplierId] = useState('')
  const [supplierName, setSupplierName] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [warehouseName, setWarehouseName] = useState('')
  const [expectedDate, setExpectedDate] = useState('')
  const [remark, setRemark] = useState('')
  const [items, setItems] = useState<DraftItem[]>([])
  const [counter, setCounter] = useState(0)
  const [finderOpen, setFinderOpen] = useState(false)
  const [finderItemKey, setFinderItemKey] = useState<number | null>(null)
  const [supplierFinderOpen, setSupplierFinderOpen] = useState(false)
  const [warehouseFinderOpen, setWarehouseFinderOpen] = useState(false)

  const isDirty = !!(supplierId || warehouseId || expectedDate || remark || items.length)
  useDirtyGuard(tabPath, isDirty)

  const addItem = () => {
    setCounter(c => c + 1)
    setItems(p => [
      ...p,
      { _key: counter, productId: 0, productCode: '', productName: '', unit: '', quantity: 1, unitPrice: 0, remark: '' },
    ])
  }

  const removeItem = (k: number) => setItems(p => p.filter(i => i._key !== k))
  const updateItem = (k: number, field: string, val: string | number) =>
    setItems(p => p.map(i => (i._key === k ? { ...i, [field]: val } : i)))

  function handleFinderConfirm(product: ProductFinderResult) {
    if (finderItemKey === null) return
    const k = finderItemKey
    setItems(prev =>
      prev.map(i =>
        i._key === k
          ? {
              ...i,
              productId: product.id,
              productCode: product.code,
              productName: product.name,
              unit: product.unit,
              unitPrice: product.costPrice ?? 0,
            }
          : i,
      ),
    )
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
    if (!supplierId || !supplierName) {
      toast.warning('请选择供应商')
      return
    }
    if (!warehouseId || !warehouseName) {
      toast.warning('请选择仓库')
      return
    }
    if (!items.length) {
      toast.warning('请添加至少一条明细')
      return
    }
    if (items.find(i => !i.productId || i.quantity <= 0)) {
      toast.warning('请完整填写所有明细')
      return
    }
    try {
      await createMutate.mutateAsync({
        supplierId: +supplierId,
        supplierName,
        warehouseId: +warehouseId,
        warehouseName,
        expectedDate: expectedDate || undefined,
        remark: remark || undefined,
        items: items.map(({ _key, ...rest }) => rest),
      })
      closeTab()
    } catch (_) {}
  }

  const total = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)
  const totalQuantity = items.reduce((s, i) => s + i.quantity, 0)

  return (
    <div className="flex flex-col gap-8 bg-[#f7f4fb] px-6 py-6 md:px-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-4xl font-semibold tracking-tight text-slate-950">新建采购订单</h1>
          <span className="rounded-lg bg-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700">草稿</span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" onClick={closeTab} disabled={createMutate.isPending} className="text-base text-slate-900 hover:bg-transparent hover:text-slate-700">
            取消
          </Button>
          <Button variant="outline" onClick={handleSubmit} disabled={createMutate.isPending} className="border-slate-200 bg-white text-base text-slate-900 hover:bg-slate-50">
            保存草稿
          </Button>
          <Button onClick={handleSubmit} disabled={createMutate.isPending} className="min-w-[124px] bg-[#1540b8] text-base text-white hover:bg-[#11379f]">
            {createMutate.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                提交中
              </>
            ) : (
              '提交订单'
            )}
          </Button>
        </div>
      </div>

      <section className="rounded-[26px] bg-white px-8 py-8 shadow-[0_18px_50px_-40px_rgba(15,23,42,0.28)]">
        <div className="mb-8 text-base font-semibold text-[#1540b8]">基本信息</div>
        <div className="grid gap-6 md:grid-cols-4">
          <div className="space-y-3">
            <p className="text-sm font-medium text-slate-500">供应商</p>
            <FinderTrigger
              value={supplierName}
              placeholder="选择供应商..."
              onClick={() => setSupplierFinderOpen(true)}
              onDoubleClick={() => {
                setSupplierFinderOpen(false)
                navigate('/suppliers')
              }}
            />
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium text-slate-500">预计到货日期</p>
            <Input
              type="date"
              value={expectedDate}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setExpectedDate(e.target.value)}
              className="h-12 border-0 bg-[#f7f4fb] text-base text-slate-900 shadow-none"
            />
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium text-slate-500">入库仓库</p>
            <FinderTrigger
              value={warehouseName}
              placeholder="选择仓库..."
              onClick={() => setWarehouseFinderOpen(true)}
              onDoubleClick={() => {
                setWarehouseFinderOpen(false)
                navigate('/warehouses')
              }}
            />
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium text-slate-500">采购员</p>
            <div className="flex h-12 items-center rounded-xl bg-[#f7f4fb] px-4 text-base text-slate-900">
              系统管理员
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[26px] bg-white px-0 py-0 shadow-[0_18px_50px_-40px_rgba(15,23,42,0.28)]">
        <div className="flex items-center justify-between border-b border-slate-100 px-8 py-7">
          <div className="text-base font-semibold text-[#1540b8]">商品清单</div>
          <div className="text-sm text-slate-500">已选 {items.length} 项商品</div>
        </div>

        <div className="px-8 py-4">
          <div className="grid grid-cols-[72px_minmax(0,1.6fr)_120px_160px_160px] gap-4 border-b border-slate-100 py-4 text-sm font-medium text-slate-500">
            <span>序号</span>
            <span>商品信息</span>
            <span className="text-center">数量</span>
            <span className="text-center">单价（¥）</span>
            <span className="text-right">小计（¥）</span>
          </div>

          {items.length === 0 ? (
            <div className="py-16 text-center text-slate-500">
              还没有商品，先从下方新增商品开始。
            </div>
          ) : (
            items.map((item, index) => (
              <div key={item._key} className="grid grid-cols-[72px_minmax(0,1.6fr)_120px_160px_160px] items-center gap-4 border-b border-slate-100 py-6 last:border-b-0">
                <div className="text-2xl font-medium tabular-nums text-[#c3c5d9]">
                  {String(index + 1).padStart(2, '0')}
                </div>

                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => {
                      setFinderItemKey(item._key)
                      setFinderOpen(true)
                    }}
                    onDoubleClick={() => {
                      setFinderOpen(false)
                      setFinderItemKey(null)
                      navigate('/products')
                    }}
                    className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-900 text-sm font-semibold text-white"
                  >
                    {(item.productName || '商').slice(0, 1)}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFinderItemKey(item._key)
                      setFinderOpen(true)
                    }}
                    onDoubleClick={() => {
                      setFinderOpen(false)
                      setFinderItemKey(null)
                      navigate('/products')
                    }}
                    className="min-w-0 text-left"
                  >
                    {item.productName ? (
                      <span className="flex flex-col gap-1">
                        <span className="truncate text-[30px] leading-none font-medium text-slate-900 sm:text-[18px]">{item.productName}</span>
                        <span className="truncate text-sm text-[#b7b4ca]">SKU: {item.productCode}</span>
                      </span>
                    ) : (
                      <span className="text-base text-slate-400">点击选择商品...</span>
                    )}
                  </button>
                </div>

                <div className="px-3">
                  <Input
                    type="number"
                    min="0.01"
                    step="0.01"
                    placeholder="数量"
                    value={item.quantity}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateItem(item._key, 'quantity', +e.target.value)}
                    className="h-11 border-0 bg-transparent text-center text-2xl font-medium text-slate-900 shadow-none"
                  />
                </div>

                <div className="px-3">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="单价"
                    value={item.unitPrice}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateItem(item._key, 'unitPrice', +e.target.value)}
                    className="h-11 border-0 bg-transparent text-center text-2xl font-medium text-slate-900 shadow-none"
                  />
                </div>

                <div className="flex items-center justify-end gap-3">
                  <span className="text-2xl font-semibold tabular-nums text-slate-900">
                    {(item.quantity * item.unitPrice).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-9 w-9 rounded-full p-0 text-slate-400 hover:text-destructive"
                    onClick={() => removeItem(item._key)}
                  >
                    ✕
                  </Button>
                </div>
              </div>
            ))
          )}

          <button
            type="button"
            onClick={addItem}
            className="mt-5 flex h-16 w-full items-center justify-center gap-3 rounded-2xl border border-dashed border-[#ddd9ec] text-lg font-medium text-[#c3c5d9] transition-colors hover:border-[#c8c3de] hover:text-[#8f8aa8]"
          >
            <Plus className="h-5 w-5" />
            新增商品
          </button>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_540px]">
        <section className="rounded-[26px] bg-white px-8 py-8 shadow-[0_18px_50px_-40px_rgba(15,23,42,0.28)]">
          <div className="mb-6 text-base font-semibold text-[#1540b8]">订单备注</div>
          <textarea
            value={remark}
            onChange={e => setRemark(e.target.value)}
            placeholder="在此输入订单补充说明或特殊要求..."
            className="min-h-[180px] w-full resize-none rounded-2xl border-0 bg-[#f7f4fb] px-5 py-4 text-base text-slate-900 outline-none placeholder:text-slate-400"
          />
        </section>

        <section className="rounded-[26px] bg-white px-8 py-8 shadow-[0_18px_50px_-40px_rgba(15,23,42,0.28)]">
          <div className="space-y-5">
            <div className="flex items-center justify-between text-[28px] sm:text-base">
              <span className="text-slate-500">商品总额</span>
              <span className="font-medium text-slate-900">¥ {total.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            <div className="flex items-center justify-between text-[28px] sm:text-base">
              <span className="text-slate-500">商品种数</span>
              <span className="font-medium text-slate-900">{items.length}</span>
            </div>
            <div className="flex items-center justify-between text-[28px] sm:text-base">
              <span className="text-slate-500">总数量</span>
              <span className="font-medium text-slate-900">{totalQuantity}</span>
            </div>
          </div>

          <div className="mt-8 border-t border-slate-100 pt-8">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#c3c5d9]">Grand Total</p>
            <div className="mt-4 flex items-end justify-between gap-4">
              <span className="text-2xl font-semibold text-slate-900">订单总额</span>
              <span className="text-5xl font-semibold tracking-tight text-slate-900">
                ¥{total.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        </section>
      </div>

      <ProductFinder
        open={finderOpen}
        warehouseId={warehouseId ? +warehouseId : null}
        onConfirm={handleFinderConfirm}
        onClose={() => {
          setFinderOpen(false)
          setFinderItemKey(null)
        }}
      />

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

      <div className="h-4" />
    </div>
  )
}

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
                <tr key={item.id} className="border-b border-border/40 transition-colors hover:bg-muted/20">
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
