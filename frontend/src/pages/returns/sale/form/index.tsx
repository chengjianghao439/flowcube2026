import { money } from '@/lib/format'
import { OrderDetailSections } from '@/components/shared/OrderDetailSections'
import { ProductIdentityCells, ProductIdentityHeaders } from '@/components/shared/ProductIdentityCells'
import { productIdentityColumns } from '@/components/shared/productIdentityColumns'
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

import { useState, useRef, useEffect, Fragment } from 'react'
import { useContext } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Save, X } from 'lucide-react'
import { ActionBar } from '@/components/shared/ActionBar'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { SectionCard } from '@/components/shared/SectionCard'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { CustomerFinder, ProductFinder } from '@/components/finder'
import { PickerField } from '@/components/shared/PickerField'
import { WarehouseSelect } from '@/components/shared/WarehouseSelect'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { useWorkspaceTabTitle } from '@/hooks/useWorkspaceTabTitle'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { toast } from '@/lib/toast'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { createRequestKey } from '@/lib/requestKey'
import { cn } from '@/lib/utils'
import {
  createSaleReturnApi, confirmSaleReturnApi, cancelSaleReturnApi,
  getSaleReturnSourceOrderApi, getSaleReturnDetailApi,
} from '@/api/returns'
import type { SaleReturn, SaleReturnSourceOrder, ReturnItem, SaleReturnReverseTask, ReturnSourceOrderItem, ReturnSourceLabels } from '@/api/returns'
import DataTable from '@/components/shared/DataTable'
import type { TableColumn } from '@/types'
import type { FinderResult } from '@/types/finder'
import type { ProductFinderResult, ProductUnit } from '@/types/products'
import { getProductApi } from '@/api/products'
import { useProductQtyPolicies } from '@/hooks/useProductQtyPolicies'
import { captureKitReadOwner, assertKitReadOwner, useKitBackup } from '@/hooks/useKits'
import { useSourceReturnFacts } from '@/hooks/useSourceReturnFacts'
import { useKitOperation } from '@/hooks/useKitOperation'
import { commercialReadConfig } from '@/api/sale-commercial'
import { SourceComponents, SourceLabel } from './SourceComponents'
import { returnNet } from './returnSourcePresentation'
import { hasQuantityPrecision, qtyStep } from '@/lib/qtyStep'

interface DraftItem {
  _key: number
  dispatchComponentId?: number
  commercialComponentId?: number
  source?: ReturnSourceOrderItem
  sourceItemId?: number | null
  productId: number
  productCode: string
  productName: string
  articleNumber?: string | null
  spec?: string | null
  color?: string | null
  unit: string
  entryUnit?: string        // 录入单位（多单位，文档03 Phase4a；无源手工退货可按箱录入）
  units?: ProductUnit[]     // UI-only：该商品多计量单位（供单位下拉），提交前 strip，不发后端
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

  function closeTab(targetPath = '/returns/sale') {
    const { removeTab } = useWorkspaceStore.getState()
    removeTab(tabPath || '/returns/sale/new')
    navigate(targetPath)
  }

  if (isNew) return <FormView key={tabPath} closeTab={closeTab} tabPath={tabPath} />
  return <DetailView key={returnId!} returnId={returnId!} closeTab={closeTab} tabPath={tabPath} />
}

// ════════════════════════════════════════════════════════════════════════════
// 新建视图
// ════════════════════════════════════════════════════════════════════════════

