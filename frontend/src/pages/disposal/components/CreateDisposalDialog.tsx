import { useDisposalHandlingSource } from '@/hooks/useDisposalHandlingSource'
import { useDisposalHandlingOperation } from '@/hooks/useDisposalHandlingOperation'
import { HandlingOperationPanel } from '../HandlingOperationPanel'
import { handlingQty, mayHandle } from '@/lib/disposalHandlingRecovery'
import { createDisposalApi } from '@/api/disposal'
import { money, qty } from '@/lib/format'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { ProductIdentityGridCells, ProductIdentityGridHeaders } from '@/components/shared/ProductIdentityCells'
import { useRef, useState } from 'react'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useDisposalSuggestions, useDisposalMutation } from '@/hooks/useDisposal'
import { useWarehousesActive } from '@/hooks/useWarehouses'
import type { DisposalSuggestion } from '@/types/disposal'
import { useProductQtyPolicies } from '@/hooks/useProductQtyPolicies'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { useSectionActive } from '@/components/layout/SectionVisibilityContext'
import { captureDisposalOwner, disposalOwnerCurrent } from '@/lib/disposalRecovery'
import { useNavigate } from 'react-router-dom'
import { MAX_WORKSPACE_TABS, useWorkspaceStore } from '@/store/workspaceStore'
import { buildWorkspaceTabRegistrationFromPath } from '@/router/workspaceRouteMeta'
import { resolveRouteTitle } from '@/router/routeDefinitions'
import { qtyStep } from '@/lib/qtyStep'

interface HandlingScrapProps { source: ReturnType<typeof useDisposalHandlingSource>; write: ReturnType<typeof useDisposalHandlingOperation>; operationUuid: string; requestKey: string; identity: string }
interface Props { open: boolean; onClose: () => void; mode?: 'create' | 'suggestions'; handling?: HandlingScrapProps }

/** 待选行：建议 + 用户调整的数量与处置方式 */
interface PendingRow {
  suggestion: DisposalSuggestion
  quantity: string
  disposeType: 3
  remark?: string
}

