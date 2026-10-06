import { readHandlingSourceId, handlingConfig, mayHandle, handlingQty } from '@/lib/disposalHandlingRecovery'
import { PERMISSIONS as P } from '@/lib/permission-codes'
import { useDisposalHandlingSource } from '@/hooks/useDisposalHandlingSource'
import { useDisposalHandlingOperation } from '@/hooks/useDisposalHandlingOperation'
import { HandlingOperationPanel } from '@/pages/disposal/HandlingOperationPanel'
import { ApiClientError } from '@/api/client'
import { captureRefundOwner, refundOwnerCurrent, refundConfig, refundActivityEpoch, subscribeRefund, refundRevision, refundId } from '@/lib/supplierRefundRecovery'
import { SupplierRefundSourceButton } from '@/pages/supplier-refunds/SupplierRefundSourceButton'
import { money } from '@/lib/format'
import { OrderDetailSections } from '@/components/shared/OrderDetailSections'
import { ProductIdentityCells, ProductIdentityHeaders } from '@/components/shared/ProductIdentityCells'
import { productIdentityColumns } from '@/components/shared/productIdentityColumns'
/**
 * PurchaseReturnFormPage — 采购退货单新建 / 详情页面（独立路由）
 *
 * 路由：
 *   /returns/purchase/new  → 新建模式（空表单）
 *   /returns/purchase/:id  → 查看模式（已有退货单详情 + 操作按钮）
 *
 * 说明：退货单没有「编辑」能力——创建后只能确认（派发到 PDA）或取消，
 * 因此本文件只有 FormView（新建）与 DetailView（详情），没有 EditView。
 */

import { useState, useRef, useEffect, useSyncExternalStore, Fragment } from 'react'
import { useContext } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { buildWorkspaceTabRegistrationFromPath } from '@/router/workspaceRouteMeta'
import { readReturnSourceHandoff, type ReturnSourceHandoff } from '@/pages/returns/sourceHandoff'
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
import { SupplierFinder, ProductFinder } from '@/components/finder'
import { PickerField } from '@/components/shared/PickerField'
import { WarehouseSelect } from '@/components/shared/WarehouseSelect'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MAX_WORKSPACE_TABS, useWorkspaceStore } from '@/store/workspaceStore'
import { useWorkspaceTabTitle } from '@/hooks/useWorkspaceTabTitle'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import { toast } from '@/lib/toast'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { createRequestKey } from '@/lib/requestKey'
import { cn } from '@/lib/utils'
import {
  createPurchaseReturnApi, confirmPurchaseReturnApi, cancelPurchaseReturnApi,
  getPurchaseReturnSourceOrderApi, getPurchaseReturnDetailApi,
} from '@/api/returns'
import type { PurchaseReturn, PurchaseReturnSourceOrder, ReturnItem } from '@/api/returns'
import type { FinderResult } from '@/types/finder'
import type { ProductFinderResult, ProductUnit } from '@/types/products'
import { getProductApi } from '@/api/products'
import { useProductQtyPolicies } from '@/hooks/useProductQtyPolicies'
import { captureKitReadOwner, assertKitReadOwner } from '@/hooks/useKits'
import { commercialReadConfig } from '@/api/sale-commercial'
import { useAuthStore } from '@/store/authStore'
import { qtyStep } from '@/lib/qtyStep'
import DataTable from '@/components/shared/DataTable'
import type { TableColumn } from '@/types'

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
  entryUnit?: string        // 录入单位（多单位，文档03 Phase4a；无源手工退货可按箱录入）
  units?: ProductUnit[]     // UI-only：该商品多计量单位（供单位下拉），提交前 strip，不发后端
  quantity: number
  unitPrice: number
  originalQty?: number
  returnedQty?: number
  remainingQty?: number
}

