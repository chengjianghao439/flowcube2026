import { ProductIdentityGridCells, ProductIdentityGridHeaders } from '@/components/shared/ProductIdentityCells'
import { useState } from 'react'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useDisposalSuggestions, useDisposalMutation } from '@/hooks/useDisposal'
import { useWarehousesActive } from '@/hooks/useWarehouses'
import type { DisposalSuggestion, DisposeType } from '@/types/disposal'

interface Props { open: boolean; onClose: () => void }

/** 待选行：建议 + 用户调整的数量与处置方式 */
interface PendingRow {
  suggestion: DisposalSuggestion
  quantity: string
  disposeType: DisposeType
  remark?: string
}

const DISPOSE_TYPES: { value: DisposeType; label: string; hint: string }[] = [
  { value: 1, label: '降价促销', hint: '库存出库，账面移除' },
  { value: 2, label: '退货供应商', hint: '库存出库，账面移除' },
  { value: 3, label: '报废', hint: '库存出库 + 报废台账留痕' },
]

export default function CreateDisposalDialog({ open, onClose }: Props) {
  const [whId, setWhId] = useState('')
  const [remark, setRemark] = useState('')
  const [keyword, setKeyword] = useState('')
  const [rows, setRows] = useState<PendingRow[]>([])
  const [submitting, setSubmitting] = useState(false)
  const { data: warehouses } = useWarehousesActive()
  const { data: suggestions } = useDisposalSuggestions({ warehouseId: whId ? Number(whId) : null, keyword: keyword || undefined })
  const mutation = useDisposalMutation()

  const warehouse = warehouses?.find(w => String(w.id) === whId)

  function reset() {
    setWhId(''); setRemark(''); setKeyword(''); setRows([])
  }

  function toggleSuggestion(s: DisposalSuggestion) {
    setRows(prev => {
      const exists = prev.find(r => Number(r.suggestion.productId) === Number(s.productId))
      if (exists) return prev.filter(r => r !== exists)
      return [...prev, { suggestion: s, quantity: String(s.totalQty), disposeType: 1 }]
    })
  }

  function updateRow(productId: number, patch: Partial<PendingRow>) {
    setRows(prev => prev.map(r => (Number(r.suggestion.productId) === Number(productId) ? { ...r, ...patch } : r)))
  }

  function removeRow(productId: number) {
    setRows(prev => prev.filter(r => Number(r.suggestion.productId) !== Number(productId)))
  }

  const totalValue = rows.reduce((sum, r) => sum + (Number(r.quantity) || 0) * r.suggestion.unitValue, 0)

  async function handleCreate() {
    if (!warehouse) { toast.warning('请选择仓库'); return }
    if (!rows.length) { toast.warning('请至少圈选一件滞销商品'); return }
    const invalid = rows.find(r => {
      const q = Number(r.quantity)
      return !Number.isFinite(q) || q <= 0
    })
    if (invalid) {
      toast.warning(`「${invalid.suggestion.productName}」的处置数量无效，必须大于 0`)
      return
    }
    if (submitting || mutation.create.isPending) return
    try {
      setSubmitting(true)
      await mutation.create.mutateAsync({
        warehouseId: warehouse.id,
        warehouseName: warehouse.name,
        remark: remark || undefined,
        items: rows.map(r => ({
          productId: r.suggestion.productId,
          quantity: Number(r.quantity),
          disposeType: r.disposeType,
          remark: r.remark || undefined,
        })),
      })
      toast.success('处置单已创建为草稿，可在列表中提交审批')
      reset()
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  const selectedIds = new Set(rows.map(r => Number(r.suggestion.productId)))

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) { reset(); onClose() } }}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>新建滞销处理单</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          {/* 仓库 + 滞销建议列表 */}
          <div className="grid grid-cols-2 gap-5">
            <div className="space-y-1">
              <Label>选择仓库 *</Label>
              <Select value={whId || '__none__'} onValueChange={v => { setWhId(v === '__none__' ? '' : v); setRows([]) }}>
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
              <div className="">在库量</div>
              <div className="">库存价值</div>
              <div className="">最后出库</div>
              <div className="">操作</div>
            </div>
            {(suggestions?.list || []).map(s => {
              const selected = selectedIds.has(Number(s.productId))
              return (
                <div key={`${s.productId}`} className={`grid min-w-[1480px] grid-cols-[40px_160px_160px_144px_224px_112px_100px_140px_180px_100px] gap-2 items-center px-3 py-3 border-b last:border-0 text-sm ${selected ? 'bg-primary/5' : ''}`}>
                  <div className="">
                    <input type="checkbox" checked={selected} onChange={() => toggleSuggestion(s)} className="accent-primary" />
                  </div>
                  <ProductIdentityGridCells product={s} />
                  <div className="tabular-nums">{s.totalQty}{s.unit}</div>
                  <div className="tabular-nums">¥{s.totalValue.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</div>
                  <div className="text-xs text-muted-foreground">
                    {s.lastOutboundAt ? s.lastOutboundAt : '从未出库'}
                  </div>
                  <div className="">
                    <Button type="button" size="sm" variant={selected ? 'outline' : 'secondary'} className="h-7 text-xs" onClick={() => toggleSuggestion(s)}>
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
                        <Input
                          type="number" min="0" step="0.01" className="h-8 text-sm"
                          title={`在库 ${r.suggestion.totalQty} ${r.suggestion.unit}，成本 ¥${r.suggestion.unitValue}`}
                          value={r.quantity}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateRow(r.suggestion.productId, { quantity: e.target.value })}
                        />
                        <span className="text-xs text-muted-foreground">{r.suggestion.unit}</span>
                      </div>
                    </div>
                    <div className="">
                      <Select
                        value={String(r.disposeType)}
                        onValueChange={(v) => updateRow(r.suggestion.productId, { disposeType: Number(v) as DisposeType })}
                      >
                        <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {DISPOSE_TYPES.map(t => <SelectItem key={t.value} value={String(t.value)}>{t.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="">
                      <Input className="h-8 text-sm" placeholder="备注" value={r.remark || ''}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateRow(r.suggestion.productId, { remark: e.target.value })} />
                    </div>
                    <div className="">
                      <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs text-destructive" onClick={() => removeRow(r.suggestion.productId)}>移除</Button>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-sm text-muted-foreground">
                处置总价值：<span className="text-doc-code-strong tabular-nums">¥{totalValue.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</span>
                <span className="text-xs ml-2">（按持有成本估算，执行时以实际库存扣减为准）</span>
              </p>
            </div>
          )}

          <div className="space-y-1">
            <Label>备注</Label>
            <Input value={remark} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRemark(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => { reset(); onClose() }} disabled={submitting}>取消</Button>
          <Button onClick={handleCreate} disabled={submitting || mutation.create.isPending}>
            {submitting || mutation.create.isPending ? '创建中…' : '创建处置单'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
