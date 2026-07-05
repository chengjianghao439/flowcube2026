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
import { Loader2, Plus, Save, PackageOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DatePicker } from '@/components/shared/DatePicker'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { toast } from '@/lib/toast'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { confirmDirtyLeave } from '@/lib/unsavedChanges'
import { ActionBar } from '@/components/shared/ActionBar'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { SectionCard } from '@/components/shared/SectionCard'
import { SupplierFinder, ProductFinder, FinderTrigger } from '@/components/finder'
import { WarehouseSelect } from '@/components/shared/WarehouseSelect'
import { formatDisplayDateTime, formatDisplayDate } from '@/lib/dateTime'
import { cn } from '@/lib/utils'
import {
  useCreatePurchase,
  useUpdatePurchase,
  usePurchaseDetail,
  useConfirmPurchase,
  useCancelPurchase,
} from '@/hooks/usePurchase'
import type { PurchaseOrder, PurchaseOrderItem } from '@/types/purchase'
import type { ProductFinderResult } from '@/types/products'
import type { FinderResult } from '@/types/finder'
import { INBOUND_STATUS_LABEL, type InboundTaskStatus } from '@/types/inbound-tasks'

interface DraftItem extends Omit<PurchaseOrderItem, 'id' | 'amount'> {
  _key: number
}

export default function PurchaseFormPage() {
  const tabPath = useContext(TabPathContext)
  const navigate = useNavigate()
  const isNew = tabPath === '/purchase/new' || tabPath === ''
  const purchaseId = isNew ? null : Number(tabPath.split('/').pop())

  function closeTab(targetPath = '/purchase') {
    const { removeTab } = useWorkspaceStore.getState()
    removeTab(tabPath || '/purchase/new')
    navigate(targetPath)
  }

  if (isNew) return <FormView closeTab={closeTab} tabPath={tabPath} />
  return <DetailView purchaseId={purchaseId!} closeTab={closeTab} tabPath={tabPath} />
}

