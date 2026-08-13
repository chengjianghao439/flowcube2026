import { useState, useContext, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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
import { getPlanApi, updatePlanItemApi, convertPlanApi, cancelPlanApi } from '@/api/procurement'
import type { ProcurementPlanItem } from '@/types/procurement'
import type { StatusTone } from '@/lib/statusTone'

const PLAN_TONE: Record<number, StatusTone> = { 1: 'draft', 2: 'active', 3: 'success', 4: 'danger' }
const ITEM_TONE: Record<number, StatusTone> = { 1: 'draft', 2: 'success', 3: 'warning' }
const num = (v: number) => Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 2 })

export default function ProcurementPlanDetailPage() {
  // keep-alive catch-all：路径取自 TabPathContext（useParams 取不到 id）
  const tabPath = useContext(TabPathContext)
  const params = useParams<{ id?: string }>()
  const planId = Number((tabPath || params.id || '').split('/').filter(Boolean).pop() ?? '')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { can } = usePermission()
  const canManage = can(PERMISSIONS.PROCUREMENT_PLAN_MANAGE)
  const canConvert = can(PERMISSIONS.PURCHASE_ORDER_CREATE)
  const { data: suppliers } = useSuppliersActive()

  const [selected, setSelected] = useState<Set<number>>(new Set())
  const { data: plan, isLoading } = useQuery({ queryKey: ['procurement-plan', planId], queryFn: () => getPlanApi(planId), enabled: planId > 0 })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['procurement-plan', planId] })
  const updateItem = useMutation({
    mutationFn: ({ itemId, patch }: { itemId: number; patch: { adjustedQty?: number; supplierId?: number | null; ignore?: boolean } }) => updatePlanItemApi(planId, itemId, patch, { skipGlobalError: true }),
    onSuccess: () => invalidate(),
    onError: (e: unknown) => toast.error((e as { message?: string })?.message || '保存失败'),
  })
  const convert = useMutation({
    mutationFn: (ids: number[]) => convertPlanApi(planId, ids, { skipGlobalError: true }),
    onSuccess: (r) => { toast.success(`已生成 ${r!.createdOrders.length} 张采购单草稿`); setSelected(new Set()); invalidate(); qc.invalidateQueries({ queryKey: ['procurement-plans'] }) },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message || '转采购失败'),
  })
  const cancelPlan = useMutation({
    mutationFn: () => cancelPlanApi(planId, { skipGlobalError: true }),
    onSuccess: () => { toast.success('计划已作废'); invalidate(); qc.invalidateQueries({ queryKey: ['procurement-plans'] }) },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message || '作废失败'),
  })

  const items = useMemo(() => plan?.items ?? [], [plan])
  const pendingIds = useMemo(() => items.filter(i => i.status === 1).map(i => i.id), [items])
  const editable = canManage && plan && (plan.status === 1 || plan.status === 2)

  const toggle = (id: number) => setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const toggleAll = () => setSelected(prev => prev.size === pendingIds.length ? new Set() : new Set(pendingIds))

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">加载中…</div>
  if (!plan) return <div className="p-8 text-center text-muted-foreground">采购计划不存在</div>

  return (
    <div className="space-y-4">
      <PageHeader
        title={`采购计划 ${plan.code}`}
        description={`预测窗口 ${plan.forecastWindow} 天 · 覆盖周期 ${plan.horizonDays} 天 · 默认提前期 ${plan.defaultLeadTime} 天 · 共 ${plan.itemCount} 行`}
        actions={<div className="flex items-center gap-2">
          <SoftStatusLabel label={plan.statusName} tone={PLAN_TONE[plan.status] ?? 'draft'} />
          <Button variant="outline" size="sm" onClick={() => navigate('/procurement')}>返回列表</Button>
          {editable && (
            <Button variant="outline" size="sm" onClick={() => confirmAction({ title: '作废该采购计划？', description: '已转出的采购单不受影响，仅把计划头置为作废。', variant: 'destructive', onConfirm: () => cancelPlan.mutate() })} disabled={cancelPlan.isPending}>作废</Button>
          )}
        </div>}
      />

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-center font-medium">
                {editable && canConvert && pendingIds.length > 0 && <input type="checkbox" checked={selected.size === pendingIds.length && pendingIds.length > 0} onChange={toggleAll} className="h-4 w-4 accent-primary" />}
              </th>
              <th className="px-3 py-2 text-left font-medium">商品</th>
              <th className="px-3 py-2 text-left font-medium">仓库</th>
              <th className="px-3 py-2 text-right font-medium">日均</th>
              <th className="px-3 py-2 text-right font-medium">毛需求</th>
              <th className="px-3 py-2 text-right font-medium">安全库存</th>
              <th className="px-3 py-2 text-right font-medium">可用</th>
              <th className="px-3 py-2 text-right font-medium">在途</th>
              <th className="px-3 py-2 text-right font-medium">建议量</th>
              <th className="px-3 py-2 text-right font-medium">采购量</th>
              <th className="px-3 py-2 text-left font-medium">供应商</th>
              <th className="px-3 py-2 text-left font-medium">建议到货</th>
              <th className="px-3 py-2 text-left font-medium">状态</th>
              <th className="px-3 py-2 text-center font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it: ProcurementPlanItem) => {
              const pending = it.status === 1
              return (
                <tr key={it.id} className={`border-t border-border ${it.status === 3 ? 'opacity-50' : ''}`}>
                  <td className="px-3 py-2 text-center">
                    {editable && canConvert && pending && <input type="checkbox" checked={selected.has(it.id)} onChange={() => toggle(it.id)} className="h-4 w-4 accent-primary" />}
                  </td>
                  <td className="px-3 py-2"><div>{it.productName}</div><div className="text-xs text-muted-foreground text-doc-code">{it.productCode}</div></td>
                  <td className="px-3 py-2">{it.warehouseName}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(it.adu)}</td>
                  <td className="px-3 py-2 text-right tabular-nums" title="日均 ×(提前期+覆盖周期)">{num(it.forecastDemand)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{num(it.safetyStock)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(it.available)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{it.inTransit > 0 ? num(it.inTransit) : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-primary">{num(it.suggestedQty)}</td>
                  <td className="px-3 py-2 text-right">
                    {editable && pending
                      ? <Input type="number" defaultValue={it.adjustedQty} key={`${it.id}-${it.adjustedQty}`} className="ml-auto h-8 w-24 text-right tabular-nums"
                          onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0 && v !== it.adjustedQty) updateItem.mutate({ itemId: it.id, patch: { adjustedQty: v } }) }} />
                      : <span className="tabular-nums">{num(it.adjustedQty)} {it.unit}</span>}
                  </td>
                  <td className="px-3 py-2">
                    {editable && pending
                      ? <Select value={it.supplierId != null ? String(it.supplierId) : '0'} onValueChange={(v) => updateItem.mutate({ itemId: it.id, patch: { supplierId: v === '0' ? null : Number(v) } })}>
                          <SelectTrigger className="h-8 w-40"><SelectValue placeholder="待选" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="0">待选供应商</SelectItem>
                            {/* 快照供应商若已停用/不在活跃列表，仍列出来避免退回 placeholder 误显「待选」 */}
                            {it.supplierId != null && !suppliers?.some(s => s.id === it.supplierId) && (
                              <SelectItem value={String(it.supplierId)}>{it.supplierName || `供应商#${it.supplierId}`}（已停用）</SelectItem>
                            )}
                            {suppliers?.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      : (it.supplierName || <span className="text-muted-foreground">—</span>)}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground tabular-nums">{it.expectedArrival ? String(it.expectedArrival).slice(0, 10) : '—'}</td>
                  <td className="px-3 py-2">
                    <SoftStatusLabel label={it.statusName} tone={ITEM_TONE[it.status] ?? 'draft'} />
                    {it.purchaseOrderId && <button className="ml-1 text-xs text-primary underline" onClick={() => navigate(`/purchase/${it.purchaseOrderId}`)}>#{it.purchaseOrderId}</button>}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {editable && pending && (
                      <button className="text-xs text-muted-foreground hover:text-danger" onClick={() => updateItem.mutate({ itemId: it.id, patch: { ignore: true } })}>忽略</button>
                    )}
                    {editable && it.status === 3 && (
                      <button className="text-xs text-primary" onClick={() => updateItem.mutate({ itemId: it.id, patch: { ignore: false } })}>恢复</button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {editable && canConvert && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">勾选待处理行后，将按供应商与仓库分组生成采购单草稿（需人工确认提交）。未指定供应商的行无法转采购。</p>
          <Button disabled={selected.size === 0 || convert.isPending} onClick={() => convert.mutate([...selected])}>
            {convert.isPending ? '转采购中…' : `转采购（${selected.size} 行）`}
          </Button>
        </div>
      )}
    </div>
  )
}
