import { ProductIdentityCells, ProductIdentityHeaders } from '@/components/shared/ProductIdentityCells'
import { useEffect, useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { PackageCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { isAllocationQtyValid, clampAllocationQty } from './saleAllocation'
import type { SaleOrder, ShipItemRequest } from '@/types/sale'

interface Props {
  open: boolean
  onClose: () => void
  order: SaleOrder
  loading?: boolean
  onConfirm: (items: ShipItemRequest[]) => void
}
type RowState = { checked: boolean; qty: number }

export default function ShipSelectDialog({ open, onClose, order, loading, onConfirm }: Props) {
  const undispatched = useMemo(
    () => (order.items ?? []).filter(i => (i.dispatchedQty ?? 0) < (i.reservedQty ?? 0)),
    [order.items],
  )
  const [rows, setRows] = useState<Record<number, RowState>>({})

  useEffect(() => {
    if (!open) return
    setRows(Object.fromEntries(undispatched.map(item => [item.id, {
      checked: true,
      qty: clampAllocationQty((item.reservedQty ?? 0) - (item.dispatchedQty ?? 0), item.reservedQty ?? 0),
    }])))
  }, [open, undispatched])

  const limitFor = (id: number) => {
    const item = undispatched.find(row => row.id === id)
    return item ? clampAllocationQty((item.reservedQty ?? 0) - (item.dispatchedQty ?? 0), item.reservedQty ?? 0) : 0
  }
  const selected = undispatched.filter(item => rows[item.id]?.checked)
  const invalid = selected.filter(item => !isAllocationQtyValid(rows[item.id]?.qty ?? 0, limitFor(item.id)))
  const allSelected = undispatched.length > 0 && undispatched.every(item => rows[item.id]?.checked)

  const setRow = (id: number, patch: Partial<RowState>) => setRows(prev => ({
    ...prev,
    [id]: { ...(prev[id] ?? { checked: false, qty: limitFor(id) }), ...patch },
  }))

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="flex max-h-[86vh] w-[min(94vw,900px)] max-w-none flex-col overflow-hidden">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><PackageCheck className="h-5 w-5 text-primary" />发起出库</DialogTitle></DialogHeader>
        <DialogDescription>
          选择本次发货商品并填写数量。未发部分保留，可稍后继续发货。
          {order.isMultiWarehouse && ' 本单将按仓库分别创建出库任务。'}
        </DialogDescription>
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border">
          <table className="w-full min-w-[1560px] text-sm">
            <thead className="sticky top-0 bg-muted text-xs text-muted-foreground">
              <tr>
                <th className="w-10 px-3 py-2"><input type="checkbox" aria-label="选择全部可出库明细" checked={allSelected} onChange={e => setRows(Object.fromEntries(undispatched.map(item => [item.id, { checked: e.target.checked, qty: limitFor(item.id) }])))} /></th>
                <ProductIdentityHeaders /><th className="min-w-20 px-3 py-3 text-left">单位</th>
                <th className="w-40 px-3 py-2 text-left">发货仓库</th>
                <th className="w-28 px-3 py-2 text-right">已占未发</th>
                <th className="w-36 px-3 py-2 text-right">本次发货</th>
              </tr>
            </thead>
            <tbody>
              {undispatched.map(item => {
                const state = rows[item.id] ?? { checked: false, qty: limitFor(item.id) }
                const invalidQty = state.checked && !isAllocationQtyValid(state.qty, limitFor(item.id))
                return (
                  <tr key={item.id} className="border-t align-top hover:bg-muted/20">
                    <td className="px-3 py-3 text-center"><input type="checkbox" aria-label={`选择 ${item.productName}`} checked={state.checked} onChange={e => setRow(item.id, { checked: e.target.checked })} /></td>
                    <ProductIdentityCells product={item} /><td className="px-3 py-3">{item.unit || '—'}</td>
                    <td className="px-3 py-3">{item.warehouseName || order.warehouseName}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{limitFor(item.id)} {item.unit}</td>
                    <td className="px-3 py-3">
                      <Input aria-label={`${item.productName}本次出库数量`} aria-invalid={invalidQty} type="number" min={0.0001} step={0.0001} max={limitFor(item.id)} value={state.qty} disabled={!state.checked}
                        onChange={e => setRow(item.id, { qty: Number(e.target.value) })}
                        className={cn('h-9 text-right tabular-nums', invalidQty && 'border-destructive')} />
                    </td>
                  </tr>
                )
              })}
              {!undispatched.length && <tr><td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">没有可发货明细，请先占库</td></tr>}
            </tbody>
          </table>
        </div>
        <DialogFooter className="sm:items-center sm:justify-between">
          <span className={cn('mr-auto text-sm text-muted-foreground', invalid.length > 0 && 'text-destructive')}>
            {invalid.length ? `${invalid.length} 项数量无效：须大于 0、不超过已占未发量，最多 4 位小数` : `已选择 ${selected.length} 项`}
          </span>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button disabled={loading || !selected.length || invalid.length > 0}
            onClick={() => onConfirm(selected.map(item => ({ id: item.id, qty: rows[item.id].qty })))}>
            {loading ? '发起中…' : '确认发起出库'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
