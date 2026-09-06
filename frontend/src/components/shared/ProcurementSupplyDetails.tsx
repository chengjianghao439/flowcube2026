import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { toast } from '@/lib/toast'
import { getPurchasePolicyApi, savePurchasePolicyApi, prepareProcurementTransfer, type ProcurementSupply, type PurchasePolicy } from '@/api/procurement-supply'

const qty = (n = 0) => Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 4 })

export default function ProcurementSupplyDetails({ supply, supplierId, mode = 'plan' }: { supply: ProcurementSupply; supplierId?: number | null; mode?: 'plan' | 'replenishment' }) {
  const [open, setOpen] = useState(false)
  return <><Button size="sm" variant="outline" onClick={() => setOpen(true)}>需求与覆盖</Button><Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>{supply.productName} · {supply.warehouseName}</DialogTitle><DialogDescription>核对实时需求、已有供给和采购规则。</DialogDescription></DialogHeader>{open && <SupplyBody supply={supply} supplierId={supplierId ?? supply.supplierId} mode={mode} onNavigate={() => setOpen(false)} />}</DialogContent></Dialog></>
}
function SupplyBody({ supply: r, supplierId, mode, onNavigate }: { supply: ProcurementSupply; supplierId: number | null; mode: 'plan' | 'replenishment'; onNavigate: () => void }) {
  const navigate = useNavigate()
  const { can } = usePermission()
  const buffer = mode === 'replenishment' ? r.targetStock : r.safetyStock
  return <div className="space-y-5 text-sm">
    <p className="rounded-md bg-muted px-4 py-3 leading-6">净需求 <strong>{qty(r.netRequirement)} {r.unit}</strong>，按包装倍数 {qty(r.packMultiple)}、最低起订 {qty(r.minimumOrderQty)}，建议采购 <strong>{qty(r.suggestedQty)} {r.unit}</strong>（多购 {qty(r.excessQty)}）。</p>
    <dl className="grid grid-cols-[1fr_auto] gap-x-8 gap-y-2 [&_dd]:text-right [&_dd]:tabular-nums">
      <dt>未发销售（含未占库订单）</dt><dd>{qty(r.confirmedDemand)}</dd>
      <dt className="pl-3 text-muted-foreground">其中销售草稿</dt><dd className="text-muted-foreground">{qty(r.draftSalesDemand)}</dd>
      <dt>预测需求 / 消耗销售后的剩余预测</dt><dd>{qty(r.forecastDemand)} / {qty(r.residualForecast)}</dd>
      <dt>{mode === 'replenishment' ? '目标库存（已含安全库存）' : '安全库存'}</dt><dd>{qty(buffer)}</dd>
      <dt>ACTIVE 实物 / 有效预占</dt><dd>{qty(r.onHand)} / {qty(r.reserved)}</dd>
      <dt>预计采购（已提交 / 待审批，未上架）</dt><dd>{qty(r.inTransit)}</dd>
      <dt className="pl-3 text-muted-foreground">其中销售预计绑定（不再重复扣除）</dt><dd className="text-muted-foreground">{qty(r.expectedBound)}</dd>
      <dt>其他待处理采购计划</dt><dd>{qty(r.planCoverage)}</dd>
      <dt>未转采购的申请单（草稿 / 审批中 / 已批准）</dt><dd>{qty(r.requisitionCoverage)}</dd>
      <dt>采购单草稿</dt><dd>{qty(r.draftCoverage)}</dd>
    </dl>
    <p className="text-xs leading-5 text-muted-foreground">净需求 = max（未发销售，预测需求，有效预占）+ {mode === 'replenishment' ? '目标库存' : '安全库存'} − 实物 − 预计采购 − 其他计划/申请/采购草稿。计划、申请只计未转换部分；取消或减量后释放覆盖。生成和转换时会重新核对，当前计划本行不计入“其他计划”。</p>
    <div className="space-y-2 border-t pt-4"><h3 className="font-medium">到货条件</h3><p>最早销售交期：{r.earliestDemandDate || '待确认'}。预计采购中 {qty(r.arrivalUnconfirmedQty)} {r.unit} 未确认到货日，{qty(r.lateSupplyQty)} {r.unit} 晚于最早销售交期。</p><p className="text-xs text-muted-foreground">上方按总量净额抵扣已有采购，不代表已按期到货；先核对交期、催货或调拨。计划和申请尚未成为供应商承诺。</p>{r.expectedArrivals?.length ? <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs">{r.expectedArrivals.map((a, i) => <li key={i}>{a.expectedDate || '日期待确认'}：{qty(a.quantity)} {r.unit}</li>)}</ul> : null}</div>
    <div className="space-y-2 border-t pt-4"><h3 className="font-medium">可调拨候选</h3>{r.transferCandidates?.length ? r.transferCandidates.map(c => <div key={c.warehouseId} className="flex items-start justify-between gap-4"><div><p>{c.warehouseName}：最多 {qty(c.quantity)} {r.unit}</p><p className="mt-1 text-xs text-muted-foreground">{c.arrivalCondition}</p></div>{can(PERMISSIONS.TRANSFER_ORDER_CREATE) && <Button size="sm" variant="outline" onClick={() => { onNavigate(); navigate(prepareProcurementTransfer(r, c)) }}>核对调拨单</Button>}</div>) : <p className="text-muted-foreground">授权仓库内暂无可推荐余量。</p>}<p className="text-xs text-muted-foreground">来源仓先保留自身未发需求、预测、有效预占和目标/安全库存；未确认候选不抵扣采购量。</p></div>
    {supplierId && can(PERMISSIONS.PROCUREMENT_PLAN_MANAGE) ? <PolicyEditor productId={r.productId} supplierId={supplierId} /> : <p className="text-xs text-muted-foreground">选择供应商后，可由采购计划管理员维护该供应商与商品的包装、起订规则。</p>}
  </div>
}
function PolicyEditor({ productId, supplierId }: { productId: number; supplierId: number }) {
  const query = useQuery({ queryKey: ['purchase-policy', productId, supplierId], queryFn: () => getPurchasePolicyApi(productId, supplierId) })
  if (query.isError) return <QueryErrorState error={query.error} onRetry={() => void query.refetch()} compact />
  return query.data ? <PolicyForm key={`${query.dataUpdatedAt}`} policy={query.data} /> : <p>读取包装规则…</p>
}
function PolicyForm({ policy }: { policy: PurchasePolicy }) {
  const qc = useQueryClient()
  const [unit, setUnit] = useState(policy.entryUnit)
  const [pack, setPack] = useState(String(policy.packMultiple))
  const [minimum, setMinimum] = useState(String(policy.minimumOrderQty))
  const rate = policy.units.find(u => u.unitName === unit)?.conversionRate || 1
  const mutation = useMutation({ mutationFn: () => savePurchasePolicyApi({ productId: policy.productId, supplierId: policy.supplierId, entryUnit: unit, packMultiple: Number(pack), minimumOrderQty: Number(minimum) }), onSuccess: () => { toast.success('包装与起订规则已保存；已有计划数量请按最新建议核对'); for (const key of ['purchase-policy', 'procurement-plan', 'replenishment']) void qc.invalidateQueries({ queryKey: [key] }) }, onError: (e: Error) => toast.error(e.message) })
  const invalid = [pack, minimum].some(v => v.trim() === '' || !Number.isFinite(Number(v)) || Number(v) < 0)
  return <div className="space-y-3 border-t pt-4"><h3 className="font-medium">采购包装与起订规则</h3><div className="grid grid-cols-3 gap-3"><div className="space-y-1"><Label htmlFor="purchase-policy-unit">采购单位</Label><Select value={unit} onValueChange={setUnit}><SelectTrigger id="purchase-policy-unit"><SelectValue /></SelectTrigger><SelectContent>{policy.units.map(u => <SelectItem key={u.unitName} value={u.unitName}>{u.unitName}</SelectItem>)}</SelectContent></Select></div><div className="space-y-1"><Label htmlFor="purchase-policy-pack">整包装倍数</Label><Input id="purchase-policy-pack" type="number" min="0" step="0.0001" value={pack} onChange={e => setPack(e.target.value)} /></div><div className="space-y-1"><Label htmlFor="purchase-policy-min">最低起订量</Label><Input id="purchase-policy-min" type="number" min="0" step="0.0001" value={minimum} onChange={e => setMinimum(e.target.value)} /></div></div><div className="flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">1 {unit} = {qty(rate)} {policy.baseUnit}；0 表示不限。数量按商品现有单位换算。</p><Button size="sm" disabled={invalid || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? '保存中…' : '保存规则'}</Button></div></div>
}
