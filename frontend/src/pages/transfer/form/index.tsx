/**
 * TransferFormPage — 调拨单新建 / 编辑 / 查看页面（独立路由）
 *
 * 路由：
 *   /transfer/new  → 新建模式（空表单）
 *   /transfer/:id  → 查看模式（详情 + 操作按钮），草稿可切换到编辑
 *
 * 结构参照采购单 pages/purchase/form/index.tsx：FormView + DetailView。
 */

import { useContext, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus, Save, PackageOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { toast } from '@/lib/toast'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { ActionBar } from '@/components/shared/ActionBar'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { SectionCard } from '@/components/shared/SectionCard'
import { ProductFinder } from '@/components/finder'
import { WarehouseSelect } from '@/components/shared/WarehouseSelect'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { cn } from '@/lib/utils'
import DataTable from '@/components/shared/DataTable'
import type { TableColumn } from '@/types'
import {
  getTransferDetailApi,
  createTransferApi,
  updateTransferApi,
  confirmTransferApi,
  cancelTransferApi,
} from '@/api/transfer'
import type { TransferOrder, TransferItem } from '@/api/transfer'
import type { ProductFinderResult } from '@/types/products'

interface DraftItem extends Omit<TransferItem, 'id'> {
  _key: number
}

export default function TransferFormPage() {
  const tabPath = useContext(TabPathContext)
  const navigate = useNavigate()
  const isNew = tabPath === '/transfer/new' || tabPath === ''
  const transferId = isNew ? null : Number(tabPath.split('/').pop())

  function closeTab(targetPath = '/transfer') {
    const { removeTab } = useWorkspaceStore.getState()
    removeTab(tabPath || '/transfer/new')
    navigate(targetPath)
  }

  if (isNew) return <FormView closeTab={closeTab} tabPath={tabPath} />
  return <DetailView transferId={transferId!} closeTab={closeTab} tabPath={tabPath} />
}

function FormView({ closeTab, tabPath, editOrder, onSaved }: {
  closeTab: (targetPath?: string) => void
  tabPath: string
  editOrder?: TransferOrder
  onSaved?: () => void
}) {
  const qc = useQueryClient()
  const isEdit = !!editOrder

  const [fromWarehouseId, setFromWarehouseId] = useState(editOrder ? String(editOrder.fromWarehouseId) : '')
  const [fromWarehouseName, setFromWarehouseName] = useState(editOrder?.fromWarehouseName ?? '')
  const [toWarehouseId, setToWarehouseId] = useState(editOrder ? String(editOrder.toWarehouseId) : '')
  const [toWarehouseName, setToWarehouseName] = useState(editOrder?.toWarehouseName ?? '')
  const [remark, setRemark] = useState(editOrder?.remark ?? '')
  const [items, setItems] = useState<DraftItem[]>(
    (editOrder?.items ?? []).map((it, idx) => ({
      _key: idx, productId: it.productId, productCode: it.productCode, productName: it.productName,
      unit: it.unit, articleNumber: it.articleNumber ?? null, spec: it.spec ?? null, color: it.color ?? null,
      quantity: it.quantity, remark: it.remark ?? '',
    })),
  )
  const [counter, setCounter] = useState(editOrder?.items?.length ?? 0)
  const [finderOpen, setFinderOpen] = useState(false)
  const [finderItemKey, setFinderItemKey] = useState<number | null>(null)
  const [submitLocked, setSubmitLocked] = useState(false)
  const [fromError, setFromError] = useState(false)
  const [toError, setToError] = useState(false)
  const [invalidItemKeys, setInvalidItemKeys] = useState<Set<number>>(new Set())

  const sameWarehouse = !!fromWarehouseId && fromWarehouseId === toWarehouseId
  const isDirty = !!(fromWarehouseId || toWarehouseId || remark || items.length)
  useDirtyGuard(tabPath, isDirty)

  const createMutate = useMutation({ mutationFn: createTransferApi })
  const updateMutate = useMutation({ mutationFn: (v: { id: number; data: Parameters<typeof updateTransferApi>[1] }) => updateTransferApi(v.id, v.data) })
  const submitting = createMutate.isPending || updateMutate.isPending

  const addItem = () => {
    const key = counter
    setCounter(c => c + 1)
    setItems(p => [
      ...p,
      { _key: key, productId: 0, productCode: '', productName: '', unit: '', articleNumber: null, spec: null, color: null, quantity: 1, remark: '' },
    ])
    setFinderItemKey(key)
    setFinderOpen(true)
  }

  const removeItem = (k: number) => setItems(p => p.filter(i => i._key !== k))
  const updateItem = (k: number, field: string, val: string | number) =>
    setItems(p => p.map(i => (i._key === k ? { ...i, [field]: val } : i)))

  const parsePositive = (value: string) => {
    if (!value.trim()) return 0
    const num = Number(value)
    return Number.isFinite(num) && num > 0 ? num : 0
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

  async function handleSubmit() {
    if (submitLocked || submitting) return
    const missingFrom = !fromWarehouseId || !fromWarehouseName
    const missingTo = !toWarehouseId || !toWarehouseName
    setFromError(missingFrom)
    setToError(missingTo)
    if (missingFrom) { toast.warning('请选择调出仓库'); return }
    if (missingTo) { toast.warning('请选择调入仓库'); return }
    if (sameWarehouse) { toast.warning('调出仓库和调入仓库不能相同'); return }
    if (!items.length) { toast.warning('请添加至少一条明细'); return }
    const missingProductKeys = new Set(items.filter(i => !i.productId).map(i => i._key))
    setInvalidItemKeys(missingProductKeys)
    if (missingProductKeys.size) { toast.warning('请完整填写所有明细'); return }
    if (items.find(i => !(i.quantity > 0))) { toast.warning('调拨数量必须大于 0'); return }

    const payload = {
      fromWarehouseId: +fromWarehouseId,
      fromWarehouseName,
      toWarehouseId: +toWarehouseId,
      toWarehouseName,
      remark: remark || undefined,
      items: items.map(({ _key, ...rest }) => rest),
    }
    try {
      setSubmitLocked(true)
      if (isEdit && editOrder) {
        await updateMutate.mutateAsync({ id: editOrder.id, data: payload })
        qc.invalidateQueries({ queryKey: ['transfer'] })
        toast.success('已保存')
        onSaved?.()
      } else {
        const res = await createMutate.mutateAsync(payload)
        qc.invalidateQueries({ queryKey: ['transfer'] })
        closeTab(res?.id ? `/transfer/${res.id}` : '/transfer')
      }
    } catch (_) {
    } finally {
      setSubmitLocked(false)
    }
  }

  const totalQuantity = items.reduce((s, i) => s + i.quantity, 0)

  return (
    <div className="flex flex-col gap-3">
      <ActionBar
        title={isEdit ? '编辑调拨单' : '新建调拨单'}
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
                <><Loader2 className="h-4 w-4 animate-spin" />保存中...</>
              ) : (
                <><Save className="h-4 w-4" />{isEdit ? '保存' : '保存草稿'}</>
              )}
            </Button>
          </>
        }
      />

      <SectionCard title="调拨信息" compact>
        <div className="flex items-start gap-4">
          <div className="w-56 shrink-0 space-y-1.5">
            <Label htmlFor="transfer-from">调出仓库 *</Label>
            <WarehouseSelect
              id="transfer-from"
              value={fromWarehouseId ? +fromWarehouseId : null}
              onChange={(id, name) => { setFromWarehouseId(id ? String(id) : ''); setFromWarehouseName(name); setFromError(false) }}
              placeholder="选择调出仓库"
              className={cn(fromError && 'border-destructive/60 bg-destructive/5')}
            />
            {fromError && <p className="text-xs text-destructive">请选择调出仓库</p>}
          </div>

          <div className="w-56 shrink-0 space-y-1.5">
            <Label htmlFor="transfer-to">调入仓库 *</Label>
            <WarehouseSelect
              id="transfer-to"
              value={toWarehouseId ? +toWarehouseId : null}
              onChange={(id, name) => { setToWarehouseId(id ? String(id) : ''); setToWarehouseName(name); setToError(false) }}
              placeholder="选择调入仓库"
              className={cn((toError || sameWarehouse) && 'border-destructive/60 bg-destructive/5')}
            />
            {toError && <p className="text-xs text-destructive">请选择调入仓库</p>}
            {!toError && sameWarehouse && <p className="text-xs text-destructive">与调出仓库不能相同</p>}
          </div>

          <div className="flex-1 space-y-1.5">
            <Label htmlFor="transfer-remark">备注</Label>
            <Input
              id="transfer-remark"
              maxLength={200}
              value={remark}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRemark(e.target.value)}
              placeholder="选填"
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="调拨明细"
        compact
        actions={
          <Button type="button" size="sm" variant="outline" onClick={addItem} className="gap-1.5">
            <Plus className="h-4 w-4" />添加商品
          </Button>
        }
      >
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-12 text-center">
            <PackageOpen className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">还没有调拨明细，点击上方&ldquo;添加商品&rdquo;开始录入</p>
          </div>
        ) : (
          <>
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
                  <th className="w-24 pb-2 text-right">调拨数量</th>
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
                        className={cn(
                          'block w-full overflow-hidden rounded-md border border-border bg-background px-3 py-2 text-left text-sm transition-colors hover:border-primary hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          invalidItemKeys.has(item._key) && 'border-destructive/60 bg-destructive/5',
                        )}
                      >
                        {item.productName
                          ? <span className="truncate font-medium">{item.productName}</span>
                          : <span className="text-muted-foreground">点击选择商品...</span>}
                      </button>
                    </td>
                    <td className="py-2.5 text-muted-foreground">{item.color || '—'}</td>

                    <td className="py-2.5 text-center text-muted-body">{item.unit || '—'}</td>

                    <td className="py-2.5">
                      <Input
                        type="number"
                        min="0"
                        step="0.0001"
                        placeholder="数量"
                        value={item.quantity}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateItem(item._key, 'quantity', parsePositive(e.target.value))}
                        className="text-right text-sm"
                      />
                    </td>

                    <td className="py-2.5 text-center">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label="删除该行商品"
                        className="h-8 w-9 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => removeItem(item._key)}
                      >
                        ✕
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between border-t border-border pt-4">
            <p className="text-muted-body">商品种数：{items.length} 种　合计数量：{totalQuantity}</p>
          </div>
          </>
        )}
      </SectionCard>

      <ProductFinder
        open={finderOpen}
        warehouseId={fromWarehouseId ? +fromWarehouseId : null}
        onConfirm={handleFinderConfirm}
        onClose={() => { setFinderOpen(false); setFinderItemKey(null) }}
      />

      <div className="h-4" />
    </div>
  )
}

