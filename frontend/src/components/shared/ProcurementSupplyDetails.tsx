import { useProductQtyPolicies } from '@/hooks/useProductQtyPolicies'
import { qty } from '@/lib/format'
import { qtyStep } from '@/lib/qtyStep'
import { ProcurementSupplyExplanation } from './ProcurementSupplyExplanation'
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


export default function ProcurementSupplyDetails({ supply, supplierId, snapshot, mode = 'plan' }: { supply: ProcurementSupply; snapshot?: ProcurementSupply | null; supplierId?: number | null; mode?: 'plan' | 'replenishment' }) {
  const [open, setOpen] = useState(false)
  return <><Button size="sm" variant="outline" onClick={() => setOpen(true)}>需求与覆盖</Button><Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>{supply.productName} · {supply.warehouseName}</DialogTitle><DialogDescription>按本次读取的数据核对需求、已有供给与交期，查看包装规则。</DialogDescription></DialogHeader>{open && <SupplyBody snapshot={snapshot} supply={supply} supplierId={supplierId ?? supply.supplierId} mode={mode} onNavigate={() => setOpen(false)} />}</DialogContent></Dialog></>
}
function SupplyBody({ supply: r, supplierId, snapshot, mode, onNavigate }: { supply: ProcurementSupply; snapshot?: ProcurementSupply | null; supplierId: number | null; mode: 'plan' | 'replenishment'; onNavigate: () => void }) {
  const navigate = useNavigate()
  const { can } = usePermission()
  return <div className="space-y-5 text-sm">
    <ProcurementSupplyExplanation supply={r} snapshot={snapshot} mode={mode} />
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
  const allowDecimalOf = useProductQtyPolicies([policy.productId])
  const qc = useQueryClient()
  const [unit, setUnit] = useState(policy.entryUnit)
  const [pack, setPack] = useState(String(policy.packMultiple))
  const [minimum, setMinimum] = useState(String(policy.minimumOrderQty))
  const rate = policy.units.find(u => u.unitName === unit)?.conversionRate || 1
  const mutation = useMutation({ mutationFn: () => savePurchasePolicyApi({ productId: policy.productId, supplierId: policy.supplierId, entryUnit: unit, packMultiple: Number(pack), minimumOrderQty: Number(minimum) }), onSuccess: () => { toast.success('包装与起订规则已保存；已有计划数量请按最新建议核对'); for (const key of ['purchase-policy', 'procurement-plan', 'replenishment']) void qc.invalidateQueries({ queryKey: [key] }) }, onError: (e: Error) => toast.error(e.message) })
  const invalid = [pack, minimum].some(v => v.trim() === '' || !Number.isFinite(Number(v)) || Number(v) < 0)
  return <div className="space-y-3 border-t pt-4"><h3 className="font-medium">采购包装与起订规则</h3><div className="grid grid-cols-3 gap-3"><div className="space-y-1"><Label htmlFor="purchase-policy-unit">采购单位</Label><Select value={unit} onValueChange={setUnit}><SelectTrigger id="purchase-policy-unit"><SelectValue /></SelectTrigger><SelectContent>{policy.units.map(u => <SelectItem key={u.unitName} value={u.unitName}>{u.unitName}</SelectItem>)}</SelectContent></Select></div><div className="space-y-1"><Label htmlFor="purchase-policy-pack">整包装倍数</Label><Input quantity id="purchase-policy-pack" type="number" min="0" step={qtyStep(allowDecimalOf(policy.productId))} value={pack} onChange={e => setPack(e.target.value)} /></div><div className="space-y-1"><Label htmlFor="purchase-policy-min">最低起订量</Label><Input quantity id="purchase-policy-min" type="number" min="0" step={qtyStep(allowDecimalOf(policy.productId))} value={minimum} onChange={e => setMinimum(e.target.value)} /></div></div><div className="flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">1 {unit} = {rate} {policy.baseUnit}；0 表示不限。数量按商品现有单位换算。</p><Button size="sm" disabled={invalid || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? '保存中…' : '保存规则'}</Button></div></div>
}