function FormView({ closeTab, tabPath, editOrder, onSaved }: {
  closeTab: () => void
  tabPath: string
  editOrder?: PurchaseOrder
  onSaved?: () => void
}) {
  const navigate = useNavigate()
  const createMutate = useCreatePurchase()
  const updateMutate = useUpdatePurchase()
  const isEdit = !!editOrder
  const submitting = createMutate.isPending || updateMutate.isPending

  const [supplierId, setSupplierId] = useState(editOrder ? String(editOrder.supplierId) : '')
  const [supplierName, setSupplierName] = useState(editOrder?.supplierName ?? '')
  const [warehouseId, setWarehouseId] = useState(editOrder ? String(editOrder.warehouseId) : '')
  const [warehouseName, setWarehouseName] = useState(editOrder?.warehouseName ?? '')
  const [expectedDate, setExpectedDate] = useState(editOrder?.expectedDate ?? '')
  const [remark, setRemark] = useState(editOrder?.remark ?? '')
  const [items, setItems] = useState<DraftItem[]>(
    (editOrder?.items ?? []).map((it, idx) => ({
      _key: idx, productId: it.productId, productCode: it.productCode, productName: it.productName,
      unit: it.unit, quantity: it.quantity, unitPrice: it.unitPrice, remark: it.remark ?? '',
      articleNumber: it.articleNumber ?? null, spec: it.spec ?? null, color: it.color ?? null,
    })),
  )
  const [counter, setCounter] = useState(editOrder?.items?.length ?? 0)
  const [finderOpen, setFinderOpen] = useState(false)
  const [finderItemKey, setFinderItemKey] = useState<number | null>(null)
  const [supplierFinderOpen, setSupplierFinderOpen] = useState(false)
  const [submitLocked, setSubmitLocked] = useState(false)
  const [supplierError, setSupplierError] = useState(false)
  const [warehouseError, setWarehouseError] = useState(false)
  const [invalidItemKeys, setInvalidItemKeys] = useState<Set<number>>(new Set())

  const isDirty = !!(supplierId || warehouseId || expectedDate || remark || items.length)
  useDirtyGuard(tabPath, isDirty)

  function requestLeave(proceed: () => void) {
    confirmDirtyLeave({
      dirtyKeys: [tabPath],
      proceed,
    })
  }

  const addItem = () => {
    const key = counter
    setCounter(c => c + 1)
    setItems(p => [
      ...p,
      { _key: key, productId: 0, productCode: '', productName: '', unit: '', quantity: 1, unitPrice: 0, remark: '', articleNumber: null, spec: null, color: null },
    ])
    setFinderItemKey(key)
    setFinderOpen(true)
  }

  const removeItem = (k: number) => setItems(p => p.filter(i => i._key !== k))
  const updateItem = (k: number, field: string, val: string | number) =>
    setItems(p => p.map(i => (i._key === k ? { ...i, [field]: val } : i)))

  const parsePositiveInteger = (value: string) => {
    if (!value.trim()) return 0
    const num = Number.parseInt(value, 10)
    return Number.isFinite(num) ? num : 0
  }

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
              articleNumber: product.articleNumber,
              spec: product.spec,
              color: product.color,
            }
          : i,
      ),
    )
    setInvalidItemKeys(prev => {
      if (!prev.has(k)) return prev
      const next = new Set(prev)
      next.delete(k)
      return next
    })
  }

  function handleSupplierConfirm(result: FinderResult) {
    setSupplierId(String(result.id))
    setSupplierName(result.name)
    setSupplierError(false)
  }

  async function handleSubmit() {
    if (submitLocked || submitting) return
    const missingSupplier = !supplierId || !supplierName
    const missingWarehouse = !warehouseId || !warehouseName
    setSupplierError(missingSupplier)
    setWarehouseError(missingWarehouse)
    if (missingSupplier) {
      toast.warning('请选择供应商')
      return
    }
    if (missingWarehouse) {
      toast.warning('请选择仓库')
      return
    }
    if (!items.length) {
      toast.warning('请添加至少一条明细')
      return
    }
    const missingProductKeys = new Set(items.filter(i => !i.productId).map(i => i._key))
    setInvalidItemKeys(missingProductKeys)
    if (missingProductKeys.size) {
      toast.warning('请完整填写所有明细')
      return
    }
    if (items.find(i => !Number.isInteger(i.quantity) || i.quantity <= 0)) {
      toast.warning('采购数量必须为大于 0 的整数')
      return
    }
    const payload = {
      supplierId: +supplierId,
      supplierName,
      warehouseId: +warehouseId,
      warehouseName,
      expectedDate: expectedDate || undefined,
      remark: remark || undefined,
      items: items.map(({ _key, ...rest }) => rest),
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
        closeTab(id ? `/purchase/${id}` : '/purchase')
      }
    } catch (_) {
    } finally {
      setSubmitLocked(false)
    }
  }

  const total = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)
  const totalQuantity = items.reduce((s, i) => s + i.quantity, 0)

  return (
    <div className="flex flex-col gap-3">
      <ActionBar
        title={isEdit ? '编辑采购单' : '新建采购单'}
        subtitle={!isEdit && isDirty ? (
          <span className="text-xs font-normal text-muted-foreground">未保存</span>
        ) : undefined}
        rightActions={
          <>
            {isEdit && (
              <Button variant="outline" disabled={submitting || submitLocked} onClick={() => onSaved?.()}>
                取消编辑
              </Button>
            )}
            <Button onClick={handleSubmit} disabled={submitting || submitLocked} className="gap-1.5">
              {submitting || submitLocked ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  保存中...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  {isEdit ? '保存' : '保存草稿'}
                </>
              )}
            </Button>
          </>
        }
      />

      <SectionCard title="订单信息" compact>
        <div className="flex items-start gap-4">
          <div className="w-[272px] shrink-0 space-y-1.5">
            <Label htmlFor="purchase-supplier">供应商 *</Label>
            <FinderTrigger
              id="purchase-supplier"
              value={supplierName}
              placeholder="点击选择供应商..."
              onClick={() => setSupplierFinderOpen(true)}
              onDoubleClick={() => {
                setSupplierFinderOpen(false)
                requestLeave(() => navigate('/suppliers'))
              }}
              className={cn(supplierError && 'border-destructive/60 bg-destructive/5')}
            />
            {supplierError && <p className="text-xs text-destructive">请选择供应商</p>}
          </div>

          <div className="w-56 shrink-0 space-y-1.5">
            <Label htmlFor="purchase-warehouse">入库仓库 *</Label>
            <WarehouseSelect
              id="purchase-warehouse"
              value={warehouseId ? +warehouseId : null}
              onChange={(id, name) => { setWarehouseId(id ? String(id) : ''); setWarehouseName(name); setWarehouseError(false) }}
              placeholder="选择仓库"
              className={cn(warehouseError && 'border-destructive/60 bg-destructive/5')}
            />
            {warehouseError && <p className="text-xs text-destructive">请选择仓库</p>}
          </div>

          <div className="w-48 shrink-0 space-y-1.5">
            <Label htmlFor="purchase-expected-date">预计到货日期</Label>
            <DatePicker id="purchase-expected-date" value={expectedDate} onChange={setExpectedDate} />
          </div>

          <div className="flex-1 space-y-1.5">
            <Label htmlFor="purchase-remark">备注</Label>
            <Input
              id="purchase-remark"
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
          <div className="space-y-3">
            <div className="text-table-head grid grid-cols-[1fr_70px_110px_110px_90px_36px] gap-3">
              <span>商品</span>
              <span className="text-center">单位</span>
              <span>数量</span>
              <span>单价 (¥)</span>
              <span className="text-right">金额</span>
              <span />
            </div>

            {items.map(item => (
              <div
                key={item._key}
                className="grid grid-cols-[1fr_70px_110px_110px_90px_36px] items-center gap-3"
              >
                <button
                  type="button"
                  onClick={() => {
                    setFinderItemKey(item._key)
                    setFinderOpen(true)
                  }}
                  onDoubleClick={() => {
                    setFinderOpen(false)
                    setFinderItemKey(null)
                    requestLeave(() => navigate('/products'))
                  }}
                  className={cn(
                    'overflow-hidden rounded-md border border-border bg-background px-3 py-2 text-left text-sm transition-colors hover:border-primary hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    invalidItemKeys.has(item._key) && 'border-destructive/60 bg-destructive/5',
                  )}
                >
                  {item.productName ? (
                    <div className="flex flex-col gap-0.5">
                      <span className="truncate text-xs text-muted-foreground">
                        <span className="font-mono text-doc-code-muted">{item.productCode}</span>
                        {' · 货号 '}{item.articleNumber || '—'}
                        {' · 型号 '}{item.spec || '—'}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-medium">{item.productName}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">颜色 {item.color || '—'}</span>
                      </span>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">点击选择商品...</span>
                  )}
                </button>

                <div className="text-center text-muted-body">{item.unit || '—'}</div>

                <Input
                  type="number"
                  min="1"
                  step="1"
                  placeholder="数量"
                  value={item.quantity}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateItem(item._key, 'quantity', parsePositiveInteger(e.target.value))}
                  className="text-sm"
                />

                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="单价"
                  value={item.unitPrice}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateItem(item._key, 'unitPrice', +e.target.value)}
                  className="text-sm"
                />

                <div className="text-right text-sm font-medium">
                  ¥{(item.quantity * item.unitPrice).toFixed(2)}
                </div>

                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label="删除该行商品"
                  className="h-9 w-9 rounded-full p-0 text-muted-foreground hover:text-destructive"
                  onClick={() => removeItem(item._key)}
                >
                  ✕
                </Button>
              </div>
            ))}

            <div className="flex items-center justify-between border-t border-border pt-4">
              <p className="text-muted-body">
                商品种数：{items.length} 种　合计数量：{totalQuantity}
              </p>
              <div className="text-right">
                <p className="text-helper">合计金额</p>
                <p className="text-2xl font-semibold text-foreground">¥{total.toFixed(2)}</p>
              </div>
            </div>
          </div>
        )}
      </SectionCard>

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

      <div className="h-4" />
    </div>
  )
}

