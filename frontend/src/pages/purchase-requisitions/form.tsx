import { OrderDetailSections } from '@/components/shared/OrderDetailSections'
import { ProductIdentityCells, ProductIdentityHeaders } from '@/components/shared/ProductIdentityCells'
import { SectionCard } from '@/components/shared/SectionCard'
/**
 * 采购申请单 — 新建 / 编辑 / 详情页（独立路由）
 *   /purchase-requisitions/new   → 新建
 *   /purchase-requisitions/:id   → 草稿可编辑；其余状态只读 + 按状态显示操作
 */
import { useContext, useEffect, useMemo, useState } from 'react'
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
import { ProductFinder, SupplierFinder, FinderTrigger } from '@/components/finder'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { toast } from '@/lib/toast'
import { confirmAction } from '@/lib/confirm'
import { usePermission } from '@/hooks/usePermission'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { PERMISSIONS } from '@/lib/permission-codes'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { useWorkspaceStore } from '@/store/workspaceStore'
import {
  getRequisitionApi, createRequisitionApi, updateRequisitionApi, submitRequisitionApi,
  withdrawRequisitionApi, cancelRequisitionApi, approveRequisitionApi, rejectRequisitionApi, convertRequisitionApi,
} from '@/api/purchase-requisitions'
import type { FinderResult } from '@/types/finder'

interface EditItem {
  productId: number; productCode: string; productName: string; unit: string
  articleNumber?: string | null; spec?: string | null; color?: string | null
  quantity: string; estimatedPrice: string
  suggestedSupplierId: number | null; suggestedSupplierName: string
  convertedQty?: number
}
interface ConvertRow {
  requisitionItemId: number; productName: string; remaining: number
  quantity: string; supplierId: number | null; supplierName: string; unitPrice: string
}

