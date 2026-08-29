import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useReleaseSale } from '@/hooks/useSale'
import type { SaleOrderItem, ReserveItemOverride } from '@/types/sale'

interface Props {
  open: boolean
  orderId: number | null
  items: SaleOrderItem[]
  onClose: () => void
}

type RowState = { checked: boolean; qty: number }

/**
 * 按产品取消占库弹窗：列出已占库存的行，每行可填释放数量（默认全释放）。
 * 提供「整单释放」快捷按钮（一次性释放全部已占）。提交只把「勾选且 qty>0」的行传给后端 release。
 */
export default function ReleaseAllocationDialog({ open, orderId, items, onClose }: Props) {
  const release = useReleaseSale()
  const [rows, setRows] = useState<Record<number, RowState>>({})

  const reservedItems = items.filter(i => (i.reservedQty ?? 0) > 0)

  useEffect(() => {
    if (!open) return
    setRows(Object.fromEntries(
      reservedItems.map(i => [i.id, { checked: true, qty: i.reservedQty ?? 0 }]),
    ))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!orderId) return null

  const selected = reservedItems.filter(i => rows[i.id]?.checked && (rows[i.id]?.qty ?? 0) > 0)

  function setRow(id: number, patch: Partial<RowState>) {
    setRows(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }

  function releaseAll() {
    setRows(Object.fromEntries(
      reservedItems.map(i => [i.id, { checked: true, qty: i.reservedQty ?? 0 }]),
    ))
  }

  function handleConfirm(partial: boolean) {
    if (!orderId) return
    if (partial) {
      const payload: ReserveItemOverride[] = selected.map(i => ({
        id: i.id,
        warehouseId: i.warehouseId ?? 0,
        warehouseName: i.warehouseName ?? '',
        qty: rows[i.id].qty,
      }))
      release.mutate({ id: orderId, items: payload }, { onSuccess: onClose })
    } else {
      release.mutate({ id: orderId }, { onSuccess: onClose })
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>取消占库 · 按产品释放</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          勾选要释放的商品并填写释放数量（默认全释放）。只释放勾选部分即可保留其余占库。
        </p>

        <div className="max-h-80 overflow-y-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="w-10 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={reservedItems.length > 0 && reservedItems.every(i => rows[i.id]?.checked)}
                    onChange={e => setRows(Object.fromEntries(reservedItems.map(i => [i.id, { checked: e.target.checked, qty: i.reservedQty ?? 0 }])))}
                    aria-label="全选"
                  />
                </th>
                <th className="px-2 py-2 text-left">商品</th>
                <th className="w-20 px-2 py-2 text-right">已占</th>
                <th className="w-28 px-2 py-2 text-right">释放数量</th>
              </tr>
            </thead>
            <tbody>
              {reservedItems.map(item => {
                const st = rows[item.id] ?? { checked: false, qty: item.reservedQty ?? 0 }
                return (
                  <tr key={item.id} className="border-t">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={!!st.checked}
                        onChange={e => setRow(item.id, { checked: e.target.checked })}
                        aria-label={`选择 ${item.productName}`}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <div className="font-medium">{item.productName}</div>
                      <div className="text-xs text-muted-foreground">
                        {item.productCode}{item.articleNumber ? ` · 货号 ${item.articleNumber}` : ''}{item.spec ? ` · ${item.spec}` : ''}{item.color ? ` · ${item.color}` : ''}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{item.reservedQty} {item.unit}</td>
                    <td className="px-2 py-2">
                      <Input
                        type="number"
                        min={0}
                        max={item.reservedQty ?? 0}
                        value={st.qty ?? 0}
                        disabled={!st.checked}
                        onChange={e => setRow(item.id, { qty: Number(e.target.value) })}
                        className={cn('h-9 text-sm tabular-nums')}
                      />
                    </td>
                  </tr>
                )
              })}
              {!reservedItems.length && (
                <tr><td colSpan={4} className="px-2 py-6 text-center text-muted-foreground">没有已占库存的明细</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={releaseAll} disabled={release.isPending}>整单全释放</Button>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button disabled={release.isPending || !selected.length} onClick={() => handleConfirm(true)}>
            {release.isPending ? '释放中…' : `释放选中 ${selected.length} 项`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
