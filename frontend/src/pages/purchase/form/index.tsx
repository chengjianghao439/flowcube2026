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

import { useState, useContext } from 'react'
import { useNavigate } from 'react-router-dom'
import { Save, Loader2 } from 'lucide-react'
import { Button }  from '@/components/ui/button'
import { Input }   from '@/components/ui/input'
import { Label }   from '@/components/ui/label'
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

  return (
    <div className="flex flex-col gap-4">
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

      {/* 基础信息 */}
      <Section title="基础信息">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>供应商 *</Label>
            <FinderTrigger value={supplierName} placeholder="点击选择供应商..." onClick={() => setSupplierFinderOpen(true)} onDoubleClick={() => { setSupplierFinderOpen(false); navigate('/suppliers') }} />
          </div>
          <div className="space-y-1.5">
            <Label>入库仓库 *</Label>
            <FinderTrigger value={warehouseName} placeholder="点击选择仓库..." onClick={() => setWarehouseFinderOpen(true)} onDoubleClick={() => { setWarehouseFinderOpen(false); navigate('/warehouses') }} />
          </div>
          <div className="space-y-1.5">
            <Label>预计到货日期</Label>
            <Input type="date" value={expectedDate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setExpectedDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>备注</Label>
            <Input value={remark} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRemark(e.target.value)} placeholder="选填" />
          </div>
        </div>
      </Section>

      {/* 商品明细 */}
      <Section title="商品明细">
        <div className="mb-3 flex items-center justify-end">
          <Button type="button" size="sm" variant="outline" onClick={addItem}>+ 添加行</Button>
        </div>

        {items.length === 0 ? (
          <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
            点击「添加行」开始录入商品明细
          </div>
        ) : (
          <>
            <div className="mb-2 grid grid-cols-[1fr_70px_110px_110px_90px_36px] gap-3 text-xs font-medium text-muted-foreground">
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
                        <span className="shrink-0 text-xs text-muted-foreground">({item.productCode})</span>
                      </span>
                    : <span className="text-muted-foreground">点击选择商品...</span>}
                </button>

                <div className="text-center text-sm text-muted-foreground">{item.unit || '—'}</div>

                <Input
                  type="number" min="0.01" step="0.01" placeholder="数量"
                  value={item.quantity}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateItem(item._key, 'quantity', +e.target.value)}
                  className="text-sm"
                />

                <Input
                  type="number" min="0" step="0.01" placeholder="单价"
                  value={item.unitPrice}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateItem(item._key, 'unitPrice', +e.target.value)}
                  className="text-sm"
                />

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
          </>
        )}
      </Section>

      {/* 金额统计 */}
      {items.length > 0 && (
        <Section title="金额统计">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground space-y-0.5">
              <p>商品种数：{items.length} 种</p>
              <p>合计数量：{items.reduce((s, i) => s + i.quantity, 0)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground mb-1">合计金额</p>
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
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />加载中...
      </div>
    )
  }

  if (!order) {
    return (
      <div className="flex h-40 flex-col items-center justify-center gap-3 text-muted-foreground">
        <p className="text-sm">采购单不存在或已删除</p>
        <Button size="sm" variant="outline" onClick={closeTab}>返回列表</Button>
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
            ['创建时间',   order.createdAt?.slice(0, 16)],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground mb-0.5">{label}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
          {order.remark && (
            <div className="col-span-3">
              <dt className="text-xs text-muted-foreground mb-0.5">备注</dt>
              <dd>{order.remark}</dd>
            </div>
          )}
        </dl>
      </Section>

      <Section title="商品明细">
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/[0.08] px-4 py-3 text-sm text-muted-foreground">
          当前采购单只负责计划与提交。收货、打印箱码、PDA 执行与上架，将迁移到独立的收货入库单流程。
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="pb-2 text-left font-medium">商品</th>
                <th className="pb-2 text-left font-medium">编码</th>
                <th className="pb-2 text-center font-medium w-16">单位</th>
                <th className="pb-2 text-right font-medium w-20">数量</th>
                <th className="pb-2 text-right font-medium w-24">单价</th>
                <th className="pb-2 text-right font-medium w-24">金额</th>
              </tr>
            </thead>
            <tbody>
              {(order.items ?? []).map(item => (
                <tr key={item.id} className="border-b border-border/40 hover:bg-muted/20 transition-colors">
                  <td className="py-2.5 font-medium">{item.productName}</td>
                  <td className="py-2.5 font-mono text-xs text-muted-foreground">{item.productCode}</td>
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
          <p className="text-sm text-muted-foreground">
            共 {order.items?.length ?? 0} 种商品
          </p>
          <div className="text-right">
            <p className="text-xs text-muted-foreground mb-1">合计金额</p>
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