function Section({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return <SectionCard title={title} actions={actions} compact>{children}</SectionCard>
}

/** 多级审批流进度时间线（引擎实例快照展示；无实例时后端不返回 approval，前端不渲染） */
function ApprovalProgress({ approval }: { approval: NonNullable<import('@/types/purchase-requisition').PurchaseRequisition['approval']> }) {
  const INSTANCE = {
    1: { label: '审批中', tone: 'warning' as const },
    2: { label: '已通过', tone: 'success' as const },
    3: { label: '已驳回', tone: 'danger' as const },
    4: { label: '已撤销', tone: 'draft' as const },
  }
  const TASK = {
    1: { label: '待审批', tone: 'warning' as const },
    2: { label: '已通过', tone: 'success' as const },
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
              {isCurrent && <span className="ml-auto text-xs text-warning">当前</span>}
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

  const { data: detail, isLoading, refetch } = useQuery({
    queryKey: ['requisition', editId],
    queryFn: () => getRequisitionApi(editId as number),
    enabled: !!editId,
  })

  const status = detail?.status ?? 1
  const editable = isNew || status === 1     // 新建或草稿态可编辑

  const [title, setTitle] = useState('')
  const [warehouseId, setWarehouseId] = useState<number | null>(null)
  const [warehouseName, setWarehouseName] = useState('')
  const [expectedDate, setExpectedDate] = useState('')
  const [items, setItems] = useState<EditItem[]>([])
  const [busy, setBusy] = useState(false)

  // finder / 弹窗状态
  const [productFinderOpen, setProductFinderOpen] = useState(false)
  const [supplierTarget, setSupplierTarget] = useState<{ scope: 'item' | 'convert'; index: number } | null>(null)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [convertOpen, setConvertOpen] = useState(false)
  const [convertRows, setConvertRows] = useState<ConvertRow[]>([])

  const initial = useMemo(() => {
    if (detail && editId) {
      return {
        title: detail.title ?? '',
        warehouseId: detail.warehouseId,
        warehouseName: detail.warehouseName,
        expectedDate: detail.expectedDate ?? '',
        items: (detail.items ?? []).map(i => ({
          productId: i.productId, productCode: i.productCode ?? '', productName: i.productName ?? '', unit: i.unit ?? '',
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
  useDirtyGuard(tabPath, isDirty)

  function setItem(idx: number, patch: Partial<EditItem>) {
    setItems(list => list.map((it, i) => i === idx ? { ...it, ...patch } : it))
  }
  function removeItem(idx: number) { setItems(list => list.filter((_, i) => i !== idx)) }

  function onPickProduct(p: { id: number; code?: string; name: string; unit?: string; articleNumber?: string | null; spec?: string | null; color?: string | null }) {
    setItems(list => [...list, {
      productId: p.id, productCode: p.code ?? '', productName: p.name, unit: p.unit ?? '',
      articleNumber: p.articleNumber ?? null, spec: p.spec ?? null, color: p.color ?? null,
      quantity: '1', estimatedPrice: '', suggestedSupplierId: null, suggestedSupplierName: '',
    }])
    setProductFinderOpen(false)
  }

  function onPickSupplier(result: FinderResult) {
    if (!supplierTarget) return
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

  async function handleSave() {
    const payload = buildPayload(); if (!payload) return
    if (editId) await run(() => updateRequisitionApi(editId, payload), '已保存')
    else {
      setBusy(true)
      try {
        const r = await createRequisitionApi(payload)
        toast.success('采购申请单已创建')
        const path = `/purchase-requisitions/${r!.id}`
        useWorkspaceStore.getState().addTab({ key: path, title: `采购申请单 ${r!.requisitionNo}`, path })
        navigate(path)
      } catch (e) { toast.error(e instanceof Error ? e.message : '创建失败') }
      finally { setBusy(false) }
    }
  }

  function closeTab() {
    useWorkspaceStore.getState().removeTab(tabPath)
    navigate('/purchase-requisitions')
  }

  function openConvert() {
    const rows: ConvertRow[] = (detail?.items ?? [])
      .filter(i => Number(i.quantity) - Number(i.convertedQty ?? 0) > 1e-9)
      .map(i => ({
        requisitionItemId: i.id as number, productName: i.productName ?? '',
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
    setBusy(true)
    try {
      const res = await convertRequisitionApi(editId as number, lines)
      toast.success(`已生成 ${res!.createdOrders.length} 张采购单${res!.completed ? '，采购申请单已结案' : ''}`)
      setConvertOpen(false)
      await refetch()
    } catch (e) { toast.error(e instanceof Error ? e.message : '转采购单失败') }
    finally { setBusy(false) }
  }

  if (editId && !detail && !isLoading) {
    return <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">采购申请单不存在</div>
  }

  const canCreate = can(PERMISSIONS.PURCHASE_REQUISITION_CREATE)
  const canApprove = can(PERMISSIONS.PURCHASE_REQUISITION_APPROVE)
  const canConvert = can(PERMISSIONS.PURCHASE_REQUISITION_CONVERT)

  return (
    <div className="flex flex-col gap-4">
      <ActionBar
        title={isNew ? '新建采购申请单' : `采购申请单 ${detail?.requisitionNo ?? ''}`}
        subtitle={detail ? <SoftStatusLabel label={detail.statusName} tone={detail.statusTone} /> : undefined}
        rightActions={
          <div className="flex flex-wrap gap-2">
            {editable && canCreate && <Button onClick={handleSave} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : '保存'}</Button>}
            {editId && status === 1 && canCreate && <Button variant="outline" disabled={busy} onClick={() => run(() => submitRequisitionApi(editId), '已提交审批')}>提交审批</Button>}
            {status === 2 && canCreate && <Button variant="outline" disabled={busy} onClick={() => run(() => withdrawRequisitionApi(editId as number), '已撤回')}>撤回</Button>}
            {status === 2 && canApprove && <Button disabled={busy} onClick={() => run(() => approveRequisitionApi(editId as number), '已批准')}>批准</Button>}
            {status === 2 && canApprove && <Button variant="outline" disabled={busy} onClick={() => setRejectOpen(true)}>驳回</Button>}
            {status === 3 && canConvert && <Button disabled={busy} onClick={openConvert}>转采购单</Button>}
            {editId && (status === 1 || status === 2 || status === 4) && canCreate && (
              <Button variant="ghost" className="text-destructive" disabled={busy}
                onClick={() => confirmAction({ title: '取消采购申请单', description: '确定取消这张采购申请单吗？此操作不可撤销。', onConfirm: () => run(() => cancelRequisitionApi(editId), '已取消') })}>取消</Button>
            )}
          </div>
        }
      />

      {detail?.status === 4 && detail.rejectReason && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive">驳回原因：{detail.rejectReason}</div>
      )}


      <OrderDetailSections type="requisition" id={editId || 0} progress={detail?.approval ? <ApprovalProgress approval={detail.approval} /> : undefined}>
      <Section title="基本信息">
        <div className="grid grid-cols-4 gap-x-5 gap-y-4">
          <div className="space-y-1.5">
            <Label>事由</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} disabled={!editable || busy} maxLength={100} placeholder="选填，如「前置仓补货」" />
          </div>
          <div className="space-y-1.5">
            <Label>期望入库仓 *</Label>
            {editable
              ? <WarehouseSelect value={warehouseId} onChange={(id, name) => { setWarehouseId(id); setWarehouseName(name) }} placeholder="选择期望入库仓" disabled={busy} />
              : <Input value={warehouseName} disabled />}
          </div>
          <div className="space-y-1.5">
            <Label>期望到货日</Label>
            <Input type="date" value={expectedDate ? String(expectedDate).slice(0, 10) : ''} onChange={e => setExpectedDate(e.target.value)} disabled={!editable || busy} />
          </div>
          {detail && (
            <div className="space-y-1.5">
              <Label>申请人</Label>
              <Input value={detail.applicantName} disabled />
            </div>
          )}
        </div>
      </Section>

      <Section title="采购申请明细" actions={editable && <Button size="sm" variant="outline" onClick={() => setProductFinderOpen(true)} disabled={busy}><Plus className="mr-1 h-4 w-4" />添加商品</Button>}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1500px] text-sm">
            <thead>
              <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                <ProductIdentityHeaders /><th className="min-w-20 px-3 py-3 text-left">单位</th>
                <th className="px-3 py-2 text-right w-28">采购申请数量</th>
                <th className="px-3 py-2 text-right w-28">预估单价</th>
                <th className="px-3 py-2 text-left w-48">建议供应商</th>
                {!editable && <th className="px-3 py-2 text-right w-24">已转采购</th>}
                {editable && <th className="px-3 py-2 w-12"></th>}
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr><td colSpan={10} className="py-10 text-center text-muted-foreground">暂无明细{editable ? '，点右上角「添加商品」' : ''}</td></tr>
              ) : items.map((it, idx) => (
                <tr key={idx} className="border-b border-border/40">
                  <ProductIdentityCells product={it} /><td className="px-3 py-3">{it.unit || '—'}</td>
                  <td className="px-3 py-2 text-right">
                    {editable ? <Input type="number" step="0.0001" min="0" value={it.quantity} onChange={e => setItem(idx, { quantity: e.target.value })} disabled={busy} className="h-8 text-right tabular-nums" />
                      : <span className="tabular-nums">{it.quantity}</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {editable ? <Input type="number" step="0.01" min="0" value={it.estimatedPrice} onChange={e => setItem(idx, { estimatedPrice: e.target.value })} disabled={busy} className="h-8 text-right tabular-nums" placeholder="选填" />
                      : <span className="tabular-nums text-muted-foreground">{it.estimatedPrice || '—'}</span>}
                  </td>
                  <td className="px-3 py-2">
                    {editable ? <FinderTrigger value={it.suggestedSupplierName} placeholder="选填，可转单时定" onClick={() => setSupplierTarget({ scope: 'item', index: idx })} />
                      : <span className="text-muted-foreground">{it.suggestedSupplierName || '—'}</span>}
                  </td>
                  {!editable && <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{it.convertedQty ?? 0}</td>}
                  {editable && <td className="px-3 py-2 text-center"><Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => removeItem(idx)} disabled={busy}><Trash2 className="h-4 w-4" /></Button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      </OrderDetailSections>

      <ProductFinder mode="purchase" warehouseName={warehouseName} open={productFinderOpen} warehouseId={warehouseId} onConfirm={onPickProduct} onClose={() => setProductFinderOpen(false)} />
      <SupplierFinder open={!!supplierTarget} onClose={() => setSupplierTarget(null)} onConfirm={onPickSupplier} />

      {/* 驳回原因 */}
      <Dialog open={rejectOpen} onOpenChange={v => !v && setRejectOpen(false)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>驳回采购申请单</DialogTitle></DialogHeader>
          <div className="space-y-2 py-2">
            <Label>驳回原因 *</Label>
            <textarea aria-label="驳回原因" className="min-h-28 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={rejectReason} onChange={e => setRejectReason(e.target.value)} maxLength={300} placeholder="请填写驳回原因" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)} disabled={busy}>取消</Button>
            <Button disabled={busy || !rejectReason.trim()} onClick={async () => { await run(() => rejectRequisitionApi(editId as number, rejectReason.trim()), '已驳回'); setRejectOpen(false); setRejectReason('') }}>确认驳回</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 转采购单 */}
      <Dialog open={convertOpen} onOpenChange={v => !v && setConvertOpen(false)}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader><DialogTitle>转采购单</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">按供应商自动拆分成多张采购单草稿。每行填转采购数量、供应商与单价；数量填 0 表示本次不转。</p>
          <div className="max-h-[50vh] overflow-y-auto py-2">
            <table className="w-full min-w-[1500px] text-sm">
              <thead>
                <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                  <ProductIdentityHeaders /><th className="min-w-20 px-3 py-3 text-left">单位</th>
                  <th className="px-2 py-2 text-right w-24">可转余量</th>
                  <th className="px-2 py-2 text-right w-24">转采购</th>
                  <th className="px-2 py-2 text-left w-40">供应商</th>
                  <th className="px-2 py-2 text-right w-24">单价</th>
                </tr>
              </thead>
              <tbody>
                {convertRows.map((r, idx) => (
                  <tr key={r.requisitionItemId} className="border-b border-border/40">
                    <ProductIdentityCells product={detail?.items?.find(item => item.id === r.requisitionItemId) ?? r} /><td className="px-3 py-3">{detail?.items?.find(item => item.id === r.requisitionItemId)?.unit || '—'}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{r.remaining}</td>
                    <td className="px-2 py-2"><Input type="number" step="0.0001" min="0" max={r.remaining} value={r.quantity} onChange={e => setConvertRows(rows => rows.map((x, i) => i === idx ? { ...x, quantity: e.target.value } : x))} className="h-8 text-right tabular-nums" /></td>
                    <td className="px-2 py-2"><FinderTrigger value={r.supplierName} placeholder="选择供应商" onClick={() => setSupplierTarget({ scope: 'convert', index: idx })} /></td>
                    <td className="px-2 py-2"><Input type="number" step="0.01" min="0" value={r.unitPrice} onChange={e => setConvertRows(rows => rows.map((x, i) => i === idx ? { ...x, unitPrice: e.target.value } : x))} className="h-8 text-right tabular-nums" placeholder="0.00" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConvertOpen(false)} disabled={busy}>取消</Button>
            <Button disabled={busy} onClick={submitConvert}>{busy ? '生成中…' : '生成采购单'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