export default function PurchaseReturnFormPage() {
  const contextPath = useContext(TabPathContext)
  const location = useLocation()
  const tabPath = contextPath || (location.pathname.startsWith('/returns/purchase/') ? location.pathname + location.search : '/returns/purchase/new')
  const registration = buildWorkspaceTabRegistrationFromPath(tabPath)
  const pathname = tabPath.split(/[?#]/)[0]
  const navigate = useNavigate()
  const isNew = pathname === '/returns/purchase/new'
  const rawId = pathname.split('/').pop() || ''
  const returnId = /^[1-9]\d*$/.test(rawId) && Number.isSafeInteger(Number(rawId)) ? Number(rawId) : null

  function closeTab(targetPath = '/returns/purchase') {
    const { removeTab } = useWorkspaceStore.getState()
    removeTab(registration.key)
    navigate(targetPath)
  }

  const handlingId = readHandlingSourceId(tabPath)
  if (handlingId === 'invalid' || (handlingId !== null && !isNew)) return <p role="alert">处理来源参数无效，请从来源列表重新打开；原参数保留</p>
  if (isNew && typeof handlingId === 'number') return <HandlingReturnView sourceId={handlingId} tabPath={tabPath} tabKey={registration.key} />
  if (isNew) return <FormView key={registration.key} tabPath={tabPath} tabKey={registration.key} />
  if (!returnId) return <p role="alert">退货单路由无效，请从列表重新打开</p>
  return <DetailView returnId={returnId!} closeTab={closeTab} tabPath={tabPath} />
}

// ════════════════════════════════════════════════════════════════════════════
// 新建视图
// ════════════════════════════════════════════════════════════════════════════

interface HandlingReturnProps { source: ReturnType<typeof useDisposalHandlingSource>; write: ReturnType<typeof useDisposalHandlingOperation>; operationUuid: string; requestKey: string }
function HandlingReturnView({ sourceId, tabPath, tabKey }: { sourceId: number; tabPath: string; tabKey: string }) {
  const source = useDisposalHandlingSource(sourceId, 2), [operationUuid] = useState(() => crypto.randomUUID()), [requestKey] = useState(() => createRequestKey('handling-return'))
  const write = useDisposalHandlingOperation(tabKey, source.active, () => source.isCurrent() && mayHandle(P.INVENTORY_DISPOSAL_VIEW, P.RETURN_ORDER_CREATE))
  return <FormView tabPath={tabPath} tabKey={tabKey} handling={{ source, write, operationUuid, requestKey }} />
}
function FormView({ tabPath, tabKey, handling }: { tabPath: string; tabKey: string; handling?: HandlingReturnProps }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const active = useActiveWorkspaceTab(), activeRef = useRef(active)
  activeRef.current = active
  const [createdReturn, setCreatedReturn] = useState<{ id: number; returnNo: string } | null>(null)
  const createdReturnRef = useRef<{ id: number; returnNo: string } | null>(null)
  const [owner] = useState(captureKitReadOwner)
  const sourceSerial = useRef(0), mounted = useRef(true), currentOrderNo = useRef('')
  useAuthStore(state => state.sessionGeneration)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  const [supplierFinderOpen, setSupplierFinderOpen] = useState(false)
  const [supplier, setSupplier] = useState<FinderResult | null>(null)
  const [warehouseId, setWarehouseId] = useState<string>('')
  const [warehouseName, setWarehouseName] = useState('')
  const [remark, setRemark] = useState('')
  const [handoff] = useState(() => readReturnSourceHandoff(tabPath, 'purchase'))
  const handoffActive = useRef(!!handoff && handoff !== 'invalid'), autoAttempted = useRef(false)
  const [orderNo, setOrderNo] = useState(handoff && handoff !== 'invalid' ? handoff.orderNo : '')
  const [loadingSource, setLoadingSource] = useState(false)
  const handlingActivityGeneration = handling?.source.activityGeneration
  useEffect(() => {
    if (handlingActivityGeneration === undefined) return
    // Cancel only this opt-in read's progress; keep the PO text, selected rows and employee inputs.
    sourceSerial.current++
    setLoadingSource(false)
  }, [handlingActivityGeneration])
  const [boundSource, setBoundSource] = useState<PurchaseReturnSourceOrder | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [sourceError, setSourceError] = useState(handoff === 'invalid' ? '原单交接参数无效，请核对来源；可清除后手动录入' : '')
  let ownerCurrent = true
  try { assertKitReadOwner(owner) } catch { ownerCurrent = false }
  const locked = !ownerCurrent || !!createdReturn || !!handling && (handling.write.blocked || !handling.source.current)
  const handlingCurrent = () => !!handling && handling.source.isCurrent() && !handling.write.blocked && activeRef.current && mayHandle(P.INVENTORY_DISPOSAL_VIEW, P.RETURN_ORDER_CREATE)
  // 稳定幂等键：整个原草稿生命周期复用同一 key；确认创建后阻止重复提交，不轮换成新请求。
  const requestKeyRef = useRef(createRequestKey('purchase-return'))

  const [items, setItems] = useState<DraftItem[]>([])
  // 「只能整数」的商品把退货数量框的 step 切成 1（迁移 254）
  const allowDecimalOf = useProductQtyPolicies(handling && (!handling.source.current || handling.write.blocked) ? [] : items.map(i => i.productId), handling ? { owner: handling.source.owner, isCurrent: () => handlingCurrent() && mayHandle(P.PRODUCT_VIEW) } : undefined)
  const [counter, setCounter] = useState(0)
  const [finderOpen, setFinderOpen] = useState(false)
  const [finderItemKey, setFinderItemKey] = useState<number | null>(null)

  const [supplierError, setSupplierError] = useState(false)
  const [warehouseError, setWarehouseError] = useState(false)
  const [invalidItemKeys, setInvalidItemKeys] = useState<Set<number>>(new Set())

  const isDirty = !createdReturn && !!(supplier || warehouseId || remark || orderNo || items.length)
  useDirtyGuard(tabKey, isDirty)

  const sourceDraftSnapshot = JSON.stringify({ supplier, warehouseId, warehouseName, remark, items })
  const sourceDraftRef = useRef(sourceDraftSnapshot), sourceLockedRef = useRef(locked || submitting)
  sourceDraftRef.current = sourceDraftSnapshot; sourceLockedRef.current = locked || submitting

  // 只在这个来源草稿首次挂载、未有原回执/冲突时预载；query 更新与清除不重填。
  useEffect(() => {
    if (handling || autoAttempted.current) return
    autoAttempted.current = true
    if (!handoff || handoff === 'invalid' || sourceLockedRef.current) return
    void loadSourceOrder(handoff.orderNo, handoff)
  })

  function addItem() {
    if (handling) return
    const key = counter
    setCounter(c => c + 1)
    setItems(p => [...p, { _key: key, productId: 0, productCode: '', productName: '', articleNumber: null, spec: null, color: null, unit: '', entryUnit: '', units: [], quantity: 1, unitPrice: 0 }])
    setFinderItemKey(key)
    setFinderOpen(true)
  }
  const removeItem = (k: number) => { if (!handling) setItems(p => p.filter(i => i._key !== k)) }
  const updateItem = (k: number, field: string, val: string | number) => {
    if (handling && (!handlingCurrent() || field !== 'quantity')) return
    setItems(p => p.map(i => (i._key === k ? { ...i, [field]: val } : i)))
  }

  function handleSupplierConfirm(result: FinderResult) {
    if (locked) return
    setSupplier(result)
    setSupplierError(false)
  }

  function handleFinderConfirm(product: ProductFinderResult) {
    if (handling) return
    if (finderItemKey === null) return
    const k = finderItemKey
    setItems(prev => prev.map(i => i._key === k
      ? { ...i, productId: product.id, productCode: product.code, productName: product.name, articleNumber: product.articleNumber ?? null, spec: product.spec ?? null, color: product.color ?? null, unit: product.unit, entryUnit: product.unit, units: [], unitPrice: product.costPrice ?? 0 }
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
    if (handling || createdReturnRef.current || locked || submitting) return
    handoffActive.current = false
    sourceSerial.current++; currentOrderNo.current = ''; setLoadingSource(false); setSourceError('')
    setBoundSource(null)
    setOrderNo('')
    setSupplier(null)
    setWarehouseId(''); setWarehouseName('')
    setItems([])
  }

  async function loadSourceOrder(number = orderNo, carried?: ReturnSourceHandoff) {
    if (sourceLockedRef.current || (handling && (!handlingCurrent() || !handling.source.data || boundSource))) return
    const trimmed = number.trim()
    const expected = carried ?? (handoffActive.current && handoff && handoff !== 'invalid' ? handoff : undefined)
    const draftAtRead = sourceDraftRef.current
    if (!trimmed) { toast.warning('请先填写关联原单号'); return }
    const serial = ++sourceSerial.current
    currentOrderNo.current = trimmed
    setLoadingSource(true); setSourceError('')
    try {
      assertKitReadOwner(owner)
      const source = await getPurchaseReturnSourceOrderApi(trimmed, handling ? handlingConfig(handling.source.owner) : commercialReadConfig(owner))
      if (!mounted.current || serial !== sourceSerial.current || currentOrderNo.current.trim() !== trimmed) return
      assertKitReadOwner(owner)
      if (sourceLockedRef.current || (handling && !handlingCurrent())) return
      if (sourceDraftRef.current !== draftAtRead) { setSourceError('草稿已修改，来源未覆盖输入；请核对后手动载入'); return }
      if (!source || !Number.isSafeInteger(source.id) || source.id <= 0 || source.orderNo !== trimmed || (expected && (source.id !== expected.id || source.orderNo !== expected.orderNo))) throw new Error('来源身份不符，原单号和草稿已保留，请重新核对')
      if (handling) {
        const origin = handling.source.data!.source
        if (source.warehouseId !== origin.warehouseId || !source.items.some(i => i.productId === origin.productId && i.unit === origin.unit && Number.isSafeInteger(i.sourceItemId) && i.sourceItemId > 0 && i.remainingQty > 0)) throw Error('该原采购单没有本来源商品、原仓、基本单位的准确可退行；不会降级手工退货')
      }
      setBoundSource(source)
      setSupplier({ id: source.supplierId, code: '', name: source.supplierName })
      setSupplierError(false)
      setWarehouseId(String(source.warehouseId)); setWarehouseName(source.warehouseName)
      setWarehouseError(false)
      const nextItems: DraftItem[] = (handling ? [] : source.items)
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
      if (handling) toast.success('已载入原采购单，请明确选择对应的可退行')
      else if (!nextItems.length) toast.warning('该原单已无剩余可退数量')
      else toast.success('已载入原单真实明细与成交价')
    } catch (e) { if (mounted.current && serial === sourceSerial.current && (!handling || handlingCurrent())) setSourceError(e instanceof Error ? e.message : '来源读取失败，输入已保留') }
    finally { if (mounted.current && serial === sourceSerial.current && (!handling || handlingCurrent())) setLoadingSource(false) }
  }

  function openCreatedReturn(res: { id: number; returnNo: string }) {
    if (handling && !handling.write.canApply(res)) return
    const workspace = useWorkspaceStore.getState()
    if (!mounted.current || !activeRef.current || workspace.activeKey !== tabKey) return
    try { assertKitReadOwner(owner) } catch { return }
    const path = `/returns/purchase/${res.id}`
    const hasOriginal = workspace.tabs.some(tab => tab.key === tabKey)
    const hasDetail = workspace.tabs.some(tab => tab.key === path)
    if (!hasDetail && workspace.tabs.length - (hasOriginal ? 1 : 0) >= MAX_WORKSPACE_TABS) {
      toast.warning('工作区标签已满，请先关闭不需要的页面，再查看已创建退货单')
      return
    }
    // 已确认的原草稿先腾自己的位置，不能让 addTab 的 LRU 驱逐另一份草稿。
    if (hasOriginal) workspace.removeTab(tabKey)
    if (workspace.addTab({ key: path, title: res.returnNo, path })) navigate(path)
  }

  async function handleSubmit() {
    if (createdReturnRef.current || locked || submitting || loadingSource) return
    if (handling && (!handlingCurrent() || !handling.source.data || !boundSource || items.length !== 1 || !items[0].sourceItemId || !handlingQty(items[0].quantity) || items[0].quantity > Math.min(items[0].remainingQty ?? 0, handling.source.data.source.budget.availableQuantity))) { toast.warning('请选择准确原采购行并核对可关联与可退基本量'); return }
    if (handoffActive.current && !boundSource) { toast.warning('请先载入并核对原单，或清除来源后按手工退货填写'); return }
    const missingSupplier = !supplier
    const missingWarehouse = !warehouseId
    setSupplierError(missingSupplier)
    setWarehouseError(missingWarehouse)
    if (missingSupplier) { toast.warning('请选择供应商'); return }
    if (missingWarehouse) { toast.warning('请选择仓库'); return }
    if (!items.length) { toast.warning('请添加至少一条退货明细'); return }
    const badItemKeys = new Set(items.filter(i => !i.productId || i.quantity <= 0).map(i => i._key))
    setInvalidItemKeys(badItemKeys)
    if (badItemKeys.size) { toast.warning('请完整填写所有明细'); return }

    try {
      assertKitReadOwner(owner)
      setSubmitting(true)
      const payload = {
        supplierId: supplier!.id, supplierName: supplier!.name,
        warehouseId: +warehouseId, warehouseName,
        purchaseOrderId: boundSource ? boundSource.id : undefined,
        purchaseOrderNo: boundSource?.orderNo || orderNo.trim() || undefined,
        remark: remark.trim() || undefined,
        items: items.map(({ _key, originalQty, returnedQty, remainingQty, units, ...r }) => r),
        ...(handling?.source.data ? { disposalSource: { sourceId: handling.source.data.source.id, expectedRevision: handling.source.data.source.revision, operationUuid: handling.operationUuid } } : {}),
      }
      const res = handling?.source.data
        ? await handling.write.submit({ kind: 'purchase_return', draftIdentity: tabKey, sourceId: handling.source.data.source.id, intentUuid: handling.source.data.source.intentUuid, operationUuid: handling.operationUuid, requestKey: handling.requestKey, path: '/returns/purchase', action: 'disposal.handling.purchase_return.create', body: payload }, (body, key, config) => createPurchaseReturnApi(body, key, config))
        : await createPurchaseReturnApi(payload, requestKeyRef.current)
      if (!mounted.current || !res || !('returnNo' in res) || (handling && !handling.write.canApply(res))) return
      assertKitReadOwner(owner)
      createdReturnRef.current = res; setCreatedReturn(res)
      try { await qc.invalidateQueries({ queryKey: ['returns'] }) } catch { /* 原创建已确认，列表刷新失败也不能再次提交。 */ }
      if (!mounted.current || (handling && !handling.write.canApply(res))) return
      assertKitReadOwner(owner)
      toast.success(`采购退货单 ${res.returnNo} 已创建`)
      openCreatedReturn(res)
    } catch (_) {
    } finally { if (mounted.current) setSubmitting(false) }
  }

  const total = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)

  return (
    <div className="flex flex-col gap-3">
      <ActionBar
        title="新建采购退货单"
        subtitle={isDirty ? <span className="text-xs font-normal text-muted-foreground">未保存</span> : undefined}
        rightActions={
          <Button onClick={handleSubmit} disabled={submitting || locked || loadingSource} className="gap-1.5">
            {submitting ? (<><Loader2 className="h-4 w-4 animate-spin" />创建中…</>) : (<><Save className="h-4 w-4" />创建退货单</>)}
          </Button>
        }
      />

      {handling && <><p>处理来源：{handling.source.data?.source.productName ?? '核对中'}；可关联基本量 {handling.source.data?.source.budget.availableQuantity ?? '—'}。请填写准确采购单并明确选择原采购行。</p>{handling.source.error && <p role="alert">{handling.source.error}</p>}<HandlingOperationPanel write={handling.write} />
      {boundSource && handling.source.data && <section aria-label="选择原采购行"><p>匹配来源的原采购行（同商品多行须明确选择）</p>{boundSource.items.filter(i => i.productId === handling.source.data!.source.productId && i.unit === handling.source.data!.source.unit && i.remainingQty > 0).map((i,index) => <Button key={i.sourceItemId} variant="outline" disabled={locked || submitting} onClick={() => {
        if (!handlingCurrent() || remark || items.length) { toast.warning('已有输入，未覆盖；请保留并核对'); return }
        setItems([{ _key: 1, sourceItemId: i.sourceItemId, productId: i.productId, productCode: i.productCode, productName: i.productName, articleNumber: i.articleNumber, spec: i.spec, color: i.color, unit: i.unit, quantity: 0, unitPrice: i.unitPrice, entryUnit: i.unit, units: [], originalQty: i.quantity, returnedQty: i.returnedQty, remainingQty: i.remainingQty }]); setCounter(2)
      }}>选择原采购第 {index + 1} 行（剩余 {i.remainingQty} {i.unit}，原价 {money(i.unitPrice)}）</Button>)}</section>}
      </>}
      {createdReturn && <div role="status" className="rounded-md border p-3 space-y-2"><p>退货单 {createdReturn.returnNo} 已创建，可查看单据。</p><Button variant="outline" disabled={!ownerCurrent} onClick={() => openCreatedReturn(createdReturn)}>查看已创建退货单</Button></div>}
      {(sourceError || !ownerCurrent) && <p role="alert" className="text-sm text-destructive">{sourceError || '登录或服务器已变化，草稿保留'}</p>}
      <fieldset disabled={locked || submitting} className="contents">
      <SectionCard title="退货信息" compact>
        <div className="flex flex-wrap items-start gap-4">
          <div className="w-[272px] shrink-0 space-y-1.5">
            <Label>供应商 *</Label>
            {handling ? <p className="py-2">{supplier?.name || '由准确原采购单确定'}</p> : <PickerField
              value={supplier?.name ?? ''}
              placeholder="点击选择供应商…"
              onOpen={() => setSupplierFinderOpen(true)}
              onDoubleClick={() => { setSupplierFinderOpen(false); navigate('/suppliers') }}
              className={cn(supplierError && 'border-destructive/60 bg-destructive/5', !!boundSource && 'pointer-events-none opacity-60')}
            />}
            {supplierError && <p className="text-xs text-destructive">请选择供应商</p>}
          </div>
          <div className="w-56 shrink-0 space-y-1.5">
            <Label>退货仓库 *</Label>
            {handling ? <p className="py-2">{warehouseName || handling.source.data?.source.warehouseName || '原仓核对中'}</p> : <WarehouseSelect
              value={warehouseId ? +warehouseId : null}
              onChange={(id, name) => { setWarehouseId(id ? String(id) : ''); setWarehouseName(name); setWarehouseError(false) }}
              placeholder="选择仓库"
              disabled={!!boundSource || !!handling}
              className={cn(warehouseError && 'border-destructive/60 bg-destructive/5')}
            />}
            {warehouseError && <p className="text-xs text-destructive">请选择仓库</p>}
          </div>
          <div className="w-64 shrink-0 space-y-1.5">
            <Label>关联原采购单号</Label>
            <div className="flex items-center gap-1">
              <Input
                value={orderNo}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  if (handling && !handlingCurrent()) return
                  const next = e.target.value
                  sourceSerial.current++; currentOrderNo.current = next; setLoadingSource(false); setSourceError('')
                  setOrderNo(next)
                  if (boundSource && next.trim() !== boundSource.orderNo) { setBoundSource(null); setItems([]) }
                }}
                placeholder="输入原单号"
                disabled={locked || submitting || (!!handling && !!boundSource)}
              />
              {!handling && !boundSource && (orderNo || sourceError) && <Button type="button" variant="ghost" size="sm" onClick={clearSourceBinding}>清除</Button>}
              {boundSource ? (
                <Button type="button" variant="ghost" size="sm" disabled={!!handling} onClick={clearSourceBinding}>清除</Button>
              ) : (
                <Button type="button" variant="outline" size="sm" onClick={() => void loadSourceOrder()} disabled={loadingSource || !orderNo.trim()}>
                  {loadingSource ? '载入中…' : '载入'}
                </Button>
              )}
            </div>
          </div>
          <div className="flex-1 space-y-1.5">
            <Label>备注</Label>
            <Input value={remark} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRemark(e.target.value)} placeholder="选填" />
          </div>
        </div>

        {!boundSource && <p className="mt-3 text-xs text-muted-foreground">本系统原单请填写单号并载入；无本系统原单的旧系统退货，可手工选择供应商、仓库与商品填写。</p>}
        {boundSource && (
          <div className="mt-3 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            已锚定原单 {boundSource.orderNo}。退货单价默认取原单真实成交价，数量默认取剩余可退数量。
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="退货明细"
        compact
        actions={!boundSource && !handling ? (
          <Button type="button" size="sm" variant="outline" onClick={addItem} className="gap-1.5">+ 添加商品</Button>
        ) : undefined}
      >
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-12 text-center">
            <p className="text-sm text-muted-foreground">还没有退货明细，点击上方"添加商品"或先绑定原采购单</p>
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
                          type="number" min="0.01" step={qtyStep(allowDecimalOf(item.productId))} placeholder="数量"
                          value={item.quantity}
                          disabled={!!boundSource && !handling}
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
                          type="number" min="0" step="0.01" placeholder="单价"
                          value={item.unitPrice}
                          disabled={!!boundSource}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateItem(item._key, 'unitPrice', +e.target.value)}
                          className="text-right text-sm"
                        />
                      </td>
                      <td className="py-2.5 text-right font-medium tabular-nums">{money(item.quantity * item.unitPrice)}</td>
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
            <p className="text-muted-body">商品明细：{items.length} 行</p>
            <div className="text-right">
              <p className="text-helper">合计金额</p>
              <p className="text-2xl font-semibold text-foreground">{money(total)}</p>
            </div>
          </div>
          </>
        )}
      </SectionCard>

      {!handling && <ProductFinder
        open={finderOpen}
        warehouseName={warehouseName}
        warehouseId={warehouseId ? +warehouseId : null}
        onConfirm={handleFinderConfirm}
        onClose={() => { setFinderOpen(false); setFinderItemKey(null) }}
      />}
      </fieldset>
      {!handling && <SupplierFinder
        open={supplierFinderOpen}
        onClose={() => setSupplierFinderOpen(false)}
        onConfirm={handleSupplierConfirm}
      />}
      <div className="h-4" />
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// 详情视图
// ════════════════════════════════════════════════════════════════════════════

const TASK_PROGRESS_STEPS = [
  { status: 2, label: '拣货中' },
  { status: 6, label: '待出库' },
  { status: 7, label: '已出库' },
]

function TaskProgressCard({ task }: { task: PurchaseReturn['task'] }) {
  if (!task) return null
  const currentIdx = TASK_PROGRESS_STEPS.findIndex(s => s.status === task.status)
  const isCancelled = task.status === 8
  return (
    <div className="rounded-lg border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">出库进度（PDA 拣货 → 出库）</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">仓库任务：{task.taskNo}</p>
        </div>
        {isCancelled ? (
          <SoftStatusLabel label="已取消" tone="danger" />
        ) : (
          <SoftStatusLabel label={task.statusName} tone={task.status === 7 ? 'success' : 'active'} />
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
  useSyncExternalStore(subscribeRefund, refundRevision)
  const [confirmOwner] = useState(captureRefundOwner), active = useActiveWorkspaceTab(), confirmActive = useRef({active,generation:0})
  if (confirmActive.current.active !== active) confirmActive.current.generation++
  confirmActive.current.active = active
  const [confirmError, setConfirmError] = useState<{message:string;purchaseReturnId?:number;current:()=>boolean} | null>(null)
  const qc = useQueryClient()
  const detailQuery = useQuery({
    queryKey: ['return-purchase-detail', returnId],
    queryFn: () => getPurchaseReturnDetailApi(returnId),
    enabled: !!returnId,
    refetchInterval: 8000,
  })
  const ret = detailQuery.data
  useWorkspaceTabTitle(ret?.returnNo)
  const isLoading = detailQuery.isLoading

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [pending, setPending] = useState(false)

  async function handleConfirm() {
    const generation = confirmActive.current.generation, activity = refundActivityEpoch()
    const current = () => confirmActive.current.active && confirmActive.current.generation === generation && refundActivityEpoch() === activity && refundOwnerCurrent(confirmOwner)
    if (!current() || !ret || ret.id !== returnId || ret.status !== 1) return
    const purchaseOrderId = ret.purchaseOrderId
    try {
      setPending(true)
      await confirmPurchaseReturnApi(returnId, { ...refundConfig(confirmOwner), skipGlobalError: true })
      if (!current()) return
      await qc.invalidateQueries({ queryKey: ['return-purchase-detail', returnId] })
      if (!current()) return
      await qc.invalidateQueries({ queryKey: ['returns'] })
      if (!current()) return
      toast.success('已确认，已派发到 PDA')
    } catch (error) {
      if (!current()) return
      const data = error instanceof ApiClientError ? error.data : null
      const source = data && typeof data === 'object' ? data as Record<string,unknown> : null
      const exact = error instanceof ApiClientError && error.status === 409 && error.code === 'PURCHASE_RETURN_REFUND_REQUIRED'
        && refundId(purchaseOrderId) && source?.purchaseReturnId === returnId && source?.purchaseOrderId === purchaseOrderId
      setConfirmError({ message: error instanceof Error ? error.message : '采购退货确认失败，请核对原单', purchaseReturnId: exact ? returnId : undefined, current })
    } finally { if (current()) { setPending(false); setConfirmOpen(false) } }
  }
  async function handleCancel() {
    try {
      setPending(true)
      const result = await cancelPurchaseReturnApi(returnId)
      await qc.invalidateQueries({ queryKey: ['return-purchase-detail', returnId] })
      await qc.invalidateQueries({ queryKey: ['returns'] })
      if (result?.pendingCancel) toast.warning('取消处理中，请先按原任务完成实物归还，完成后再次确认取消')
      else toast.success('已取消')
    } finally { setPending(false); setCancelOpen(false) }
  }

  if (isLoading) {
    return <div className="flex h-40 items-center justify-center text-muted-body"><Loader2 className="mr-2 h-4 w-4 animate-spin" />加载中…</div>
  }
  if (!ret) {
    return <div className="flex h-40 flex-col items-center justify-center gap-3 text-muted-foreground"><p className="text-sm">采购退货单不存在或已删除</p></div>
  }

  return (
    <div className="flex flex-col gap-3">
      <ActionBar
        title={ret.returnNo}
        subtitle={<StatusBadge type="returns" status={ret.status} />}
        rightActions={
          <>
            {ret.status === 1 && (
              <Button variant="outline" className="border-destructive/30 text-destructive hover:bg-destructive/5" disabled={pending} onClick={() => setCancelOpen(true)}>
                <X className="h-4 w-4 mr-1" />取消
              </Button>
            )}
            {ret.status === 1 && (
              <Button disabled={pending} onClick={() => setConfirmOpen(true)}>确认（派发到 PDA）</Button>
            )}
            {ret.status === 2 && (
              <Button variant="outline" className="border-destructive/30 text-destructive hover:bg-destructive/5" disabled={pending} onClick={() => setCancelOpen(true)}>
                <X className="h-4 w-4 mr-1" />取消
              </Button>
            )}
          </>
        }
      />

      {confirmError?.current() && <section data-pr-refund-error role="alert" className="space-y-2">
        <p>{confirmError.message}</p>
        {confirmError.purchaseReturnId && ret.status === 1 && <SupplierRefundSourceButton purchaseReturnId={confirmError.purchaseReturnId} disabled={detailQuery.isFetching || detailQuery.isError || detailQuery.isPaused}/>}
      </section>}
      <section className="space-y-2"><p>供应商退款与实物退货分别办理。原账款已付形成负余额时，从本采购退货草稿核对准确原付款分配，先登记真实回款，再继续实物退货。</p>{ret.status===1 && ret.purchaseOrderId && <SupplierRefundSourceButton purchaseReturnId={ret.id} disabled={detailQuery.isFetching||detailQuery.isError||detailQuery.isPaused}/>}</section>
      <OrderDetailSections type="purchase-return" id={ret.id} progress={ret.task ? <TaskProgressCard task={ret.task} /> : undefined}>
      <SectionCard title="基础信息" compact>
        <dl className="grid grid-cols-3 gap-x-6 gap-y-3 text-sm">
          {[
            ['供应商', ret.supplierName],
            ['仓库', ret.warehouseName],
            ['关联采购单', ret.purchaseOrderNo || '—'],
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
            { key: 'unit', title: '单位', width: 70, render: (_, item) => <span className="text-muted-foreground">{(item.entryUnit && item.entryUnit !== item.unit) ? item.entryUnit : item.unit}</span> },
            { key: 'quantity', title: '数量', width: 120, align: 'right', render: (v, item) => (item.entryUnit && item.entryUnit !== item.unit && item.entryQty != null)
              ? <span className="tabular-nums">{item.entryQty} {item.entryUnit}<span className="ml-1 text-xs text-muted-foreground">（{Number(v)} {item.unit}）</span></span>
              : <span className="tabular-nums">{String(v)}</span> },
            { key: 'unitPrice', title: '单价', width: 120, align: 'right', render: (v, item) => (item.entryUnit && item.entryUnit !== item.unit && item.entryQty && item.entryQty > 0)
              ? <span className="tabular-nums" title={`¥${Number(v).toFixed(4)} / ${item.unit}`}>{money(item.amount / item.entryQty)}/{item.entryUnit}</span>
              : <span className="tabular-nums">{money(Number(v))}</span> },
            { key: 'amount', title: '金额', width: 110, align: 'right', render: v => <span className="font-semibold tabular-nums">{money(Number(v))}</span> },
          ] satisfies TableColumn<ReturnItem>[]}
          data={ret.items ?? []}
          rowKey="id"
          emptyText="暂无退货明细"
        />
        <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
          <p className="text-muted-body">共 {ret.items?.length ?? 0} 行退货明细</p>
          <div className="text-right">
            <p className="text-helper">合计金额</p>
            <p className="text-2xl font-semibold text-foreground">{money(Number(ret.totalAmount))}</p>
          </div>
        </div>
      </SectionCard>

      </OrderDetailSections>

      <div className="h-4" />

      <ConfirmDialog
        open={confirmOpen}
        title="确认采购退货单"
        description="确认后将派发到 PDA，由仓库人员扫码拣货、出库；出库完成后自动扣减库存并冲减应付账款。"
        confirmText="确认"
        loading={pending}
        onConfirm={handleConfirm}
        onCancel={() => setConfirmOpen(false)}
      />
      <ConfirmDialog
        open={cancelOpen}
        title="取消采购退货单"
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
