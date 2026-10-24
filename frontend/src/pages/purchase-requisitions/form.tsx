import { ResizableTable } from '@/components/shared/ResizableTable'
import { productIdentityColumns } from '@/components/shared/productIdentityColumns'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import { useProcurementIntentRecovery, type RequisitionCreated } from '@/hooks/useProcurementIntentRecovery'
import ProcurementIntentRecoveryNotice from '@/components/shared/ProcurementIntentRecoveryNotice'
import { getWorkspaceListPath } from '@/lib/workspaceListNavigation'
import { OrderDetailSections } from '@/components/shared/OrderDetailSections'
import { DatePicker } from '@/components/shared/DatePicker'
import { ProductIdentityCells } from '@/components/shared/ProductIdentityCells'
import { SectionCard } from '@/components/shared/SectionCard'
/**
 * 采购申请单 — 新建 / 编辑 / 详情页（独立路由）
 *   /purchase-requisitions/new   → 新建
 *   /purchase-requisitions/:id   → 草稿可编辑；其余状态只读 + 按状态显示操作
 */
import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { ActionBar } from '@/components/shared/ActionBar'
import { WarehouseSelect } from '@/components/shared/WarehouseSelect'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { ProductFinder, SupplierFinder } from '@/components/finder'
import { PickerField } from '@/components/shared/PickerField'
import { useIdempotentSubmit } from '@/components/shared/payments/useIdempotentSubmit'
import { UncertainSubmitNotice } from '@/components/shared/payments/UncertainSubmitNotice'
import { createRequestKey } from '@/lib/requestKey'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { toast } from '@/lib/toast'
import { confirmAction } from '@/lib/confirm'
import { usePermission } from '@/hooks/usePermission'
import { useInvalidate } from '@/hooks/useInvalidate'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { PERMISSIONS } from '@/lib/permission-codes'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { useWorkspaceTabTitle } from '@/hooks/useWorkspaceTabTitle'
import {
  getRequisitionApi, updateRequisitionApi, submitRequisitionApi,
  withdrawRequisitionApi, cancelRequisitionApi, approveRequisitionApi, rejectRequisitionApi, convertRequisitionApi,
} from '@/api/purchase-requisitions'
import type { FinderResult } from '@/types/finder'
import { useProductQtyPolicies } from '@/hooks/useProductQtyPolicies'
import { qtyStep } from '@/lib/qtyStep'

interface EditItem {
  productId: number; productCode: string; productName: string; unit: string
  articleNumber?: string | null; spec?: string | null; color?: string | null
  quantity: string; estimatedPrice: string
  suggestedSupplierId: number | null; suggestedSupplierName: string
  convertedQty?: number
}
interface ConvertRow {
  requisitionItemId: number; productId: number; productName: string; remaining: number
  quantity: string; supplierId: number | null; supplierName: string; unitPrice: string
}

