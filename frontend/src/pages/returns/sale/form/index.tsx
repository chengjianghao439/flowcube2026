/**
 * SaleReturnFormPage — 销售退货单新建 / 详情页面（独立路由）
 *
 * 路由：
 *   /returns/sale/new  → 新建模式（空表单）
 *   /returns/sale/:id  → 查看模式（已有退货单详情 + 操作按钮）
 *
 * 说明：退货单没有「编辑」能力——创建后只能确认（派发到 PDA）或取消，
 * 因此本文件只有 FormView（新建）与 DetailView（详情），没有 EditView。
 */

import { useState, Fragment } from 'react'
import { useContext } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Save, X } from 'lucide-react'
import { ActionBar } from '@/components/shared/ActionBar'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { SectionCard } from '@/components/shared/SectionCard'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { CustomerFinder, ProductFinder, FinderTrigger } from '@/components/finder'
import { WarehouseSelect } from '@/components/shared/WarehouseSelect'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { toast } from '@/lib/toast'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { cn } from '@/lib/utils'
import {
  createSaleReturnApi, confirmSaleReturnApi, cancelSaleReturnApi,
  getSaleReturnSourceOrderApi, getSaleReturnDetailApi,
} from '@/api/returns'
import type { SaleReturn, SaleReturnSourceOrder, ReturnItem } from '@/api/returns'
import DataTable from '@/components/shared/DataTable'
import type { TableColumn } from '@/types'
import type { FinderResult } from '@/types/finder'
import type { ProductFinderResult } from '@/types/products'

interface DraftItem {
  _key: number
  sourceItemId?: number | null
  productId: number
  productCode: string
  productName: string
  articleNumber?: string | null
  spec?: string | null
  color?: string | null
  unit: string
  quantity: number
  unitPrice: number
  originalQty?: number
  returnedQty?: number
  remainingQty?: number
}

export default function SaleReturnFormPage() {
  const tabPath = useContext(TabPathContext)
  const navigate = useNavigate()
  const isNew = tabPath === '/returns/sale/new' || tabPath === ''
  const returnId = isNew ? null : Number(tabPath.split('/').pop())

  function closeTab(targetPath = '/returns') {
    const { removeTab } = useWorkspaceStore.getState()
    removeTab(tabPath || '/returns/sale/new')
    navigate(targetPath)
  }

  if (isNew) return <FormView closeTab={closeTab} tabPath={tabPath} />
  return <DetailView returnId={returnId!} closeTab={closeTab} tabPath={tabPath} />
}

// ════════════════════════════════════════════════════════════════════════════
// 新建视图
// ════════════════════════════════════════════════════════════════════════════

