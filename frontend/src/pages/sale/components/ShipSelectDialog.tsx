import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { SaleOrder } from '@/types/sale'

interface Props {
  open: boolean
  onClose: () => void
  order: SaleOrder
  loading?: boolean
  /** 传空数组 = 全部发货；传选中行 id = 只发这些 */
  onConfirm: (itemIds: number[]) => void
}

/**
 * 发货选择弹窗（分批发货）：列出该订单尚未派发到仓库任务的明细行，勾选本次要发的行。
 * 默认全选（等价于「全部发货」）。取消勾选某些行即分批——未选的留待下次「继续发货」。
 */
export default function ShipSelectDialog({ open, onClose, order, loading, onConfirm }: Props) {
  const undispatched = (order.items ?? []).filter(i => !i.dispatched)
  const [selected, setSelected] = useState<Set<number>>(new Set())

  useEffect(() => {
    if (open) setSelected(new Set(undispatched.map(i => i.id)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const allSelected = undispatched.length > 0 && selected.size === undispatched.length
  const toggle = (id: number) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>发起出库</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          勾选本次要发货的商品。默认全选=全部发货；只勾一部分即分批发货，其余留待之后「继续发货」。
          {order.isMultiWarehouse && '（本单跨多个仓库，按仓库分别建出库任务）'}
        </p>
        <div className="max-h-80 overflow-y-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="w-10 px-2 py-1.5">
                  <input type="checkbox" checked={allSelected}
                    onChange={e => setSelected(e.target.checked ? new Set(undispatched.map(i => i.id)) : new Set())} />
                </th>
                <th className="px-2 py-1.5 text-left">商品</th>
                {order.isMultiWarehouse && <th className="px-2 py-1.5 text-left">发货仓库</th>}
                <th className="px-2 py-1.5 text-right">数量</th>
              </tr>
            </thead>
            <tbody>
              {undispatched.map(item => (
                <tr key={item.id} className="border-t cursor-pointer hover:bg-muted/30" onClick={() => toggle(item.id)}>
                  <td className="px-2 py-1.5 text-center">
                    <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)} onClick={e => e.stopPropagation()} />
                  </td>
                  <td className="px-2 py-1.5">
                    {item.productName}
                    <span className="ml-1 text-xs text-muted-foreground">{item.productCode}</span>
                  </td>
                  {order.isMultiWarehouse && <td className="px-2 py-1.5">{item.warehouseName || '默认仓库'}</td>}
                  <td className="px-2 py-1.5 text-right tabular-nums">{item.quantity} {item.unit}</td>
                </tr>
              ))}
              {!undispatched.length && (
                <tr><td colSpan={4} className="px-2 py-4 text-center text-muted-foreground">没有可发货的明细</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button
            disabled={loading || selected.size === 0}
            onClick={() => onConfirm(allSelected ? [] : [...selected])}
          >{loading ? '发起中…' : allSelected ? '全部发货' : `发选中 ${selected.size} 项`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