function Section({ title, children, actions, className }: { title: string; children: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return <SectionCard title={title} actions={actions} className={className} compact>{children}</SectionCard>
}

/** 多级审批流进度时间线（引擎实例快照展示；无实例时后端不返回 approval，前端不渲染） */
function ApprovalProgress({ approval }: { approval: NonNullable<import('@/types/purchase-requisition').PurchaseRequisition['approval']> }) {
  const INSTANCE = {
    1: { label: '审批中', tone: 'warning' as const },
    2: { label: '已批准', tone: 'success' as const },
    3: { label: '已驳回', tone: 'danger' as const },
    4: { label: '已撤销', tone: 'draft' as const },
  }
  const TASK = {
    1: { label: '待审批', tone: 'warning' as const },
    2: { label: '已批准', tone: 'success' as const },
    3: { label: '已驳回', tone: 'danger' as const },
  }
  const meta = INSTANCE[approval.status as keyof typeof INSTANCE] ?? { label: '未知', tone: 'draft' as const }

  return (
    <div className="card-base p-5">
      <div className="mb-3 flex items-center justify-between border-b border-border/50 pb-2">
        <h3 className="text-section-title">审批进度</h3>
        <SoftStatusLabel label={meta.label} tone={meta.tone} />
      </div>
      <div className="space-y-2">
        {(approval.tasks ?? []).map((t) => {
          const tm = TASK[t.status as keyof typeof TASK] ?? { label: '未知', tone: 'draft' as const }
          const isCurrent = approval.status === 1 && t.status === 1 && t.stepOrder === approval.currentStep
          return (
            <div key={t.stepOrder} className={`flex items-center gap-3 rounded-md border px-3 py-2 ${isCurrent ? 'border-warning/40 bg-warning/5' : 'border-border/50'}`}>
              <span className="text-sm font-medium">第 {t.stepOrder} 级</span>
              <SoftStatusLabel label={tm.label} tone={tm.tone} />
              <span className="text-sm text-muted-foreground">
                {t.approverName ? `审批人 ${t.approverName}` : '待处理'}
                {t.comment ? ` · ${t.comment}` : ''}
              </span>
              {t.actionAt && <span className="ml-auto text-xs text-muted-foreground">{formatDisplayDateTime(t.actionAt)}</span>}
              {isCurrent && <span className="ml-auto text-xs text-warning-ink">当前</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function RequisitionFormPage() {
  const tabPath = useContext(TabPathContext) || ''
  const isNew = tabPath === '/purchase-requisitions/new'
  const editId = isNew ? null : Number(tabPath.split('/').pop())
  const navigate = useNavigate()
  const { can } = usePermission()
  const invalidate = useInvalidate()

  const { data: detail, isLoading, refetch } = useQuery({
    queryKey: ['requisition', editId],
    queryFn: () => getRequisitionApi(editId as number),
    enabled: !!editId,
  })
  useWorkspaceTabTitle(detail?.requisitionNo)

  const status = detail?.status ?? 1
  const editable = isNew || status === 1     // 新建或草稿态可编辑

  const [title, setTitle] = useState('')
  const [warehouseId, setWarehouseId] = useState<number | null>(null)
  const [warehouseName, setWarehouseName] = useState('')
  const [expectedDate, setExpectedDate] = useState('')
  const [items, setItems] = useState<EditItem[]>([])
  const [busy, setBusy] = useState(false)
  const active=useActiveWorkspaceTab(), creation=useProcurementIntentRecovery('requisition-create',undefined,isNew&&active)
  const createRunning=useRef(false), inputFrozen=busy || isNew&&creation.blocked
  const latestCreationAllowed=useRef(false);latestCreationAllowed.current=!inputFrozen
  const mayChange=()=>!createRunning.current&&latestCreationAllowed.current

  // finder / 弹窗状态
  const [productFinderOpen, setProductFinderOpen] = useState(false)
  const [supplierTarget, setSupplierTarget] = useState<{ scope: 'item' | 'convert'; index: number } | null>(null)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [convertOpen, setConvertOpen] = useState(false)
  const [convertRows, setConvertRows] = useState<ConvertRow[]>([])
  // 转单提交的幂等守卫：请求键在「同一次转单意图」内稳定，只有拿到**确定结果**才轮换
  // （成功 / 明确 4xx 拒绝）。「没收到答复」时保留键——服务器可能已经建了采购单。
  // 载荷指纹用于识别「用户改了转采购数量」：那是新意图，上一笔已确定时换新键；
  // 上一笔**结果未确认**时必须先用原内容查回执，改内容重提会被后端沿用上次内容。
  const convertGuard = useIdempotentSubmit({ action: `purchase.requisition.convert.${editId ?? 0}`, prefix: 'req-convert' })
  const convertPayloadRef = useRef<string | null>(null)
  // 「只能整数」的商品把请购/转采购数量框的 step 切成 1（迁移 254）
  const allowDecimalOf = useProductQtyPolicies([...items.map(i => i.productId), ...convertRows.map(r => r.productId)])

  const initial = useMemo(() => {
    if (detail && editId) {
      return {
        title: detail.title ?? '',
        warehouseId: detail.warehouseId,
        warehouseName: detail.warehouseName,
        expectedDate: detail.expectedDate ?? '',
        items: (detail.items ?? []).map(i => ({
          productId: i.productId, productCode: i.productCode ?? '', productName: i.productName ?? '', unit: i.unit ?? '', articleNumber: i.articleNumber ?? null, spec: i.spec ?? null, color: i.color ?? null,
          quantity: String(i.quantity), estimatedPrice: i.estimatedPrice != null ? String(i.estimatedPrice) : '',
          suggestedSupplierId: i.suggestedSupplierId ?? null, suggestedSupplierName: i.suggestedSupplierName ?? '',
          convertedQty: i.convertedQty ?? 0,
        })),
      }
    }
    return null
  }, [detail, editId])

  useEffect(() => {
    if (initial) {
      setTitle(initial.title); setWarehouseId(initial.warehouseId); setWarehouseName(initial.warehouseName)
      setExpectedDate(initial.expectedDate); setItems(initial.items)
    }
  }, [initial])

  // 未保存变更保护：新建有输入即脏；编辑对比 initial 基线（关闭标签时拦截）
  const isDirty = useMemo(() => {
    if (!editable) return false
    if (!initial) return !!(title.trim() || warehouseId != null || expectedDate || items.length > 0)
    return title !== initial.title
      || warehouseId !== initial.warehouseId
      || expectedDate !== initial.expectedDate
      || items.length !== initial.items.length
      || items.some((it, i) => {
        const b = initial.items[i]
        return !b || it.quantity !== b.quantity || it.estimatedPrice !== b.estimatedPrice || it.suggestedSupplierId !== b.suggestedSupplierId
      })
  }, [editable, initial, title, warehouseId, expectedDate, items])
  useDirtyGuard(tabPath, isDirty || isNew&&creation.blocked)

  function setItem(idx: number, patch: Partial<EditItem>) {
    if(!mayChange())return
    setItems(list => list.map((it, i) => i === idx ? { ...it, ...patch } : it))
  }
  function removeItem(idx: number) { if(!mayChange())return;setItems(list => list.filter((_, i) => i !== idx)) }

  function onPickProduct(p: { id: number; code?: string; name: string; unit?: string; articleNumber?: string | null; spec?: string | null; color?: string | null }) {
    if(!mayChange())return
    setItems(list => [...list, {
      productId: p.id, productCode: p.code ?? '', productName: p.name, unit: p.unit ?? '',
      articleNumber: p.articleNumber ?? null, spec: p.spec ?? null, color: p.color ?? null,
      quantity: '1', estimatedPrice: '', suggestedSupplierId: null, suggestedSupplierName: '',
    }])
    setProductFinderOpen(false)
  }

  function onPickSupplier(result: FinderResult) {
    if (!supplierTarget || isNew&&!mayChange()) return
    if (supplierTarget.scope === 'item') setItem(supplierTarget.index, { suggestedSupplierId: result.id, suggestedSupplierName: result.name })
    else setConvertRows(rows => rows.map((r, i) => i === supplierTarget.index ? { ...r, supplierId: result.id, supplierName: result.name } : r))
    setSupplierTarget(null)
  }

  function buildPayload() {
    if (!warehouseId) { toast.warning('请选择期望入库仓'); return null }
    if (!items.length) { toast.warning('请至少添加一条采购申请明细'); return null }
    for (const it of items) {
      if (!it.quantity || Number(it.quantity) <= 0) { toast.warning(`商品「${it.productName}」的采购申请数量必须大于 0`); return null }
    }
    return {
      title: title || undefined,
      warehouseId,
      expectedDate: expectedDate || null,
      items: items.map(it => ({
        productId: it.productId,
        quantity: Number(it.quantity),
        estimatedPrice: it.estimatedPrice !== '' ? Number(it.estimatedPrice) : null,
        suggestedSupplierId: it.suggestedSupplierId,
        remark: undefined,
      })),
    }
  }

  async function run(fn: () => Promise<unknown>, okMsg: string, close = false) {
    setBusy(true)
    try {
      await fn()
      toast.success(okMsg)
      if (close) closeTab()
      else await refetch()
    } catch (e) { toast.error(e instanceof Error ? e.message : '操作失败') }
    finally { setBusy(false) }
  }

  function runApproval(fn: () => Promise<unknown>, okMsg: string) {
    return run(async () => {
      const result = await fn()
      invalidate('approval_pending_changed')
      return result
    }, okMsg)
  }

  async function handleSave() {
    const payload = buildPayload(); if (!payload) return
    if (editId) await run(() => updateRequisitionApi(editId, payload), '已保存')
    else {
      if(createRunning.current || creation.blocked)return
      createRunning.current=true;setBusy(true)
      try { const answer=await creation.submit(payload);if(answer)created(answer.data as RequisitionCreated) }
      catch(e){toast.error(e instanceof Error?e.message:'创建结果待确认，请查询原申请')}
      finally{createRunning.current=false;setBusy(false)}
    }
  }

  function created(result:RequisitionCreated){
    toast.success('采购申请单已创建')
    if(can(PERMISSIONS.PURCHASE_REQUISITION_VIEW))viewCreated(result.id,result.requisitionNo)
  }
  function viewCreated(id:number,requisitionNo=''){
    if(!can(PERMISSIONS.PURCHASE_REQUISITION_VIEW))return
    const path=`/purchase-requisitions/${id}`
    useWorkspaceStore.getState().addTab({key:path,title:requisitionNo?`采购申请单 ${requisitionNo}`:'采购申请单',path});navigate(path)
  }

  function closeTab() {
    useWorkspaceStore.getState().removeTab(tabPath)
    navigate(getWorkspaceListPath('/purchase-requisitions'))
  }

  function openConvert() {
    const rows: ConvertRow[] = (detail?.items ?? [])
      .filter(i => Number(i.quantity) - Number(i.convertedQty ?? 0) > 1e-9)
      .map(i => ({
        requisitionItemId: i.id as number, productId: Number(i.productId), productName: i.productName ?? '',
        remaining: Number(i.quantity) - Number(i.convertedQty ?? 0),
        quantity: String(Number(i.quantity) - Number(i.convertedQty ?? 0)),
        supplierId: i.suggestedSupplierId ?? null, supplierName: i.suggestedSupplierName ?? '', unitPrice: '',
      }))
    if (!rows.length) { toast.warning('没有可转采购的明细'); return }
    setConvertRows(rows); setConvertOpen(true)
  }

  async function submitConvert() {
    const lines = convertRows
      .filter(r => Number(r.quantity) > 0)
      .map(r => ({ requisitionItemId: r.requisitionItemId, quantity: Number(r.quantity), supplierId: r.supplierId as number, supplierName: r.supplierName, unitPrice: Number(r.unitPrice || 0) }))
    if (!lines.length) { toast.warning('请至少填写一行转采购数量'); return }
    for (const r of convertRows) {
      if (Number(r.quantity) > 0 && !r.supplierId) { toast.warning(`商品「${r.productName}」必须指定供应商`); return }
      if (Number(r.quantity) > r.remaining + 1e-9) { toast.warning(`商品「${r.productName}」转采购数量超过可转余量`); return }
    }

    // 载荷（转采购内容）指纹：变化即「新的转单意图」。
    // · 上一笔已确定 ⇒ 换新键，正常提交新的转单；
    // · 上一笔**结果未确认** ⇒ 阻止：服务器可能已经按上次内容建过采购单，
    //   同键重提会沿用上次内容（改了数量也不会按新数量执行），必须先查回执。
    const fingerprint = JSON.stringify(lines)
    const payloadChanged = convertPayloadRef.current !== null && convertPayloadRef.current !== fingerprint
    if (payloadChanged && convertGuard.isUncertain()) {
      toast.warning('上次转单没有收到确定答复，系统可能已经建过采购单：请先点「查询上次结果」确认，再修改内容重新提交')
      return
    }
    if (payloadChanged) convertGuard.keyRef.current = createRequestKey('req-convert')
    convertPayloadRef.current = fingerprint

    setBusy(true)
    // remember 必须在**发请求之前**：断网/超时路径拿不到 res，若等到成功再记，
    // 未确认期间 lastLabel/lastAction 仍是上一次（或空），组件复用/资源变化后用错 action 查回执。
    convertGuard.remember(`请购单 ${detail?.requisitionNo ?? ''} · 转采购 ${lines.length} 行`)
    try {
      const res = await convertRequisitionApi(editId as number, lines, convertGuard.keyRef.current)
      convertGuard.settle()   // 拿到确定结果：这一笔已结束，下一次用新键
      toast.success(`已生成 ${res!.createdOrders.length} 张采购单${res!.completed ? '，采购申请单已结案' : ''}`)
      setConvertOpen(false)
      await refetch()
    } catch (e) {
      // 分类决定是否换键：超时/断网 ⇒ 保留键（服务器可能已建成），弹窗保留并显示「未确认」提示条；
      // 明确 4xx ⇒ 已换键，下次是全新一笔。
      convertGuard.classify(e)
      toast.error(e instanceof Error ? e.message : '转采购单失败')
    }
    finally { setBusy(false) }
  }

  if (editId && !detail && !isLoading) {
    return <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">采购申请单不存在</div>
  }

  const canCreate = can(PERMISSIONS.PURCHASE_REQUISITION_CREATE)
  const canApprove = can(PERMISSIONS.PURCHASE_REQUISITION_APPROVE)
  const canConvert = can(PERMISSIONS.PURCHASE_REQUISITION_CONVERT)

  return (
    <div className="desktop-document-form desktop-requisition-form flex flex-col gap-4">
      <ActionBar
        title={isNew ? '新建采购申请单' : `采购申请单 ${detail?.requisitionNo ?? ''}`}
        description="核对申请仓库、到货日期与商品。"
        subtitle={detail ? <SoftStatusLabel label={detail.statusName} tone={detail.statusTone} /> : undefined}
        rightActions={
          <div className="flex flex-wrap gap-2">
            {editable && canCreate && <Button onClick={handleSave} disabled={inputFrozen}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : '保存'}</Button>}
            {editId && status === 1 && canCreate && <Button variant="outline" disabled={inputFrozen} onClick={() => runApproval(() => submitRequisitionApi(editId), '已提交审批')}>提交审批</Button>}
            {status === 2 && canCreate && <Button variant="outline" disabled={inputFrozen} onClick={() => runApproval(() => withdrawRequisitionApi(editId as number), '已撤回')}>撤回</Button>}
            {status === 2 && canApprove && <Button disabled={inputFrozen} onClick={() => runApproval(() => approveRequisitionApi(editId as number), '已批准')}>批准</Button>}
            {status === 2 && canApprove && <Button variant="outline" disabled={inputFrozen} onClick={() => setRejectOpen(true)}>驳回</Button>}
            {status === 3 && canConvert && <Button disabled={inputFrozen} onClick={openConvert}>转采购单</Button>}
            {editId && (status === 1 || status === 2 || status === 4) && canCreate && (
              <Button variant="ghost" className="text-destructive-ink" disabled={inputFrozen}
                onClick={() => confirmAction({ title: '取消采购申请单', description: '确定取消这张采购申请单吗？此操作不可撤销。', onConfirm: () => runApproval(() => cancelRequisitionApi(editId), '已取消') })}>取消</Button>
            )}
          </div>
        }
      />

      {isNew&&<ProcurementIntentRecoveryNotice recovery={creation} onConfirmed={answer=>{if(!answer.queryOnly)created(answer.data as RequisitionCreated)}} onViewRequisition={can(PERMISSIONS.PURCHASE_REQUISITION_VIEW)?id=>viewCreated(id):undefined}/>}

      {detail?.status === 4 && detail.rejectReason && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive-ink">驳回原因：{detail.rejectReason}</div>
      )}


      <OrderDetailSections type="requisition" id={editId || 0} progress={detail?.approval ? <ApprovalProgress approval={detail.approval} /> : undefined}>
      <Section title="基本信息">
        <div className="desktop-form-fields desktop-requisition-fields grid grid-cols-4 gap-x-5 gap-y-4">
          <div className="space-y-1.5">
            <Label>事由</Label>
            <Input value={title} onChange={e => {if(mayChange())setTitle(e.target.value)}} disabled={!editable || inputFrozen} maxLength={100} placeholder="选填，如「前置仓补货」" />
          </div>
          <div className="space-y-1.5">
            <Label>期望入库仓 *</Label>
            {editable
              ? <WarehouseSelect value={warehouseId} onChange={(id, name) => {if(!mayChange())return;setWarehouseId(id); setWarehouseName(name) }} placeholder="选择期望入库仓" disabled={inputFrozen} />
              : <Input value={warehouseName} disabled />}
          </div>
          <div className="space-y-1.5">
            <Label>期望到货日</Label>
            <DatePicker value={expectedDate ? String(expectedDate).slice(0, 10) : ''} onChange={value=>{if(mayChange())setExpectedDate(value)}} disabled={!editable || inputFrozen} />
          </div>
          {detail && (
            <div className="space-y-1.5">
              <Label>申请人</Label>
              <Input value={detail.applicantName} disabled />
            </div>
          )}
        </div>
      </Section>

      <Section title="采购申请明细" className="desktop-requisition-items" actions={editable && <Button size="sm" variant="outline" onClick={() => setProductFinderOpen(true)} disabled={inputFrozen}><Plus className="mr-1 h-4 w-4" />添加商品</Button>}>
        <div className="overflow-x-auto">
          <ResizableTable columns={[...productIdentityColumns({ compact: true }), { key: 'unit', title: '单位', width: 80 }, { key: 'quantity', title: '采购申请数量', width: 112, align: 'right' }, { key: 'price', title: '预估单价', width: 112, align: 'right' }, { key: 'supplier', title: '建议供应商', width: 192 }, ...(editable ? [{ key: 'actions', title: '操作', width: 80 }] : [{ key: 'converted', title: '已转采购', width: 96, align: 'right' as const }])]} columnStorageKey="requisition-entry-items" minWidth={1000}>
            <tbody>
              {items.length === 0 ? (
                <tr><td colSpan={6} className="desktop-requisition-empty text-center text-muted-foreground">暂无明细{editable ? '，点右上角「添加商品」' : ''}</td></tr>
              ) : items.map((it, idx) => (
                <tr key={idx} className="border-b border-border/40">
                  <ProductIdentityCells compact product={it} /><td className="px-3 py-3">{it.unit || '—'}</td>
                  <td className="px-3 py-2 text-right">
                    {editable ? <Input quantity type="number" step={qtyStep(allowDecimalOf(it.productId))} min="0" value={it.quantity} onChange={e => setItem(idx, { quantity: e.target.value })} disabled={inputFrozen} className="h-8 text-right tabular-nums" />
                      : <span className="tabular-nums">{it.quantity}</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {editable ? <Input type="number" step="0.01" min="0" value={it.estimatedPrice} onChange={e => setItem(idx, { estimatedPrice: e.target.value })} disabled={inputFrozen} className="h-8 text-right tabular-nums" placeholder="选填" />
                      : <span className="tabular-nums text-muted-foreground">{it.estimatedPrice || '—'}</span>}
                  </td>
                  <td className="px-3 py-2">
                    {editable ? <PickerField value={it.suggestedSupplierName} placeholder="选填，可转单时定" disabled={inputFrozen} onOpen={() => setSupplierTarget({ scope: 'item', index: idx })} />
                      : <span className="text-muted-foreground">{it.suggestedSupplierName || '—'}</span>}
                  </td>
                  {!editable && <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{it.convertedQty ?? 0}</td>}
                  {editable && <td className="px-3 py-2 text-center"><Button size="icon" variant="ghost" className="h-7 w-7 text-destructive-ink" aria-label="删除本行明细" onClick={() => removeItem(idx)} disabled={inputFrozen}><Trash2 className="h-4 w-4" /></Button></td>}
                </tr>
              ))}
            </tbody>
          </ResizableTable>
        </div>
      </Section>

      </OrderDetailSections>

      <ProductFinder mode="purchase" warehouseName={warehouseName} open={productFinderOpen} warehouseId={warehouseId} onConfirm={onPickProduct} onClose={() => setProductFinderOpen(false)} />
      <SupplierFinder open={!!supplierTarget} onClose={() => setSupplierTarget(null)} onConfirm={onPickSupplier} />

      {/* 驳回原因 */}
      <Dialog open={rejectOpen} onOpenChange={v => !v && setRejectOpen(false)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader description={"填写驳回原因，供申请人调整。"}><DialogTitle>驳回采购申请单</DialogTitle></DialogHeader>
          <div className="space-y-2 py-2">
            <Label>驳回原因 *</Label>
            <textarea aria-label="驳回原因" className="min-h-28 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={rejectReason} onChange={e => setRejectReason(e.target.value)} maxLength={300} placeholder="请填写驳回原因" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)} disabled={inputFrozen}>取消</Button>
            <Button disabled={busy || !rejectReason.trim()} onClick={async () => { await runApproval(() => rejectRequisitionApi(editId as number, rejectReason.trim()), '已驳回'); setRejectOpen(false); setRejectReason('') }}>确认驳回</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 转采购单 */}
      <Dialog open={convertOpen} onOpenChange={v => !v && setConvertOpen(false)}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader description={<>{<>按供应商自动拆分成多张采购单草稿。每行填转采购数量、供应商与单价；数量填 0 表示本次不转。</>}</>}><DialogTitle>转采购单</DialogTitle></DialogHeader>

          <div className="max-h-[50vh] overflow-y-auto py-2">
            <ResizableTable columns={[...productIdentityColumns({ compact: true }), { key: 'unit', title: '单位', width: 80 }, { key: 'remaining', title: '可转余量', width: 96, align: 'right' }, { key: 'quantity', title: '转采购', width: 96, align: 'right' }, { key: 'supplier', title: '供应商', width: 160 }, { key: 'unitPrice', title: '单价', width: 96, align: 'right' }]} columnStorageKey="requisition-convert-items" minWidth={1000}>
              <tbody>
                {convertRows.map((r, idx) => (
                  <tr key={r.requisitionItemId} className="border-b border-border/40">
                    <ProductIdentityCells compact product={detail?.items?.find(item => item.id === r.requisitionItemId) ?? r} /><td className="px-3 py-3">{detail?.items?.find(item => item.id === r.requisitionItemId)?.unit || '—'}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{r.remaining}</td>
                    <td className="px-2 py-2"><Input quantity type="number" step={qtyStep(allowDecimalOf(r.productId))} min="0" max={r.remaining} value={r.quantity} onChange={e => setConvertRows(rows => rows.map((x, i) => i === idx ? { ...x, quantity: e.target.value } : x))} className="h-8 text-right tabular-nums" /></td>
                    <td className="px-2 py-2"><PickerField value={r.supplierName} placeholder="选择供应商" onOpen={() => setSupplierTarget({ scope: 'convert', index: idx })} /></td>
                    <td className="px-2 py-2"><Input type="number" step="0.01" min="0" value={r.unitPrice} onChange={e => setConvertRows(rows => rows.map((x, i) => i === idx ? { ...x, unitPrice: e.target.value } : x))} className="h-8 text-right tabular-nums" placeholder="0.00" /></td>
                  </tr>
                ))}
              </tbody>
            </ResizableTable>
          </div>
          <UncertainSubmitNotice
            visible={convertGuard.uncertain}
            pending={convertGuard.checkMut.isPending}
            what={convertGuard.lastLabelRef.current ?? undefined}
            // 转采购只生成采购单草稿、**不入会计**：用业务文案，不沿用付款的「记账」措辞
            message={`上次转单没有收到确定答复，系统可能已经建过采购单${convertGuard.lastLabelRef.current ? `（${convertGuard.lastLabelRef.current}）` : ''}。请先点「查询上次结果」；查清之前请勿关掉重开重新提交，也不要改动转单内容后再提交——同一次提交系统会沿用上次的内容，重复提交不会重复建单，但改了内容再提交也不会按新内容建单。`}
            onCheck={() => convertGuard.checkLastResult(() => { setConvertOpen(false); void refetch() })}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setConvertOpen(false)} disabled={inputFrozen}>取消</Button>
            <Button disabled={inputFrozen} onClick={submitConvert}>{busy ? '生成中…' : '生成采购单'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