function FormView({ closeTab, tabPath }: { closeTab: () => void; tabPath: string }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [owner] = useState(captureKitReadOwner)
  const sourceSerial = useRef(0), mounted = useRef(true), currentOrderNo = useRef('')
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const write = useKitOperation<object, { id: number; returnNo: string }>(owner, `source-return:${tabPath}`, {
    execute: (body, query, originalOwner) => createSaleReturnApi(body, query.requestKey, commercialReadConfig(originalOwner)),
    validate: data => !!data && Number.isSafeInteger(data.id) && data.id > 0 && typeof data.returnNo === 'string'
  })

  const [customerFinderOpen, setCustomerFinderOpen] = useState(false)
  const [customer, setCustomer] = useState<FinderResult | null>(null)
  const [warehouseId, setWarehouseId] = useState<string>('')
  const [warehouseName, setWarehouseName] = useState('')
  const [remark, setRemark] = useState('')
  const [orderNo, setOrderNo] = useState('')
  const [loadingSource, setLoadingSource] = useState(false)
  const [boundSource, setBoundSource] = useState<SaleReturnSourceOrder | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // 稳定幂等键：整个组件生命周期内复用同一 key（重试/网络回退不建重单），成功后轮换供下次新建
  const requestKeyRef = useRef(createRequestKey('sale-return'))

  const [items, setItems] = useState<DraftItem[]>([])
  // 「只能整数」的商品把退货数量框的 step 切成 1（迁移 254）
  const isKit = boundSource?.commercialModel === 'kit-v1'
  const allowDecimalOf = useProductQtyPolicies(isKit ? [] : items.map(i => i.productId))
  const [sourceError, setSourceError] = useState('')
  let ownerCurrent = true
  try { assertKitReadOwner(owner) } catch { ownerCurrent = false }
  const locked = write.blocked || !ownerCurrent
  const snapshot = JSON.stringify({ customer, warehouseId, warehouseName, orderNo, remark, items, revision: boundSource?.commercialRevision })
  const backup = useKitBackup(snapshot, owner)
  const [counter, setCounter] = useState(0)
  const [finderOpen, setFinderOpen] = useState(false)
  const [finderItemKey, setFinderItemKey] = useState<number | null>(null)

  const [customerError, setCustomerError] = useState(false)
  const [warehouseError, setWarehouseError] = useState(false)
  const [invalidItemKeys, setInvalidItemKeys] = useState<Set<number>>(new Set())

  const isDirty = !!write.pending || !!(customer || warehouseId || remark || orderNo || items.length)
  useDirtyGuard(tabPath, isDirty)

  function addItem() {
    const key = counter
    setCounter(c => c + 1)
    setItems(p => [...p, { _key: key, productId: 0, productCode: '', productName: '', articleNumber: null, spec: null, color: null, unit: '', entryUnit: '', units: [], quantity: 1, unitPrice: 0 }])
    setFinderItemKey(key)
    setFinderOpen(true)
  }
  const removeItem = (k: number) => setItems(p => p.filter(i => i._key !== k))
  const updateItem = (k: number, field: string, val: string | number) =>
    setItems(p => p.map(i => (i._key === k ? { ...i, [field]: val } : i)))

  function handleCustomerConfirm(result: FinderResult) {
    if (locked) return
    setCustomer(result)
    setCustomerError(false)
  }

  function handleFinderConfirm(product: ProductFinderResult) {
    if (finderItemKey === null || locked) return
    const k = finderItemKey
    setItems(prev => prev.map(i => i._key === k
      ? { ...i, productId: product.id, productCode: product.code, productName: product.name, articleNumber: product.articleNumber ?? null, spec: product.spec ?? null, color: product.color ?? null, unit: product.unit, entryUnit: product.unit, units: [], unitPrice: product.salePrice ?? 0 }
      : i,
    ))
    // 拉多计量单位供单位下拉（无辅助单位则下拉不出现、按基本单位录入）
    getProductApi(product.id)
      .then(full => { const units = full?.units ?? []; setItems(prev => prev.map(i => (i._key === k && i.productId === product.id ? { ...i, units } : i))) })
      .catch(() => { /* 拉取失败：按基本单位录入 */ })
    setInvalidItemKeys(prev => {
      if (!prev.has(k)) return prev
      const next = new Set(prev)
      next.delete(k)
      return next
    })
  }

  const clearSourceBinding = () => {
    if (write.conflict && !backup.canReload()) return
    sourceSerial.current++; currentOrderNo.current = ''; setSourceError('')
    setBoundSource(null)
    setOrderNo('')
    setCustomer(null)
    setWarehouseId(''); setWarehouseName('')
    setItems([])
  }

  async function loadSourceOrder() {
    const trimmed = orderNo.trim()
    if (!trimmed) { toast.warning('请先填写关联原单号'); return }
    const serial = ++sourceSerial.current
    currentOrderNo.current = trimmed
    setLoadingSource(true); setSourceError('')
    try {
      assertKitReadOwner(owner)
      const source = await getSaleReturnSourceOrderApi(trimmed, commercialReadConfig(owner))
      assertKitReadOwner(owner)
      if (!source || !mounted.current || serial !== sourceSerial.current || currentOrderNo.current.trim() !== trimmed || source.orderNo !== trimmed) return
      setBoundSource(source)
      setCustomer({ id: source.customerId, code: '', name: source.customerName })
      setCustomerError(false)
      setWarehouseId(String(source.warehouseId)); setWarehouseName(source.warehouseName)
      setWarehouseError(false)
      const nextItems: DraftItem[] = (source.commercialModel === 'kit-v1' ? [] : source.items)
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
      if (source.commercialModel === 'kit-v1') toast.success('已载入原实发来源，请明确选择本次退回的配件')
      else if (!nextItems.length) toast.warning('该原单已无剩余可退数量')
      else toast.success('已载入原单真实明细与成交价')
    } catch (e) { if (mounted.current && serial === sourceSerial.current) setSourceError(e instanceof Error ? e.message : '来源读取失败') }
    finally { if (mounted.current && serial === sourceSerial.current) setLoadingSource(false) }
  }

  function selectSource(item: ReturnSourceOrderItem) {
    if (locked) return
    if (items.some(row => row.dispatchComponentId === item.dispatchComponentId)) { setSourceError('该原来源已选择，请直接修改本次申请量'); return }
    if (items.some(row => row.productId === item.productId || row.source?.warehouseId !== item.warehouseId)) { setSourceError('相同商品的不同原来源，或不同发货仓库，需要分单退货；已填数量保持'); return }
    if (!item.dispatchComponentId || !item.commercialComponentId || !item.sourceItemId || !item.warehouseId) { setSourceError('来源身份不完整，请核对原批次'); return }
    setWarehouseId(String(item.warehouseId)); setWarehouseName(item.warehouseName || '')
    setItems(rows => [...rows, { ...item, _key: counter, quantity: Math.min(1, item.remainingQty), source: item, originalQty: item.sourceQuantity }])
    setCounter(c => c + 1); setSourceError('')
  }
  function created(res: { id: number; returnNo: string }) {
    void qc.invalidateQueries({ queryKey: ['returns'] })
    toast.success(`销售退货单 ${res.returnNo} 已创建`)
    const path = `/returns/sale/${res.id}`
    useWorkspaceStore.getState().addTab({ key: path, title: res.returnNo, path })
    closeTab(); navigate(path)
  }
  async function handleSubmit() {
    if (locked) return
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
    if (isKit && items.some(i => !hasQuantityPrecision(i.quantity) || (i.source?.allowDecimalQty === false && !Number.isInteger(i.quantity)) || i.quantity > (i.remainingQty ?? 0))) { setSourceError('本次申请量不能超过来源剩余额度；数量最多两位小数，整数商品只能填整数'); return }

    try {
      setSubmitting(true)
      const body = {
        customerId: customer!.id, customerName: customer!.name,
        warehouseId: +warehouseId, warehouseName,
        saleOrderId: boundSource ? boundSource.id : undefined,
        saleOrderNo: orderNo || undefined,
        remark: remark.trim() || undefined,
        items: items.map(({ _key, originalQty, returnedQty, remainingQty, units, source, ...r }) => isKit ? ({ sourceItemId: r.sourceItemId, dispatchComponentId: r.dispatchComponentId, commercialComponentId: r.commercialComponentId, productId: r.productId, productCode: r.productCode, productName: r.productName, articleNumber: r.articleNumber, spec: r.spec, color: r.color, quantity: r.quantity, unit: r.unit, unitPrice: r.unitPrice }) : r),
        ...(isKit ? { commercialModel: 'kit-v1', expectedRevision: boundSource!.commercialRevision } : {})
      }
      if (isKit) {
        const answer = await write.submit(body, { action: 'saleReturn.create', kind: 'source-return-create', resourceType: 'sale_return' })
        if (answer && write.canApply(answer)) created(answer.data)
        return
      }
      const res = await createSaleReturnApi(body, requestKeyRef.current)
      requestKeyRef.current = createRequestKey('sale-return')
      created(res)
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
          <Button onClick={handleSubmit} disabled={submitting || locked} className="gap-1.5">
            {submitting ? (<><Loader2 className="h-4 w-4 animate-spin" />创建中…</>) : (<><Save className="h-4 w-4" />创建退货单</>)}
          </Button>
        }
      />

      {(sourceError || write.error || !ownerCurrent) && <p role="alert" className="text-sm text-destructive">{sourceError || write.error || '登录或服务器已变化，草稿保留'}</p>}
      {write.pending && <div className="rounded-md border p-3 space-y-2"><p>原创建结果待确认。刷新只保留查询身份，不会重新提交。</p><Button disabled={write.busy} onClick={() => void write.queryOriginal().then(answer => { if (answer?.queryOnly) toast.success(`原退货单 ${answer.data.returnNo} 结果已核实，当前草稿未修改，请自行打开原单`); else if (answer && write.canApply(answer)) created(answer.data) })}>查询原创建结果</Button><Button disabled={write.busy || !write.canRetry} onClick={() => void write.retry().then(answer => { if (answer && write.canApply(answer)) created(answer.data) })}>按原创建请求重试</Button></div>}
      {write.conflict && <div className="space-y-2 rounded-md border p-3"><p>原成交版本已变化，先备份当前草稿，再重读来源；不会自动合并。</p><Button onClick={() => void backup.copy(snapshot)}>复制草稿内容</Button><Button disabled={!backup.copied} onClick={() => { if (backup.canReload()) { clearSourceBinding(); backup.invalidate() } }}>备份后清除来源</Button>{backup.text && <><textarea aria-label="退货草稿备份" readOnly value={backup.text} /><Button onClick={() => backup.acknowledge(backup.text)}>已备份草稿</Button></>}</div>}
      <fieldset disabled={locked} className="contents">
      <SectionCard title="退货信息" compact>
        <div className="grid grid-cols-3 gap-x-5 gap-y-4">
          <div className="space-y-1.5">
            <Label>客户 *</Label>
            <PickerField
              value={customer?.name ?? ''}
              placeholder="点击选择客户…"
              onOpen={() => setCustomerFinderOpen(true)}
              onDoubleClick={() => { setCustomerFinderOpen(false); navigate('/customers') }}
              className={cn(customerError && 'border-destructive/60 bg-destructive/5', !!boundSource && 'pointer-events-none opacity-60')}
            />
            {customerError && <p className="text-xs text-destructive">请选择客户</p>}
          </div>
          <div className="space-y-1.5">
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
          <div className="space-y-1.5">
            <Label>关联原销售单号</Label>
            <div className="flex items-center gap-1">
              <Input
                value={orderNo}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  const next = e.target.value
                  sourceSerial.current++; currentOrderNo.current = next; setLoadingSource(false)
                  setOrderNo(next)
                  if (boundSource && next.trim() !== boundSource.orderNo) { setBoundSource(null); setItems([]) }
                }}
                placeholder="输入原单号"
                disabled={locked || (write.conflict && !!boundSource)}
              />
              {boundSource ? (
                <Button type="button" variant="ghost" size="sm" disabled={write.conflict && !backup.copied} onClick={clearSourceBinding}>清除</Button>
              ) : (
                <Button type="button" variant="outline" size="sm" onClick={() => void loadSourceOrder()} disabled={loadingSource || !orderNo.trim()}>
                  {loadingSource ? '载入中…' : '载入'}
                </Button>
              )}
            </div>
          </div>
          <div className="col-span-3 space-y-1.5">
            <Label>备注</Label>
            <Input value={remark} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRemark(e.target.value)} placeholder="选填" />
          </div>
        </div>

        {boundSource && (
          <div className="mt-3 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            已关联原单 {boundSource.orderNo}。{isKit ? '请按原成交行、实际出库批次和组件选择；原成交资料不随套定义改版变化。' : '退货单价默认取原单真实成交价，数量默认取剩余可退数量。'}
          </div>
        )}
      </SectionCard>

      {isKit && <SourceComponents items={boundSource!.items} disabled={locked} onSelect={selectSource} />}

      <SectionCard
        title="退货明细"
        compact
        actions={!boundSource ? (
          <Button type="button" size="sm" variant="outline" onClick={addItem} className="gap-1.5">+ 添加商品</Button>
        ) : undefined}
      >
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-12 text-center">
            <p className="text-sm text-muted-foreground">载入原销售单，或添加本次需要退回的商品。</p>
          </div>
        ) : (
          <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1320px] text-sm">
              <thead>
                <tr className="border-b text-table-head">
                  <ProductIdentityHeaders />
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
                      <ProductIdentityCells product={item} nameContent={<button
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
                            ? <span className="break-words font-medium">{item.productName}</span>
                            : <span className="text-muted-foreground">点击选择商品…</span>}
                        </button>} />
                      <td className="py-2.5 text-center text-muted-body">
                        {(!boundSource && item.units && item.units.filter(u => !u.isBase).length > 0) ? (
                          <select
                            aria-label="退货商品单位"
                            value={item.entryUnit || item.unit}
                            onChange={e => updateItem(item._key, 'entryUnit', e.target.value)}
                            className="h-8 rounded-md border border-border bg-background px-1 text-sm"
                          >
                            {(item.units || []).map(u => <option key={u.unitName} value={u.unitName}>{u.unitName}</option>)}
                          </select>
                        ) : ((item.entryUnit && item.entryUnit !== item.unit) ? item.entryUnit : (item.unit || '—'))}
                      </td>
                      <td className="py-2.5 pr-2">
                        <Input quantity
                          aria-label="退货数量" type="number" min="0.01" step={qtyStep(isKit ? item.source?.allowDecimalQty !== false : allowDecimalOf(item.productId))} placeholder="数量"
                          value={item.quantity}
                          max={isKit ? item.remainingQty : undefined}
                          disabled={!!boundSource && !isKit}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateItem(item._key, 'quantity', +e.target.value)}
                          className="text-right text-sm"
                        />
                        {item.entryUnit && item.entryUnit !== item.unit && (() => {
                          const rate = Number((item.units || []).find(u => u.unitName === item.entryUnit)?.conversionRate ?? 1)
                          return <p className="mt-1 text-right text-xs text-muted-foreground">= {(item.quantity * rate).toLocaleString()} {item.unit}</p>
                        })()}
                      </td>
                      <td className="py-2.5">
                        <Input
                          aria-label="退货单价" type="number" min="0" step="0.01" placeholder="单价"
                          value={item.unitPrice}
                          disabled={!!boundSource}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateItem(item._key, 'unitPrice', +e.target.value)}
                          className="text-right text-sm"
                        />
                      </td>
                      <td className="py-2.5 text-right font-medium tabular-nums">{isKit ? '保存后估算' : money(item.quantity * item.unitPrice)}</td>
                      <td className="py-2.5 text-center">
                        <Button type="button" size="sm" variant="ghost" aria-label="删除退货商品行" disabled={!!boundSource && !isKit} className="h-8 w-9 p-0 text-muted-foreground hover:text-destructive" onClick={() => removeItem(item._key)}>✕</Button>
                      </td>
                    </tr>
                    {(item.originalQty != null || item.returnedQty != null) && (
                      <tr className="border-b border-border/40">
                        <td colSpan={10} className="pb-2.5 pt-0 text-xs text-muted-foreground">
                          {isKit && <><SourceLabel source={item.source as ReturnSourceLabels} /><br /></>}原单数量 {Number(item.originalQty || 0).toFixed(2)}，{isKit ? '已申请' : '已退'} {Number(item.returnedQty || 0).toFixed(2)}，剩余可退 {Number(item.remainingQty || 0).toFixed(2)}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-border pt-4">
            <p className="text-muted-body">退货明细：{items.length} 行</p>
            <div className="text-right">
              <p className="text-helper">合计金额</p>
              <p className="text-2xl font-semibold text-foreground">{isKit ? '本次以保存后估算为准' : money(total)}</p>
            </div>
          </div>
          </>
        )}
      </SectionCard>

      </fieldset>
      <ProductFinder
        open={finderOpen}
        warehouseName={warehouseName}
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
          <SoftStatusLabel label="已取消" tone="danger" />
        ) : (
          <SoftStatusLabel label={task.statusName} tone={task.status === 5 ? 'success' : 'active'} />
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
      {!!task.rejectedQty && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive space-y-1">
          <p className="font-medium">质检发现不合格 {task.rejectedQty} 件，已隔离为待报废库存（不计入可用库存）</p>
          {(task.rejectedContainers || []).map(c => (
            <p key={c.id} className="text-muted-foreground">
              {c.barcode} · {c.productName} · {c.qty} 件
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

const REVERSE_PROGRESS_STEPS = [
  { status: 2, label: '拣货中' },
  { status: 6, label: '待出库' },
  { status: 7, label: '已出库' },
]

/**
 * 返货出库卡片（任务 1 第二期）：退货单已有合格品入库、取消时不会直接取消，
 * 而是挂着这张出库单等仓库把货退回客户。没有这张卡片，用户点完取消只看到
 * 「退货单还是已确认」，无从知道货还在仓库里等着出、也不知道该催谁。
 */
function ReverseTaskCard({ reverse }: { reverse: SaleReturnReverseTask }) {
  const currentIdx = REVERSE_PROGRESS_STEPS.findIndex(s => s.status === reverse.status)
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">返货出库（把已入库的货退回客户）</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">返货出库单：{reverse.taskNo}</p>
        </div>
        <SoftStatusLabel label={reverse.statusName} tone={reverse.status === 7 ? 'success' : 'active'} />
      </div>
      <p className="text-xs text-muted-foreground">
        该退货单已有合格品入库，不能直接取消。请仓库按 PDA 出库流程把这批货退回客户，
        出库完成后退货单自动取消；在此之前退货单保持「已确认」。
      </p>
      {reverse.status !== 7 && (
        <div className="flex items-center gap-1">
          {REVERSE_PROGRESS_STEPS.map((step, idx) => {
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
                {idx < REVERSE_PROGRESS_STEPS.length - 1 && (
                  <div className={`h-px flex-1 min-w-[8px] ${isDone ? 'bg-primary/30' : 'bg-border'}`} />
                )}
              </div>
            )
          })}
        </div>
      )}
      {reverse.containers.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-card p-3 text-xs space-y-1">
          <p className="font-medium text-foreground">
            待退回客户的库存条码（{reverse.containers.length} 个）
          </p>
          {reverse.containers.map(c => (
            <p key={c.id} className="text-muted-foreground">
              {c.barcode} · {c.productName} · {c.qty} 件
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

function DetailView({ returnId }: { returnId: number; closeTab: () => void; tabPath: string }) {
  const qc = useQueryClient()
  const [detailOwner] = useState(captureKitReadOwner)
  const facts = useSourceReturnFacts(returnId, detailOwner)
  const detailQuery = useQuery({
    queryKey: ['return-sale-detail', returnId, detailOwner.baseURL, detailOwner.userId, detailOwner.sessionGeneration],
    queryFn: async () => { assertKitReadOwner(detailOwner); const data = await getSaleReturnDetailApi(returnId, commercialReadConfig(detailOwner)); assertKitReadOwner(detailOwner); if (data.id !== returnId) throw new Error('原退货单身份不符'); return data },
    enabled: !!returnId,
    refetchInterval: 8000,
  })
  const ret = detailQuery.data
  const isKit = ret?.items?.some(item => item.dispatchComponentId != null) ?? false
  useWorkspaceTabTitle(ret?.returnNo)
  const isLoading = detailQuery.isLoading

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [pending, setPending] = useState(false)

  async function handleConfirm() {
    try {
      setPending(true)
      if (isKit) {
        const answer = await facts.perform('confirm')
        if (!answer) return
      } else await confirmSaleReturnApi(returnId)
      assertKitReadOwner(detailOwner)
      await qc.invalidateQueries({ queryKey: ['return-sale-detail', returnId] })
      await qc.invalidateQueries({ queryKey: ['returns'] })
      toast.success('已确认，已派发到 PDA')
    } catch { /* 业务失败由原全局反馈显示，保留单据。 */ } finally { setPending(false); setConfirmOpen(false) }
  }
  async function handleCancel() {
    try {
      setPending(true)
      const answer = isKit ? await facts.perform('cancel') : null
      if (isKit && !answer) return
      assertKitReadOwner(detailOwner)
      const res = isKit ? answer!.result : await cancelSaleReturnApi(returnId)
      await qc.invalidateQueries({ queryKey: ['return-sale-detail', returnId] })
      await qc.invalidateQueries({ queryKey: ['returns'] })
      // 已有合格品入库时后端生成返货出库单（202）而非直接取消，退货单此刻仍是已确认
      if (res?.pendingReverse) {
        toast.success(
          res.alreadyRequested
            ? `该退货单已有进行中的返货出库单 ${res.taskNo}，无需重复申请`
            : `退货单已有合格品入库，已生成返货出库单 ${res.taskNo}；请到仓库任务中完成返货出库，出库后退货单自动取消`,
          8000,
        )
      } else {
        toast.success('已取消')
      }
    } catch { /* 业务失败由原全局反馈显示，保留单据。 */ } finally { setPending(false); setCancelOpen(false) }
  }

  if (isLoading) {
    return <div className="flex h-40 items-center justify-center text-muted-body"><Loader2 className="mr-2 h-4 w-4 animate-spin" />加载中…</div>
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
              <Button variant="outline" className="border-destructive/30 text-destructive hover:bg-destructive/5" disabled={pending || facts.blocked} onClick={() => setCancelOpen(true)}>
                <X className="h-4 w-4 mr-1" />取消
              </Button>
            )}
            {ret.status === 1 && (
              <Button disabled={pending || facts.blocked} onClick={() => setConfirmOpen(true)}>确认（派发到 PDA）</Button>
            )}
          </>
        }
      />

      {facts.error && <p role="alert" className="text-sm text-destructive">{facts.error}</p>}
      {facts.record && <div className="rounded-md border p-3 space-y-2"><p>原{facts.record.action === 'confirm' ? '确认' : '取消'}结果待核对。该操作没有可查询的原请求结果，刷新不会重新提交。</p><Button disabled={facts.busy} onClick={() => void facts.queryFacts()}>查询当前单据</Button>{facts.fact && <><p className="text-sm">{facts.fact.text}</p><Button variant="outline" disabled={!facts.fact.satisfied || facts.busy} onClick={() => void facts.acknowledge(async () => {
        const result = await detailQuery.refetch()
        // React Query can resolve refetch with an error and retain stale data.
        if (!result.isSuccess || result.isError || !result.data) throw new Error('原退货单详情读取失败')
        assertKitReadOwner(detailOwner)
        if (result.data.id !== returnId) throw new Error('原退货单身份不符')
        return result.data
      })}>已核对当前单据</Button></>}</div>}

      <OrderDetailSections type="sale-return" id={ret.id} progress={ret.task ? <TaskProgressCard task={ret.task} /> : undefined}>
      {ret.reverseTask && <ReverseTaskCard reverse={ret.reverseTask} />}
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
            ...productIdentityColumns(),
            ...(isKit ? [{ key: 'source', title: '原成交 / 出库来源', width: 300, render: (_: unknown, item: ReturnItem) => item.dispatchComponentId != null ? <SourceLabel source={item.source} /> : '普通明细' }] : []),
            { key: 'unit', title: '单位', width: 70, render: (_, item) => <span className="text-muted-foreground">{(item.entryUnit && item.entryUnit !== item.unit) ? item.entryUnit : item.unit}</span> },
            { key: 'quantity', title: '数量', width: 120, align: 'right', render: (v, item) => (item.entryUnit && item.entryUnit !== item.unit && item.entryQty != null)
              ? <span className="tabular-nums">{item.entryQty} {item.entryUnit}<span className="ml-1 text-xs text-muted-foreground">（{Number(v)} {item.unit}）</span></span>
              : <span className="tabular-nums">{String(v)}</span> },
            { key: 'unitPrice', title: '单价', width: 120, align: 'right', render: (v, item) => (item.entryUnit && item.entryUnit !== item.unit && item.entryQty && item.entryQty > 0)
              ? <span className="tabular-nums" title={`¥${Number(v).toFixed(4)} / ${item.unit}`}>{money(item.amount / item.entryQty)}/{item.entryUnit}</span>
              : <span className="tabular-nums">{money(Number(v))}</span> },
            { key: 'amount', title: isKit ? (ret.status === 3 ? '实际净冲减' : '预计最多冲减') : '金额', width: 140, align: 'right', render: v => <span className="font-semibold tabular-nums">{isKit ? `¥${returnNet(Number(v))}` : money(Number(v))}</span> },
          ] satisfies TableColumn<ReturnItem>[]}
          data={ret.items ?? []}
          rowKey="id"
          emptyText="暂无退货明细"
        />
        <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
          <p className="text-muted-body">共 {ret.items?.length ?? 0} 行退货明细</p>
          <div className="text-right">
            <p className="text-helper">{isKit ? (ret.status === 3 ? '本单实际净冲减' : ret.status === 4 ? '原估算（已取消，不作为冲减）' : '本单预计最多冲减') : '合计金额'}</p>
            <p className="text-2xl font-semibold text-foreground">{isKit ? `¥${returnNet(ret.totalAmount)}` : money(Number(ret.totalAmount))}</p>
          </div>
        </div>
        {isKit && <p className="mt-3 text-xs text-muted-foreground">{ret.status === 3 ? '本单已完成，金额为系统按实际合格入仓结果确定的净冲减，保留四位；来源累计金额不是本单金额。' : '保存后为预计最多冲减；已确认、待收货或质检未完成均不代表已退款，合格入仓完成后由系统确定。'} 原分摊毛预算、实际净冲减与会计凭证两位金额分别计算；净冲减为零仍可能有退库成本。资金退款需走原退款出款流程。</p>}
      </SectionCard>

      </OrderDetailSections>

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
        description="取消后此退货单将无法恢复，请确认操作。若该退货单已有合格品入库，系统不会直接取消，而是生成一张返货出库单，等仓库把这批货退回客户后自动取消。"
        variant="destructive"
        confirmText="确认取消"
        loading={pending}
        onConfirm={handleCancel}
        onCancel={() => setCancelOpen(false)}
      />
    </div>
  )
}
