import { ReportTable } from '@/components/shared/ReportTable'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import { useProcurementIntentRecovery, type PlanConverted } from '@/hooks/useProcurementIntentRecovery'
import ProcurementIntentRecoveryNotice from '@/components/shared/ProcurementIntentRecoveryNotice'
import { getWorkspaceListPath } from '@/lib/workspaceListNavigation'
import { qty as num } from '@/lib/format'
import { useProductQtyPolicies } from '@/hooks/useProductQtyPolicies'
import { qtyStep } from '@/lib/qtyStep'
import { ProcurementArrivalStatus } from '@/components/shared/ProcurementSupplyExplanation'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { useWorkspaceTabTitle } from '@/hooks/useWorkspaceTabTitle'
import ProcurementSupplyDetails from '@/components/shared/ProcurementSupplyDetails'
import { OrderDetailSections } from '@/components/shared/OrderDetailSections'
import { ProductIdentityCells } from '@/components/shared/ProductIdentityCells'
import { useState, useContext, useId, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useIsMutating, useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { TabPathContext } from '@/components/layout/TabPathContext'
import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { toast } from '@/lib/toast'
import { confirmAction } from '@/lib/confirm'
import { useSuppliersActive } from '@/hooks/useSuppliers'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { getPlanApi, updatePlanItemApi, cancelPlanApi } from '@/api/procurement'
import type { ProcurementPlanItem } from '@/types/procurement'
import type { StatusTone } from '@/lib/statusTone'

const PLAN_TONE: Record<number, StatusTone> = { 1: 'draft', 2: 'active', 3: 'success', 4: 'danger' }
const ITEM_TONE: Record<number, StatusTone> = { 1: 'draft', 2: 'success', 3: 'warning' }

export default function ProcurementPlanDetailPage() {
  // keep-alive catch-all：路径取自 TabPathContext（useParams 取不到 id）
  const tabPath = useContext(TabPathContext)
  const params = useParams<{ id?: string }>()
  const planId = Number((tabPath || params.id || '').split('/').filter(Boolean).pop() ?? '')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const active=useActiveWorkspaceTab(),conversion=useProcurementIntentRecovery('plan-convert',planId,active)
  const { can } = usePermission()
  const canManage = can(PERMISSIONS.PROCUREMENT_PLAN_MANAGE)
  const canConvert = can(PERMISSIONS.PURCHASE_ORDER_CREATE)
  const { data: suppliers } = useSuppliersActive()
  const supplierFieldId = useId()

  const [selected, setSelected] = useState<Set<number>>(new Set())
  const { data: plan, isLoading, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery({ queryKey: ['procurement-plan', planId], queryFn: () => getPlanApi(planId), enabled: planId > 0 })
  useWorkspaceTabTitle(plan?.code)

  const invalidate = () => qc.invalidateQueries({ queryKey: ['procurement-plan', planId] })
  const updateItemKey = ['procurement-plan-item', planId]
  const savingItems = useIsMutating({ mutationKey: updateItemKey }) > 0
  const updateItem = useMutation({
    mutationKey: updateItemKey,
    mutationFn: ({ itemId, patch }: { itemId: number; patch: { adjustedQty?: number; supplierId?: number | null; ignore?: boolean } }) => updatePlanItemApi(planId, itemId, patch, { skipGlobalError: true }),
    onSuccess: () => invalidate(),
    onError: (e: unknown) => toast.error((e as { message?: string })?.message || '保存失败'),
  })
  const convert = useMutation({
    mutationFn: async(ids:number[])=>{const answer=await conversion.submit({itemIds:ids});if(!answer)throw Error('原转单结果待确认');return answer.data as PlanConverted},
    onSuccess: (r) => { toast.success(`已生成 ${r!.createdOrders.length} 张采购单草稿`); setSelected(new Set()); invalidate(); qc.invalidateQueries({ queryKey: ['procurement-plans'] }) },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message || '生成采购草稿失败'),
  })
  const cancelPlan = useMutation({
    mutationFn: () => cancelPlanApi(planId, { skipGlobalError: true }),
    onSuccess: () => { toast.success('计划已作废'); invalidate(); qc.invalidateQueries({ queryKey: ['procurement-plans'] }) },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message || '作废失败'),
  })

  const items = useMemo(() => plan?.items ?? [], [plan])
  const allowDecimalOf = useProductQtyPolicies(items.map(item => item.productId))
  const pendingItems = useMemo(() => items.filter(item => item.status === 1), [items])
  const selectedItems = pendingItems.filter(item => selected.has(item.id))
  const missingSupplierCount = selectedItems.filter(item => !item.supplierId).length
  const allSelected = pendingItems.length > 0 && selectedItems.length === pendingItems.length
  const conversionDisabled = !selectedItems.length || missingSupplierCount > 0 || savingItems || convert.isPending || conversion.blocked
  const editable = canManage && plan && (plan.status === 1 || plan.status === 2)
  const showSelection = Boolean(editable && canConvert && pendingItems.length > 0)

  const toggle = (id: number) => {if(conversion.blocked)return;setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })}
  const toggleAll = () => {
    if (conversion.blocked) return
    setSelected(prev => pendingItems.every(item => prev.has(item.id)) ? new Set() : new Set(pendingItems.map(item => item.id)))
  }

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">加载中…</div>
  if (isError && !plan) return <QueryErrorState error={error} onRetry={() => void refetch()} title="采购计划加载失败" />
  if (!plan) return <div className="p-8 text-center text-muted-foreground">采购计划不存在</div>

  return (
    <div className="space-y-4">
      <PageHeader
        title={`采购计划 ${plan.code}`}
        description={`预测窗口 ${plan.forecastWindow ?? ''} 天 · 覆盖周期 ${plan.horizonDays ?? ''} 天 · 默认提前期 ${plan.defaultLeadTime ?? ''} 天 · 共 ${plan.itemCount ?? ''} 行。需求与覆盖读取于 ${dataUpdatedAt ? formatDisplayDateTime(new Date(dataUpdatedAt).toISOString()) : '—'}；转换时仍会重新核对。`}
        status={<SoftStatusLabel label={plan.statusName} tone={PLAN_TONE[plan.status] ?? 'draft'} />}
        actions={<div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled={isFetching} onClick={() => void refetch()}>{isFetching ? '刷新中…' : '刷新需求'}</Button>
          <Button variant="outline" size="sm" onClick={() => navigate(getWorkspaceListPath('/procurement'))}>返回列表</Button>
          {editable && (
            <Button variant="outline" size="sm" onClick={() => confirmAction({ title: '作废该采购计划？', description: '已转出的采购单不受影响，仅把计划头置为作废。', variant: 'destructive', onConfirm: () => cancelPlan.mutate() })} disabled={cancelPlan.isPending || conversion.blocked}>作废</Button>
          )}
        </div>}
      />

      <ProcurementIntentRecoveryNotice recovery={conversion} onConfirmed={answer=>{if(!answer.queryOnly)setSelected(new Set());void invalidate();void qc.invalidateQueries({queryKey:['procurement-plans']});toast.success('原计划转采购已确认')}} />
      {isError && <QueryErrorState error={error} onRetry={() => void refetch()} title="刷新失败，当前显示上次读取的数据" compact />}
      <OrderDetailSections type="plan" id={plan.id}>
      <div className="overflow-x-auto rounded-lg border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        role="region" aria-label="采购计划明细，可横向滚动" tabIndex={0} data-table-scroll>
        <ReportTable>
          <thead className="text-muted-foreground [&_th]:whitespace-nowrap">
            <tr>
              {showSelection && <th className="w-12 px-3 py-2 text-center font-medium">
                <input type="checkbox" aria-label="选择全部待处理计划明细" disabled={conversion.blocked} checked={allSelected} onChange={toggleAll} className="h-4 w-4 accent-primary" />
              </th>}
              <th className="w-56 px-3 py-2 text-left font-medium">商品</th>
              <th className="px-3 py-2 text-left font-medium">仓库</th>
              <th className="w-36 px-3 py-2 text-right font-medium">最新净需求 / 建议量</th>
              <th className="w-32 px-3 py-2 text-right font-medium">采购量</th>
              <th className="w-32 px-3 py-2 text-left font-medium">状态 / 关联采购单</th>
              <th className="w-20 px-3 py-2 text-left font-medium">单位</th>
              <th className="px-3 py-2 text-right font-medium">日均</th>
              <th className="px-3 py-2 text-right font-medium">预测需求</th>
              <th className="px-3 py-2 text-right font-medium">未发销售</th>
              <th className="px-3 py-2 text-right font-medium">安全库存</th>
              <th className="px-3 py-2 text-right font-medium">可用</th>
              <th className="px-3 py-2 text-right font-medium">在途</th>
              <th className="px-3 py-2 text-right font-medium">生成时建议量</th>
              <th className="px-3 py-2 text-left font-medium">供应商</th>
              <th className="px-3 py-2 text-left font-medium">建议到货</th>
              <th className="min-w-44 px-3 py-2 text-left font-medium">交期核对</th>
              <th className="px-3 py-2 text-center font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it: ProcurementPlanItem) => {
              const pending = it.status === 1
              const supplierValueId = `${supplierFieldId}-${it.id}`
              const supplierErrorId = `${supplierValueId}-error`
              const supplierMissing = showSelection && pending && selected.has(it.id) && !it.supplierId
              const activeSupplier = suppliers?.find(supplier => supplier.id === it.supplierId)
              const supplierSnapshot = it.supplierName || `供应商 #${it.supplierId}`
              const supplierLabel = !it.supplierId ? '待选供应商' : activeSupplier?.name ?? `${supplierSnapshot}${suppliers ? '（已停用）' : ''}`
              return (
                <tr key={it.id} className={`border-t border-border ${it.status === 3 ? 'opacity-50' : ''}`}>
                  {showSelection && <td className="px-3 py-2 text-center">
                    {pending && <input type="checkbox" aria-label={`选择 ${it.productName} ${it.warehouseName}`} disabled={conversion.blocked} checked={selected.has(it.id)} onChange={() => toggle(it.id)} className="h-4 w-4 accent-primary" />}
                  </td>}
                  <ProductIdentityCells product={it} compact />
                  <td className="px-3 py-2">{it.warehouseName}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{it.currentSupply ? `${num(it.currentSupply.netRequirement)} / ${num(it.currentSupply.suggestedQty)}` : '当前需求暂不可用'}</td>
                  <td className="px-3 py-2 text-right">
                    {editable && pending
                      ? <Input disabled={conversion.blocked} quantity aria-label={`${it.productName} ${it.warehouseName}采购量`} type="number" step={qtyStep(allowDecimalOf(it.productId))} defaultValue={it.adjustedQty} key={`${it.id}-${it.adjustedQty}`} className="ml-auto h-8 w-full min-w-0 max-w-24 text-right tabular-nums"
                          onBlur={(e) => {if(conversion.blocked)return;const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0 && v !== it.adjustedQty) updateItem.mutate({ itemId: it.id, patch: { adjustedQty: v } }) }} />
                      : <span className="whitespace-nowrap tabular-nums">{num(it.adjustedQty)} {it.unit}</span>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="space-y-1">
                      <SoftStatusLabel label={it.statusName} tone={ITEM_TONE[it.status] ?? 'draft'} />
                      {it.purchaseOrderId && <button type="button" className="block max-w-full whitespace-normal [overflow-wrap:anywhere] rounded text-left text-xs text-primary underline focus-visible:outline focus-visible:outline-ring"
                        onClick={() => navigate(`/purchase/${it.purchaseOrderId}`)}>采购单 #{it.purchaseOrderId}</button>}
                    </div>
                  </td>
                  <td className="px-3 py-3">{it.unit || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(it.adu)}</td>
                  <td className="px-3 py-2 text-right tabular-nums" title="日均 ×(提前期+覆盖周期)">{num(it.forecastDemand)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{it.supplySnapshot ? num(it.supplySnapshot.confirmedDemand) : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{num(it.safetyStock)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(it.available)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{it.inTransit > 0 ? num(it.inTransit) : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-primary">{num(it.suggestedQty)}</td>
                  <td className="px-3 py-2">
                    {editable && pending
                      ? <div className="w-40 space-y-1">
                          <Select disabled={conversion.blocked} value={String(it.supplierId || 0)} onValueChange={v => {
                            if (!conversion.blocked) updateItem.mutate({ itemId: it.id, patch: { supplierId: v === '0' ? null : Number(v) } })
                          }}>
                            <SelectTrigger
                              aria-label={`${it.productName} ${it.warehouseName}供应商`}
                              aria-describedby={supplierMissing ? `${supplierValueId} ${supplierErrorId}` : supplierValueId}
                              aria-invalid={supplierMissing || undefined}
                              className="h-8"
                            ><SelectValue id={supplierValueId}>{supplierLabel}</SelectValue></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="0">待选供应商</SelectItem>
                              {it.supplierId && !activeSupplier ? <SelectItem value={String(it.supplierId)}>{supplierLabel}</SelectItem> : null}
                              {suppliers?.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          {supplierMissing && <p id={supplierErrorId} className="text-xs text-destructive-ink">请先选择供应商</p>}
                        </div>
                      : (it.supplierName || <span className="text-muted-foreground">—</span>)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground tabular-nums">{it.expectedArrival ? String(it.expectedArrival).slice(0, 10) : '—'}</td>
                  <td className="min-w-44 px-3 py-2">{it.currentSupply ? <ProcurementArrivalStatus supply={it.currentSupply} /> : <span className="text-xs text-muted-foreground">当前需求暂不可用</span>}</td>
                  <td className="px-3 py-2 text-center">
                    {it.currentSupply && <ProcurementSupplyDetails supply={it.currentSupply} snapshot={it.supplySnapshot} supplierId={it.supplierId} />}
                    {editable && pending && (
                      <button className="text-xs text-muted-foreground hover:text-danger" disabled={conversion.blocked} onClick={() => {if(!conversion.blocked)updateItem.mutate({ itemId: it.id, patch: { ignore: true } })}}>忽略</button>
                    )}
                    {editable && it.status === 3 && (
                      <button className="text-xs text-primary" disabled={conversion.blocked} onClick={() => {if(!conversion.blocked)updateItem.mutate({ itemId: it.id, patch: { ignore: false } })}}>恢复</button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </ReportTable>
      </div>

      {editable && canConvert && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            <p>按供应商与仓库分组生成采购单草稿。转换时重新核对最新供给和包装规则；数量过期时先调整或忽略，切换供应商时按其包装规则重新调整数量。</p>
            <div role="status">
              {savingItems ? '正在保存明细…' : missingSupplierCount > 0 && <p className="mt-1 text-destructive-ink">已选明细中有 {missingSupplierCount} 行缺少供应商。请选择供应商或取消勾选该行。</p>}
            </div>
          </div>
          <Button disabled={conversionDisabled} onClick={() => {
            if (!conversionDisabled) convert.mutate(selectedItems.map(item => item.id))
          }}>
            {convert.isPending ? '正在生成采购草稿…' : `生成采购草稿（${selectedItems.length} 行）`}
          </Button>
        </div>
      )}
      </OrderDetailSections>
    </div>
  )
}
