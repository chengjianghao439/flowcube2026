import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { WarehouseSelect } from '@/components/shared/WarehouseSelect'
import { Loader2, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSaleReservePreview, useReserveSale } from '@/hooks/useSale'
import { ApiClientError } from '@/api/client'
import type { StockShortageItem } from './StockShortageDialog'

interface Props {
  open: boolean
  orderId: number | null
  onClose: () => void
  /** 提交时后端仍判定库存不足（并发占用）：交给调用方复用现有 StockShortageDialog 展示"按可用量调整" */
  onShortage: (orderId: number, shortages: StockShortageItem[]) => void
}

type Selection = Record<number, { warehouseId: number; warehouseName: string }>

/**
 * 占用库存弹窗：逐个商品选择发货仓库，每选一个仓库即时看到该仓可用量。
 * 取代原先新建订单时的"分仓发货"开关——仓库分配挪到占库这一步，此时才有真实可用量可看。
 */
export default function ReserveAllocationDialog({ open, orderId, onClose, onShortage }: Props) {
  const { data: preview, isLoading } = useSaleReservePreview(orderId ?? 0, open)
  const reserve = useReserveSale()
  const [selection, setSelection] = useState<Selection>({})

  useEffect(() => {
    if (!preview) return
    setSelection(Object.fromEntries(
      preview.items.map(i => [i.itemId, { warehouseId: i.currentWarehouseId, warehouseName: i.currentWarehouseName }]),
    ))
  }, [preview])

  if (!orderId) return null

  const items = preview?.items ?? []
  const availableFor = (itemId: number, warehouseId: number) =>
    items.find(i => i.itemId === itemId)?.warehouses.find(w => w.warehouseId === warehouseId)?.available ?? 0
  const shortItemIds = items.filter(i => availableFor(i.itemId, selection[i.itemId]?.warehouseId ?? i.currentWarehouseId) < i.quantity)

  function handleConfirm() {
    if (!orderId) return
    const overrideItems = items.map(i => ({
      id: i.itemId,
      warehouseId: selection[i.itemId]?.warehouseId ?? i.currentWarehouseId,
      warehouseName: selection[i.itemId]?.warehouseName ?? i.currentWarehouseName,
    }))
    reserve.mutate({ id: orderId, items: overrideItems }, {
      onSuccess: onClose,
      onError: (e: unknown) => {
        if (e instanceof ApiClientError && e.code === 'STOCK_SHORTAGE') {
          const shortages = (e.data as { shortages?: StockShortageItem[] } | null)?.shortages ?? []
          onShortage(orderId, shortages)
          onClose()
        }
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>占用库存 · 选择发货仓库</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          为每个商品选择发货仓库，可用量会实时显示；不同商品可以选不同仓库（分仓发货）。
        </p>

        {isLoading && (
          <div className="flex h-32 items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />加载中...
          </div>
        )}

        {!isLoading && (
          <div className="max-h-[28rem] overflow-y-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">商品</th>
                  <th className="w-20 px-2 py-2 text-right">需求数量</th>
                  <th className="w-48 px-2 py-2 text-left">发货仓库</th>
                  <th className="w-24 px-2 py-2 text-right">可用量</th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => {
                  const sel = selection[item.itemId] ?? { warehouseId: item.currentWarehouseId, warehouseName: item.currentWarehouseName }
                  const available = availableFor(item.itemId, sel.warehouseId)
                  const short = available < item.quantity
                  return (
                    <tr key={item.itemId} className="border-t">
                      <td className="px-3 py-2">
                        <div className="font-medium">{item.productName}</div>
                        <div className="text-xs text-muted-foreground">
                          {item.productCode}{item.spec ? ` · ${item.spec}` : ''}{item.color ? ` · ${item.color}` : ''}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{item.quantity} {item.unit}</td>
                      <td className="px-2 py-2">
                        <WarehouseSelect
                          value={sel.warehouseId}
                          onChange={(id, name) => {
                            if (id == null) return
                            setSelection(prev => ({ ...prev, [item.itemId]: { warehouseId: id, warehouseName: name } }))
                          }}
                          className="h-9 text-sm"
                        />
                      </td>
                      <td className={cn('px-2 py-2 text-right tabular-nums font-medium', short ? 'text-destructive' : 'text-muted-foreground')}>
                        <span className="inline-flex items-center gap-1">
                          {short && <AlertTriangle className="h-3.5 w-3.5" />}
                          {available}
                        </span>
                      </td>
                    </tr>
                  )
                })}
                {!items.length && (
                  <tr><td colSpan={4} className="px-2 py-6 text-center text-muted-foreground">没有可占用库存的明细</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {shortItemIds.length > 0 && (
          <p className="flex items-center gap-1.5 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {shortItemIds.length} 项商品在所选仓库可用量不足，仍可尝试占用，届时会给出可用量不足的详情
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button disabled={isLoading || reserve.isPending || !items.length} onClick={handleConfirm}>
            {reserve.isPending ? '占用中…' : '确认占用库存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