function DetailView({ transferId, closeTab, tabPath }: { transferId: number; closeTab: (targetPath?: string) => void; tabPath: string }) {
  const qc = useQueryClient()
  const { data: order, isLoading } = useQuery({
    queryKey: ['transfer', transferId],
    queryFn: () => getTransferDetailApi(transferId),
    enabled: !!transferId,
  })
  const [editing, setEditing] = useState(false)

  const confirmMutate = useMutation({ mutationFn: () => confirmTransferApi(transferId), onSuccess: () => qc.invalidateQueries({ queryKey: ['transfer'] }) })
  const cancelMutate  = useMutation({ mutationFn: () => cancelTransferApi(transferId), onSuccess: () => qc.invalidateQueries({ queryKey: ['transfer'] }) })
  const isPending = confirmMutate.isPending || cancelMutate.isPending

  const [confirmState, setConfirmState] = useState<{
    open: boolean; title: string; description: string; variant: 'default' | 'destructive'; confirmText?: string; onConfirm: () => void
  }>({ open: false, title: '', description: '', variant: 'default', onConfirm: () => {} })

  function ask(title: string, description: string, variant: 'default' | 'destructive', onConfirm: () => void, confirmText?: string) {
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
        <p className="text-sm">调拨单不存在或已删除</p>
      </div>
    )
  }
  if (editing) {
    return <FormView editOrder={order} closeTab={closeTab} tabPath={tabPath} onSaved={() => setEditing(false)} />
  }

  const canConfirm = order.status === 1
  const canCancel  = order.status === 1 || order.status === 2
  const showProgress = order.status >= 3 // 在途/已完成：展示 PDA 扫码进度

  return (
    <div className="flex flex-col gap-3">
      <ActionBar
        title={order.orderNo}
        subtitle={<StatusBadge type="transfer" status={order.status} />}
        rightActions={
          <>
            {canCancel && (
              <Button variant="outline" className="border-destructive/30 text-destructive hover:bg-destructive/5" disabled={isPending}
                onClick={() => ask('取消调拨单', '取消后此调拨单将无法恢复，请确认操作。', 'destructive', () => {
                  setConfirmState(s => ({ ...s, open: false })); cancelMutate.mutate()
                })}>
                取消
              </Button>
            )}
            {order.status === 1 && (
              <Button variant="outline" disabled={isPending} onClick={() => setEditing(true)}>编辑</Button>
            )}
            {canConfirm && (
              <Button disabled={isPending}
                onClick={() => ask('确认并派发', '派发到 PDA 后由仓库扫码完成调拨。', 'default', () => {
                  setConfirmState(s => ({ ...s, open: false })); confirmMutate.mutate()
                }, '确认派发')}>
                确认派发
              </Button>
            )}
          </>
        }
      />

      <SectionCard title="基础信息" compact>
        <dl className="grid grid-cols-3 gap-x-6 gap-y-3 text-sm">
          {[
            ['调出仓库',   order.fromWarehouseName],
            ['调入仓库', order.toWarehouseName],
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
      </SectionCard>

      <SectionCard title="调拨明细" compact>
        <DataTable
          columns={[
            { key: 'productCode', title: '编码', width: 130, render: v => <span className="text-doc-code-muted">{String(v)}</span> },
            { key: 'articleNumber', title: '货号', width: 100, render: v => <span className="text-muted-foreground">{(v as string) || '—'}</span> },
            { key: 'spec', title: '型号', width: 100, render: v => <span className="text-muted-foreground">{(v as string) || '—'}</span> },
            { key: 'productName', title: '商品', width: 180, render: v => <span className="font-medium">{String(v)}</span> },
            { key: 'color', title: '颜色', width: 90, render: v => <span className="text-muted-foreground">{(v as string) || '—'}</span> },
            { key: 'unit', title: '单位', width: 70, render: v => <span className="text-muted-foreground">{String(v)}</span> },
            { key: 'quantity', title: '计划', width: 90 },
            ...(showProgress ? [
              { key: 'deductedQty', title: '已出库', width: 90, render: v => <span className="text-amber-600">{(v as number) ?? 0}</span> },
              { key: 'receivedQty', title: '已入库', width: 90, render: v => <span className="text-emerald-600">{(v as number) ?? 0}</span> },
            ] as TableColumn<TransferItem>[] : []),
          ] satisfies TableColumn<TransferItem>[]}
          data={order.items ?? []}
          rowKey="id"
          emptyText="暂无调拨明细"
        />

        <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
          <p className="text-muted-body">共 {order.items?.length ?? 0} 种商品</p>
        </div>
      </SectionCard>

      <div className="h-4" />

      <ConfirmDialog
        open={confirmState.open}
        title={confirmState.title}
        description={confirmState.description}
        variant={confirmState.variant}
        confirmText={confirmState.confirmText ?? (confirmState.variant === 'destructive' ? '确认取消' : '确认')}
        loading={isPending}
        onConfirm={confirmState.onConfirm}
        onCancel={() => setConfirmState(s => ({ ...s, open: false }))}
      />
    </div>
  )
}