function DetailView({ purchaseId, closeTab, tabPath }: { purchaseId: number; closeTab: (targetPath?: string) => void; tabPath: string }) {
  const navigate = useNavigate()
  const { data: order, isLoading } = usePurchaseDetail(purchaseId)
  const confirmMutate = useConfirmPurchase()
  const cancelMutate  = useCancelPurchase()
  const [editing, setEditing] = useState(false)

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
      </div>
    )
  }

  if (editing) {
    return <FormView editOrder={order} closeTab={closeTab} tabPath={tabPath} onSaved={() => setEditing(false)} />
  }

  const canConfirm = order.status === 1
  const canCancel  = order.status === 1 || order.status === 2
  const isPending  = confirmMutate.isPending || cancelMutate.isPending

  return (
    <div className="flex flex-col gap-3">
      <ActionBar
        title={order.orderNo}
        subtitle={<StatusBadge type="purchase" status={order.status} />}
        rightActions={
          <>
            {canCancel && (
              <Button variant="outline" className="border-destructive/30 text-destructive hover:bg-destructive/5" disabled={isPending}
                onClick={() => ask('取消采购单', '取消后此采购单将无法恢复，请确认操作。', 'destructive', () => {
                  setConfirmState(s => ({ ...s, open: false }))
                  cancelMutate.mutate(order.id)
                })}>
                取消
              </Button>
            )}
            {order.status === 1 && (
              <Button variant="outline" disabled={isPending} onClick={() => setEditing(true)}>
                编辑
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

          </>
        }
      />

      <SectionCard title="基础信息" compact>
        <dl className="grid grid-cols-3 gap-x-6 gap-y-3 text-sm">
          {[
            ['供应商',     order.supplierName],
            ['仓库',       order.warehouseName],
            ['预计到货',   formatDisplayDate(order.expectedDate)],
            ['经办人',     order.operatorName],
            ['创建时间',   formatDisplayDateTime(order.createdAt)],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="mb-0.5 text-helper">{label}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
          {(order.totalOrderedQty ?? 0) > 0 && (
            <div>
              <dt className="mb-0.5 text-helper">收货进度</dt>
              <dd className="font-medium">{order.totalReceivedQty ?? 0} / {order.totalOrderedQty} 件</dd>
            </div>
          )}
          {order.remark && (
            <div className="col-span-3">
              <dt className="mb-0.5 text-helper">备注</dt>
              <dd>{order.remark}</dd>
            </div>
          )}
          {!!order.inboundTasks?.length && (
            <div className="col-span-3">
              <dt className="mb-0.5 text-helper">关联收货入库单</dt>
              <dd className="flex flex-wrap items-center gap-2">
                {order.inboundTasks.map(t => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => navigate(`/inbound-tasks/${t.id}`)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground transition-colors hover:border-primary hover:bg-muted/30"
                  >
                    {t.taskNo}
                    <span className="text-muted-foreground">
                      {INBOUND_STATUS_LABEL[t.status as InboundTaskStatus] ?? '未知'}
                    </span>
                  </button>
                ))}
              </dd>
            </div>
          )}
        </dl>
      </SectionCard>

      <SectionCard title="商品明细" compact>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-table-head">
                <th className="w-28 pb-2 text-left">编码</th>
                <th className="w-28 pb-2 text-left">货号</th>
                <th className="w-28 pb-2 text-left">型号</th>
                <th className="pb-2 text-left">商品</th>
                <th className="w-20 pb-2 text-left">颜色</th>
                <th className="w-16 pb-2 text-center">单位</th>
                <th className="w-20 pb-2 text-right">数量</th>
                <th className="w-24 pb-2 text-right">单价</th>
                <th className="w-24 pb-2 text-right">金额</th>
              </tr>
            </thead>
            <tbody>
              {(order.items ?? []).map(item => (
                <tr key={item.id} className="border-b border-border/40 transition-colors hover:bg-muted/20">
                  <td className="py-2.5"><span className="text-doc-code-muted">{item.productCode}</span></td>
                  <td className="py-2.5 text-muted-foreground">{item.articleNumber || '—'}</td>
                  <td className="py-2.5 text-muted-foreground">{item.spec || '—'}</td>
                  <td className="py-2.5 font-medium">{item.productName}</td>
                  <td className="py-2.5 text-muted-foreground">{item.color || '—'}</td>
                  <td className="py-2.5 text-center text-muted-foreground">{item.unit}</td>
                  <td className="py-2.5 text-right">{item.quantity}</td>
                  <td className="py-2.5 text-right">¥{Number(item.unitPrice).toFixed(2)}</td>
                  <td className="py-2.5 text-right font-semibold">¥{Number(item.amount).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
          <p className="text-muted-body">
            共 {order.items?.length ?? 0} 种商品
          </p>
          <div className="text-right">
            <p className="text-helper">合计金额</p>
            <p className="text-2xl font-semibold text-foreground">¥{Number(order.totalAmount).toFixed(2)}</p>
          </div>
        </div>
      </SectionCard>

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