export default function CreateDisposalDialog({ open, onClose, mode = 'create', handling }: Props) {
  const [owner] = useState(captureDisposalOwner), active = useSectionActive(), { can } = usePermission(), navigate = useNavigate()
  const readable = open && active && disposalOwnerCurrent(owner) && can(PERMISSIONS.INVENTORY_DISPOSAL_VIEW)
  const canCreate = mode === 'create' && can(PERMISSIONS.INVENTORY_DISPOSAL_CREATE)
  const latest = useRef({ open, active }); latest.current = { open, active }
  function current() { return latest.current.open && latest.current.active && disposalOwnerCurrent(owner) && (!handling || (handling.source.isCurrent() && !handling.write.blocked && mayHandle(PERMISSIONS.INVENTORY_DISPOSAL_CREATE, PERMISSIONS.INVENTORY_DISPOSAL_VIEW))) }
  const [whId, setWhId] = useState('')
  const [remark, setRemark] = useState('')
  const [keyword, setKeyword] = useState('')
  const [rows, setRows] = useState<PendingRow[]>([])
  // 「只能整数」的商品把处置数量框的 step 切成 1（迁移 254）
  const allowDecimalOf = useProductQtyPolicies(canCreate && readable ? rows.map(r => r.suggestion.productId) : [], handling ? { owner: handling.source.owner, isCurrent: () => current() && mayHandle(PERMISSIONS.PRODUCT_VIEW) } : undefined)
  const [submitting, setSubmitting] = useState(false)
  const { data: warehouses } = useWarehousesActive(handling?.source.owner, handling ? () => false : undefined)
  const { data: suggestions } = useDisposalSuggestions({ warehouseId: whId ? Number(whId) : null, keyword: keyword || undefined }, readable && !handling)
  const mutation = useDisposalMutation()

  const warehouse = handling?.source.data ? { id: handling.source.data.source.warehouseId, name: handling.source.data.source.warehouseName } : warehouses?.find(w => String(w.id) === whId)

  function reset() {
    setWhId(''); setRemark(''); setKeyword(''); setRows([])
  }

  function toggleSuggestion(s: DisposalSuggestion) {
    if (handling || !current()) return
    if (!Number.isFinite(s.totalQty) || s.totalQty <= 0) { toast.warning('当前参考可用量为零或异常，不能自动圈选；请核对当前库存与预占'); return }
    setRows(prev => {
      const exists = prev.find(r => Number(r.suggestion.productId) === Number(s.productId))
      if (exists) return prev.filter(r => r !== exists)
      return [...prev, { suggestion: s, quantity: String(s.totalQty), disposeType: 3 }]
    })
  }

  function updateRow(productId: number, patch: Partial<PendingRow>) {
    if (!current()) return
    setRows(prev => prev.map(r => (Number(r.suggestion.productId) === Number(productId) ? { ...r, ...patch } : r)))
  }

  function removeRow(productId: number) {
    if (handling || !current()) return
    setRows(prev => prev.filter(r => Number(r.suggestion.productId) !== Number(productId)))
  }

  const totalValue = rows.reduce((sum, r) => sum + (Number(r.quantity) || 0) * r.suggestion.unitValue, 0)

  async function handleCreate() {
    if (!current() || !canCreate) return
    if (!warehouse) { toast.warning('请选择仓库'); return }
    if (!rows.length) { toast.warning('请至少圈选一件滞销商品'); return }
    const invalid = rows.find(r => {
      const q = Number(r.quantity)
      return !handlingQty(q) || (handling && q > (handling.source.data?.source.budget.availableQuantity ?? 0))
    })
    if (invalid) {
      toast.warning(`「${invalid.suggestion.productName}」的处置数量无效，必须大于 0`)
      return
    }
    if (submitting || mutation.create.isPending) return
    try {
      setSubmitting(true)
      const payload = {
        warehouseId: warehouse.id,
        warehouseName: warehouse.name,
        remark: remark || undefined,
        items: rows.map(r => ({
          productId: r.suggestion.productId,
          quantity: Number(r.quantity),
          disposeType: r.disposeType,
          remark: r.remark || undefined,
        })),
        ...(handling?.source.data ? { disposalSource: { sourceId: handling.source.data.source.id, expectedRevision: handling.source.data.source.revision, operationUuid: handling.operationUuid } } : {}),
      }
      const result = handling?.source.data ? await handling.write.submit({ kind: 'scrap', draftIdentity: handling.identity, sourceId: handling.source.data.source.id, intentUuid: handling.source.data.source.intentUuid, operationUuid: handling.operationUuid, requestKey: handling.requestKey, path: '/disposals', action: 'disposal.handling.scrap.create', body: payload }, (body, key, config) => createDisposalApi(body, { ...config, headers: { ...config.headers, 'X-Request-Key': key } })) : await mutation.create.mutateAsync(payload)
      if (handling && (!result || !handling.write.canApply(result))) return
      if (handling && result ? handling.write.canApply(result) : current()) { toast.success('报废单已创建为草稿，可在列表中提交审批'); if (!handling) reset(); onClose() }
    } finally {
      setSubmitting(false)
    }
  }

  function openNormal(path: string) {
    if (!current()) return
    const tab = buildWorkspaceTabRegistrationFromPath(path), workspace = useWorkspaceStore.getState()
    const existing = workspace.tabs.find(t => t.key === tab.key)
    if (!existing && workspace.tabs.length >= MAX_WORKSPACE_TABS) { toast.warning('工作区标签已满，请先关闭不需要的页面；圈选保留'); return }
    if (workspace.addTab(existing ?? { ...tab, title: resolveRouteTitle(tab.path) ?? tab.path })) { onClose(); navigate(existing?.path ?? path) }
  }
  const basis = { avg_cost: '平均成本', cost_price: '成本参考价', sale_price: '销售参考价', none: '暂无参考价' }
  const selectedIds = new Set(rows.map(r => Number(r.suggestion.productId)))

  return (
    <Dialog open={open && (!handling || (handling.source.current && handling.source.active))} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{mode === 'create' ? '新建报废单' : '滞销建议'}</DialogTitle></DialogHeader>
        {!disposalOwnerCurrent(owner) ? <p role="alert">账号、权限或服务器已变化。原圈选保留，不转入当前上下文；请关闭本页后重新查看最新建议。</p> : <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">有效库存条码余量是当前实物在库。参考量沿原口径扣除账面预占，可能为零或负数；它不是新的出库预算。参考价依平均成本→成本参考价→销售参考价兜底，全部在库与圈选数量分别估值，不是成交价。</p>
          {!handling && <><div className="flex gap-2 flex-wrap">
            {can(PERMISSIONS.SALE_ORDER_CREATE) && <Button variant="outline" onClick={() => openNormal('/sale/new')}>正常销售</Button>}
            {can(PERMISSIONS.PRODUCT_VIEW) && can(PERMISSIONS.PRODUCT_UPDATE) && <Button variant="outline" onClick={() => openNormal('/price-change')}>全局改价</Button>}
            {can(PERMISSIONS.RETURN_ORDER_CREATE) && <Button variant="outline" onClick={() => openNormal('/returns/purchase/new')}>采购退货</Button>}
          </div>
          <p className="text-xs text-muted-foreground">这些入口只打开原正常业务并保留圈选，不携带参考价、供应商或采购行，不表示已关联或处理完成。</p>
          {/* 仓库 + 滞销建议列表 */}
          <div className="grid grid-cols-2 gap-5">
            <div className="space-y-1">
              <Label>选择仓库 *</Label>
              <Select value={whId || '__none__'} onValueChange={v => { if (!current()) return; if (rows.length) { toast.warning('已有圈选，先主动移除或清空圈选后再换仓；原数量保留'); return }; setWhId(v === '__none__' ? '' : v) }}>
                <SelectTrigger className="h-10 w-full"><SelectValue placeholder="请选择" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">请选择</SelectItem>
                  {warehouses?.map(w => <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">建议按「90 天无出库」识别滞销商品</p>
            </div>
            <div className="space-y-1 col-span-2">
              <Label>筛选建议</Label>
              <Input
                placeholder="按商品编码/名称过滤滞销商品…" value={keyword}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setKeyword(e.target.value)}
                disabled={!whId}
              />
            </div>
          </div>

          {/* 建议列表 */}
          <div className="border rounded-lg max-h-56 overflow-auto">
            <div className="grid min-w-[1480px] grid-cols-[40px_160px_160px_144px_224px_112px_100px_140px_180px_100px] gap-2 px-3 py-2 text-xs text-muted-foreground font-medium border-b sticky top-0 bg-background">
              <div className=""></div>
              <ProductIdentityGridHeaders />
              <div className="">ACTIVE在库／参考量</div>
              <div className="">全部在库参考估值</div>
              <div className="">最后出库</div>
              <div className="">操作</div>
            </div>
            {(suggestions?.list || []).map(s => {
              const selected = selectedIds.has(Number(s.productId))
              return (
                <div key={`${s.productId}`} className={`grid min-w-[1480px] grid-cols-[40px_160px_160px_144px_224px_112px_100px_140px_180px_100px] gap-2 items-center px-3 py-3 border-b last:border-0 text-sm ${selected ? 'bg-primary/5' : ''}`}>
                  <div className="">
                    <input type="checkbox" checked={selected} disabled={s.totalQty <= 0 && !selected} onChange={() => toggleSuggestion(s)} className="accent-primary" />
                  </div>
                  <ProductIdentityGridCells product={s} />
                  <div className="tabular-nums">{qty(s.onHandQty)}{s.unit}／{qty(s.totalQty)}{s.unit}<p className="text-xs text-muted-foreground">预占 {qty(s.reservedQty)}；{basis[s.valuationBasis]} {money(s.unitValue)}</p>{s.totalQty <= 0 && <p className="text-xs text-destructive-ink">参考量为零或异常，请核对</p>}</div>
                  <div className="tabular-nums">{money(s.totalValue)}</div>
                  <div className="text-xs text-muted-foreground">
                    {s.lastOutboundAt ? formatDisplayDateTime(s.lastOutboundAt) : '从未出库'}
                  </div>
                  <div className="">
                    <Button type="button" size="sm" variant={selected ? 'outline' : 'secondary'} className="h-7 text-xs" disabled={!selected && s.totalQty <= 0} onClick={() => toggleSuggestion(s)}>
                      {selected ? '移除' : '加入'}
                    </Button>
                  </div>
                </div>
              )
            })}
            {!suggestions?.list?.length && (
              <p className="text-center py-6 text-sm text-muted-foreground">
                {whId ? '没有符合筛选的滞销商品' : '请先选择仓库'}
              </p>
            )}
          </div>

          </>}
          {handling && <><p>来源商品与原仓固定，可关联基本量 {handling.source.data?.source.budget.availableQuantity ?? '—'}；不会继承旧批准。</p><Button disabled={!current() || !handling.source.data || rows.length > 0} onClick={() => {
            const data = handling.source.data
            if (!data || !current() || rows.length || whId || remark || keyword) { toast.warning('已有输入，来源未覆盖草稿'); return }
            const source = data.source, product = data.product
            setWhId(String(source.warehouseId)); setRows([{ suggestion: { productId: product.id, productCode: product.code, productName: product.name, unit: source.unit, articleNumber: null, spec: null, color: null, avgCost: 0, warehouseId: source.warehouseId, warehouseName: source.warehouseName, totalQty: 0, onHandQty: 0, reservedQty: 0, unitValue: 0, totalValue: 0, valuationBasis: 'none', lastOutboundAt: null }, quantity: '', disposeType: 3 }])
          }}>载入来源商品</Button><HandlingOperationPanel write={handling.write} /></>}
          {/* 已选明细：数量 + 处置方式 */}
          {rows.length > 0 && (
            <div className="space-y-2">
              <Label>处置明细（{rows.length} 项）</Label>
              <div className="border rounded-lg overflow-x-auto">
                <div className="grid min-w-[1500px] grid-cols-[160px_160px_144px_224px_112px_140px_160px_240px_40px] gap-2 px-3 py-2 text-xs text-muted-foreground font-medium border-b">
                  <ProductIdentityGridHeaders />
                  <div className="">处置数量</div>
                  <div className="">处置方式</div>
                  <div className="">备注</div>
                  <div className=""></div>
                </div>
                {rows.map(r => (
                  <div key={r.suggestion.productId} className="grid min-w-[1500px] grid-cols-[160px_160px_144px_224px_112px_140px_160px_240px_40px] gap-2 items-center px-3 py-3 border-b last:border-0 text-sm">
                    <ProductIdentityGridCells product={r.suggestion} />
                    <div className="">
                      <div className="flex items-center gap-1">
                        <Input quantity
                          type="number" min="0" step={qtyStep(allowDecimalOf(r.suggestion.productId))} className="h-8 text-sm"
                          title={`原参考量 ${r.suggestion.totalQty} ${r.suggestion.unit}，${basis[r.suggestion.valuationBasis]} ¥${r.suggestion.unitValue}`}
                          value={r.quantity}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateRow(r.suggestion.productId, { quantity: e.target.value })}
                        />
                        <span className="text-xs text-muted-foreground">{r.suggestion.unit}</span>
                      </div>
                    </div>
                    <div className="">
                      <span>报废（新独立单）</span>
                    </div>
                    <div className="">
                      <Input className="h-8 text-sm" placeholder="备注" value={r.remark || ''}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateRow(r.suggestion.productId, { remark: e.target.value })} />
                    </div>
                    <div className="">
                      <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs text-destructive-ink" onClick={() => removeRow(r.suggestion.productId)}>移除</Button>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-sm text-muted-foreground">
                选中数量参考估值：<span className="text-doc-code-strong tabular-nums">{money(totalValue)}</span>
                <span className="text-xs ml-2">（历史单保留当时的参考价；实际报废以执行时核对的库存为准，不采用旧建议量上限）</span>
              </p>
            </div>
          )}

          <div className="space-y-1">
            <Label>备注</Label>
            <Input value={remark} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRemark(e.target.value)} />
          </div>
        </div>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>关闭并保留圈选</Button>
          {canCreate && <Button onClick={handleCreate} disabled={!readable || submitting || mutation.create.isPending}>
            {submitting || mutation.create.isPending ? '创建中…' : '创建报废草稿'}
          </Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