function FormView({ closeTab, tabPath }: { closeTab: () => void; tabPath: string }) {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [customerFinderOpen, setCustomerFinderOpen] = useState(false)
  const [customer, setCustomer] = useState<FinderResult | null>(null)
  const [warehouseId, setWarehouseId] = useState<string>('')
  const [warehouseName, setWarehouseName] = useState('')
  const [remark, setRemark] = useState('')
  const [orderNo, setOrderNo] = useState('')
  const [loadingSource, setLoadingSource] = useState(false)
  const [boundSource, setBoundSource] = useState<SaleReturnSourceOrder | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [items, setItems] = useState<DraftItem[]>([])
  const [counter, setCounter] = useState(0)
  const [finderOpen, setFinderOpen] = useState(false)
  const [finderItemKey, setFinderItemKey] = useState<number | null>(null)

  const [customerError, setCustomerError] = useState(false)
  const [warehouseError, setWarehouseError] = useState(false)
  const [invalidItemKeys, setInvalidItemKeys] = useState<Set<number>>(new Set())

  const isDirty = !!(customer || warehouseId || remark || orderNo || items.length)
  useDirtyGuard(tabPath, isDirty)

  function addItem() {
    const key = counter
    setCounter(c => c + 1)
    setItems(p => [...p, { _key: key, productId: 0, productCode: '', productName: '', articleNumber: null, spec: null, color: null, unit: '', quantity: 1, unitPrice: 0 }])
    setFinderItemKey(key)
    setFinderOpen(true)
  }
  const removeItem = (k: number) => setItems(p => p.filter(i => i._key !== k))
  const updateItem = (k: number, field: string, val: string | number) =>
    setItems(p => p.map(i => (i._key === k ? { ...i, [field]: val } : i)))

  function handleCustomerConfirm(result: FinderResult) {
    setCustomer(result)
    setCustomerError(false)
  }

  function handleFinderConfirm(product: ProductFinderResult) {
    if (finderItemKey === null) return
    const k = finderItemKey
    setItems(prev => prev.map(i => i._key === k
      ? { ...i, productId: product.id, productCode: product.code, productName: product.name, articleNumber: product.articleNumber ?? null, spec: product.spec ?? null, color: product.color ?? null, unit: product.unit, unitPrice: product.salePrice ?? 0 }
      : i,
    ))
    setInvalidItemKeys(prev => {
      if (!prev.has(k)) return prev
      const next = new Set(prev)
      next.delete(k)
      return next
    })
  }

  const clearSourceBinding = () => {
    setBoundSource(null)
    setOrderNo('')
    setCustomer(null)
    setWarehouseId(''); setWarehouseName('')
    setItems([])
  }

  async function loadSourceOrder() {
    const trimmed = orderNo.trim()
    if (!trimmed) { toast.warning('请先填写关联原单号'); return }
    setLoadingSource(true)
    try {
      const source = await getSaleReturnSourceOrderApi(trimmed)
      if (!source) return
      setBoundSource(source)
      setCustomer({ id: source.customerId, code: '', name: source.customerName })
      setCustomerError(false)
      setWarehouseId(String(source.warehouseId)); setWarehouseName(source.warehouseName)
      setWarehouseError(false)
      const nextItems: DraftItem[] = source.items
        .filter(item => item.remainingQty > 0)
        .map((item, index) => ({
          _key: index + 1,
          sourceItemId: item.sourceItemId,
          productId: item.productId,
          productCode: item.productCode,
          productName: item.productName,
          articleNumber: item.articleNumber ?? null,
          spec: item.spec ?? null,
          color: item.color ?? null,
          unit: item.unit,
          quantity: item.remainingQty,
          unitPrice: item.unitPrice,
          originalQty: item.quantity,
          returnedQty: item.returnedQty,
          remainingQty: item.remainingQty,
        }))
      setCounter(nextItems.length + 1)
      setItems(nextItems)
      if (!nextItems.length) toast.warning('该原单已无剩余可退数量')
      else toast.success('已载入原单真实明细与成交价')
    } finally { setLoadingSource(false) }
  }

  async function handleSubmit() {
    const missingCustomer = !customer
    const missingWarehouse = !warehouseId
    setCustomerError(missingCustomer)
    setWarehouseError(missingWarehouse)
    if (missingCustomer) { toast.warning('请选择客户'); return }
    if (missingWarehouse) { toast.warning('请选择仓库'); return }
    if (!items.length) { toast.warning('请添加至少一条退货明细'); return }
    const badItemKeys = new Set(items.filter(i => !i.productId || i.quantity <= 0).map(i => i._key))
    setInvalidItemKeys(badItemKeys)
    if (badItemKeys.size) { toast.warning('请完整填写所有明细'); return }

    try {
      setSubmitting(true)
      const res = await createSaleReturnApi({
        customerId: customer!.id, customerName: customer!.name,
        warehouseId: +warehouseId, warehouseName,
        saleOrderId: boundSource ? boundSource.id : undefined,
        saleOrderNo: orderNo || undefined,
        remark: remark.trim() || undefined,
        items: items.map(({ _key, originalQty, returnedQty, remainingQty, ...r }) => r),
      })
      await qc.invalidateQueries({ queryKey: ['returns'] })
      toast.success(`销售退货单 ${res.returnNo} 已创建`)
      const path = `/returns/sale/${res.id}`
      useWorkspaceStore.getState().addTab({ key: path, title: res.returnNo, path })
      closeTab()
      navigate(path)
    } catch (_) {
    } finally { setSubmitting(false) }
  }

  const total = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)

  return (
    <div className="flex flex-col gap-3">
      <ActionBar
        title="新建销售退货单"
        subtitle={isDirty ? <span className="text-xs font-normal text-muted-foreground">未保存</span> : undefined}
        rightActions={
          <Button onClick={handleSubmit} disabled={submitting} className="gap-1.5">
            {submitting ? (<><Loader2 className="h-4 w-4 animate-spin" />创建中...</>) : (<><Save className="h-4 w-4" />创建退货单</>)}
          </Button>
        }
      />

      <SectionCard title="退货信息" compact>
        <div className="flex flex-wrap items-start gap-4">
          <div className="w-[272px] shrink-0 space-y-1.5">
            <Label>客户 *</Label>
            <FinderTrigger
              value={customer?.name ?? ''}
              placeholder="点击选择客户..."
              onClick={() => setCustomerFinderOpen(true)}
              onDoubleClick={() => { setCustomerFinderOpen(false); navigate('/customers') }}
              className={cn(customerError && 'border-destructive/60 bg-destructive/5', !!boundSource && 'pointer-events-none opacity-60')}
            />
            {customerError && <p className="text-xs text-destructive">请选择客户</p>}
          </div>
          <div className="w-56 shrink-0 space-y-1.5">
            <Label>退货仓库 *</Label>
            <WarehouseSelect
              value={warehouseId ? +warehouseId : null}
              onChange={(id, name) => { setWarehouseId(id ? String(id) : ''); setWarehouseName(name); setWarehouseError(false) }}
              placeholder="选择仓库"
              disabled={!!boundSource}
              className={cn(warehouseError && 'border-destructive/60 bg-destructive/5')}
            />
            {warehouseError && <p className="text-xs text-destructive">请选择仓库</p>}
          </div>
          <div className="w-64 shrink-0 space-y-1.5">
            <Label>关联原销售单号</Label>
            <div className="flex items-center gap-1">
              <Input
                value={orderNo}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  const next = e.target.value
                  setOrderNo(next)
                  if (boundSource && next.trim() !== boundSource.orderNo) { setBoundSource(null); setItems([]) }
                }}
                placeholder="输入原单号"
                disabled={loadingSource}
              />
              {boundSource ? (
                <Button type="button" variant="ghost" size="sm" onClick={clearSourceBinding}>清除</Button>
              ) : (
                <Button type="button" variant="outline" size="sm" onClick={() => void loadSourceOrder()} disabled={loadingSource || !orderNo.trim()}>
                  {loadingSource ? '载入中...' : '载入'}
                </Button>
              )}
            </div>
          </div>
          <div className="flex-1 space-y-1.5">
            <Label>备注</Label>
            <Input value={remark} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRemark(e.target.value)} placeholder="选填" />
          </div>
        </div>

        {boundSource && (
          <div className="mt-3 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            已锚定原单 {boundSource.orderNo}。退货单价默认取原单真实成交价，数量默认取剩余可退数量。
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="退货明细"
        compact
        actions={!boundSource ? (
          <Button type="button" size="sm" variant="outline" onClick={addItem} className="gap-1.5">+ 添加商品</Button>
        ) : undefined}
      >
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-12 text-center">
            <p className="text-sm text-muted-foreground">还没有退货明细，点击上方"添加商品"或先绑定原销售单</p>
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
                  <th className="w-20 pb-2 text-right">数量</th>
                  <th className="w-24 pb-2 text-right">单价 (¥)</th>
                  <th className="w-28 pb-2 text-right">金额</th>
                  <th className="w-10 pb-2" />
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <Fragment key={item._key}>
                    <tr className={cn('border-border/40', (item.originalQty == null && item.returnedQty == null) && 'border-b')}>
                      <td className="py-2.5 text-doc-code-muted">{item.productCode || '—'}</td>
                      <td className="py-2.5 text-muted-foreground">{item.articleNumber || '—'}</td>
                      <td className="py-2.5 text-muted-foreground">{item.spec || '—'}</td>
                      <td className="py-2.5 pr-3">
                        <button
                          type="button"
                          disabled={!!boundSource}
                          onClick={() => { setFinderItemKey(item._key); setFinderOpen(true) }}
                          onDoubleClick={() => { setFinderOpen(false); setFinderItemKey(null); navigate('/products') }}
                          className={cn(
                            'block w-full overflow-hidden rounded-md border border-border bg-background px-3 py-2 text-left text-sm transition-colors hover:border-primary hover:bg-muted/30 disabled:cursor-not-allowed disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
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
                          type="number" min="0.01" step="0.01" placeholder="数量"
                          value={item.quantity}
                          disabled={!!boundSource}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateItem(item._key, 'quantity', +e.target.value)}
                          className="text-right text-sm"
                        />
                      </td>
                      <td className="py-2.5">
                        <Input
                          type="number" min="0" step="0.01" placeholder="单价"
                          value={item.unitPrice}
                          disabled={!!boundSource}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateItem(item._key, 'unitPrice', +e.target.value)}
                          className="text-right text-sm"
                        />
                      </td>
                      <td className="py-2.5 text-right font-medium tabular-nums">¥{(item.quantity * item.unitPrice).toFixed(2)}</td>
                      <td className="py-2.5 text-center">
                        <Button type="button" size="sm" variant="ghost" disabled={!!boundSource} className="h-8 w-9 p-0 text-muted-foreground hover:text-destructive" onClick={() => removeItem(item._key)}>✕</Button>
                      </td>
                    </tr>
                    {(item.originalQty != null || item.returnedQty != null) && (
                      <tr className="border-b border-border/40">
                        <td colSpan={10} className="pb-2.5 pt-0 text-xs text-muted-foreground">
                          原单数量 {Number(item.originalQty || 0).toFixed(2)}，已退 {Number(item.returnedQty || 0).toFixed(2)}，剩余可退 {Number(item.remainingQty || 0).toFixed(2)}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-border pt-4">
            <p className="text-muted-body">商品种数：{items.length} 种</p>
            <div className="text-right">
              <p className="text-helper">合计金额</p>
              <p className="text-2xl font-semibold text-foreground">¥{total.toFixed(2)}</p>
            </div>
          </div>
          </>
        )}
      </SectionCard>

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
// 详情视图
// ════════════════════════════════════════════════════════════════════════════

const TASK_PROGRESS_STEPS = [
  { status: 1, label: '待收货' },
  { status: 2, label: '收货中' },
  { status: 3, label: '待质检' },
  { status: 4, label: '待上架' },
  { status: 5, label: '已完成' },
]

function TaskProgressCard({ task }: { task: SaleReturn['task'] }) {
  if (!task) return null
  const currentIdx = TASK_PROGRESS_STEPS.findIndex(s => s.status === task.status)
  const isCancelled = task.status === 6
  return (
    <div className="rounded-lg border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">入库进度（PDA 收货 → 质检 → 上架）</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">退货任务：{task.taskNo}</p>
        </div>
        {isCancelled ? (
          <Badge variant="destructive" className="rounded-full">已取消</Badge>
        ) : (
          <Badge variant="outline" className="rounded-full border-blue-200 bg-blue-50 text-blue-700">{task.statusName}</Badge>
        )}
      </div>
      {!isCancelled && (
        <div className="flex items-center gap-1">
          {TASK_PROGRESS_STEPS.map((step, idx) => {
            const isDone = currentIdx >= 0 && idx < currentIdx
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
                {idx < TASK_PROGRESS_STEPS.length - 1 && (
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

function DetailView({ returnId }: { returnId: number; closeTab: () => void; tabPath: string }) {
  const qc = useQueryClient()
  const detailQuery = useQuery({
    queryKey: ['return-sale-detail', returnId],
    queryFn: () => getSaleReturnDetailApi(returnId),
    enabled: !!returnId,
    refetchInterval: 8000,
  })
  const ret = detailQuery.data
  const isLoading = detailQuery.isLoading

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [pending, setPending] = useState(false)

  async function handleConfirm() {
    try {
      setPending(true)
      await confirmSaleReturnApi(returnId)
      await qc.invalidateQueries({ queryKey: ['return-sale-detail', returnId] })
      await qc.invalidateQueries({ queryKey: ['returns'] })
      toast.success('已确认，已派发到 PDA')
    } finally { setPending(false); setConfirmOpen(false) }
  }
  async function handleCancel() {
    try {
      setPending(true)
      await cancelSaleReturnApi(returnId)
      await qc.invalidateQueries({ queryKey: ['return-sale-detail', returnId] })
      await qc.invalidateQueries({ queryKey: ['returns'] })
      toast.success('已取消')
    } finally { setPending(false); setCancelOpen(false) }
  }

  if (isLoading) {
    return <div className="flex h-40 items-center justify-center text-muted-body"><Loader2 className="mr-2 h-4 w-4 animate-spin" />加载中...</div>
  }
  if (!ret) {
    return <div className="flex h-40 flex-col items-center justify-center gap-3 text-muted-foreground"><p className="text-sm">销售退货单不存在或已删除</p></div>
  }

  return (
    <div className="flex flex-col gap-3">
      <ActionBar
        title={ret.returnNo}
        subtitle={<StatusBadge type="returns" status={ret.status} />}
        rightActions={
          <>
            {(ret.status === 1 || ret.status === 2) && (
              <Button variant="outline" className="border-destructive/30 text-destructive hover:bg-destructive/5" disabled={pending} onClick={() => setCancelOpen(true)}>
                <X className="h-4 w-4 mr-1" />取消
              </Button>
            )}
            {ret.status === 1 && (
              <Button disabled={pending} onClick={() => setConfirmOpen(true)}>确认（派发到 PDA）</Button>
            )}
          </>
        }
      />

      {ret.task && <TaskProgressCard task={ret.task} />}

      <SectionCard title="基础信息" compact>
        <dl className="grid grid-cols-3 gap-x-6 gap-y-3 text-sm">
          {[
            ['客户', ret.customerName],
            ['仓库', ret.warehouseName],
            ['关联销售单', ret.saleOrderNo || '—'],
            ['经办人', ret.operatorName],
            ['创建时间', formatDisplayDateTime(ret.createdAt)],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="mb-0.5 text-helper">{label}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
          {ret.remark && (
            <div className="col-span-3">
              <dt className="mb-0.5 text-helper">备注</dt>
              <dd>{ret.remark}</dd>
            </div>
          )}
        </dl>
      </SectionCard>

      <SectionCard title="退货明细" compact>
        <DataTable
          columns={[
            { key: 'productCode', title: '编码', width: 130, render: v => <span className="text-doc-code-muted">{String(v)}</span> },
            { key: 'articleNumber', title: '货号', width: 110, render: v => <span className="text-muted-foreground">{(v as string) || '—'}</span> },
            { key: 'spec', title: '型号', width: 110, render: v => <span className="text-muted-foreground">{(v as string) || '—'}</span> },
            { key: 'productName', title: '商品', width: 180, render: v => <span className="font-medium">{String(v)}</span> },
            { key: 'color', title: '颜色', width: 100, render: v => <span className="text-muted-foreground">{(v as string) || '—'}</span> },
            { key: 'unit', title: '单位', width: 70, render: v => <span className="text-muted-foreground">{String(v)}</span> },
            { key: 'quantity', title: '数量', width: 90 },
            { key: 'unitPrice', title: '单价', width: 110, render: v => `¥${Number(v).toFixed(2)}` },
            { key: 'amount', title: '金额', width: 110, render: v => <span className="font-semibold">¥{Number(v).toFixed(2)}</span> },
          ] satisfies TableColumn<ReturnItem>[]}
          data={ret.items ?? []}
          rowKey="id"
          emptyText="暂无退货明细"
        />
        <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
          <p className="text-muted-body">共 {ret.items?.length ?? 0} 种商品</p>
          <div className="text-right">
            <p className="text-helper">合计金额</p>
            <p className="text-2xl font-semibold text-foreground">¥{Number(ret.totalAmount).toFixed(2)}</p>
          </div>
        </div>
      </SectionCard>

      <div className="h-4" />

      <ConfirmDialog
        open={confirmOpen}
        title="确认销售退货单"
        description="确认后将派发到 PDA，由仓库人员扫码收货、质检、上架；上架完成后自动增加库存并冲减应收账款。"
        confirmText="确认"
        loading={pending}
        onConfirm={handleConfirm}
        onCancel={() => setConfirmOpen(false)}
      />
      <ConfirmDialog
        open={cancelOpen}
        title="取消销售退货单"
        description="取消后此退货单将无法恢复，请确认操作。"
        variant="destructive"
        confirmText="确认取消"
        loading={pending}
        onConfirm={handleCancel}
        onCancel={() => setCancelOpen(false)}
      />
    </div>
  )
}
