import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/toast'
import { useSaleDetail, useUpdateSale, useReserveSale } from '@/hooks/useSale'

export interface StockShortageItem { productId: number; productName: string; required: number; available: number }

interface Props { open: boolean; onClose: () => void; orderId: number | null; shortages: StockShortageItem[] }

/**
 * 占库失败（可用库存不足）明细展示 + 一键"按可用量修改订单"。
 * 订单此时仍是草稿态，直接复用整单替换明细的 update 接口——把不足商品的数量
 * 降到可用量（降到 0 的行整行移除）；全部商品都不够时不提供一键操作，引导手动处理。
 */
export default function StockShortageDialog({ open, onClose, orderId, shortages }: Props) {
  const { data: order } = useSaleDetail(orderId ?? 0)
  const update = useUpdateSale()
  const reserve = useReserveSale()
  const [applying, setApplying] = useState(false)

  const shortageMap = new Map(shortages.map(s => [s.productId, s]))
  const allZero = order?.items?.length
    ? order.items.every(i => (shortageMap.get(i.productId)?.available ?? i.quantity) <= 0)
    : false

  async function handleApply() {
    if (!order?.items?.length || !orderId) return
    const newItems = order.items
      .map(i => {
        const short = shortageMap.get(i.productId)
        const qty = short ? Math.min(i.quantity, short.available) : i.quantity
        return { ...i, quantity: qty, amount: qty * i.unitPrice }
      })
      .filter(i => i.quantity > 0)
    if (!newItems.length) {
      toast.warning('按可用量调整后订单将无任何明细，请改用取消订单')
      return
    }
    setApplying(true)
    try {
      await update.mutateAsync({
        id: orderId,
        customerId: order.customerId, customerName: order.customerName,
        warehouseId: order.warehouseId, warehouseName: order.warehouseName,
        remark: order.remark, carrierId: order.carrierId, carrier: order.carrier ?? undefined,
        freightType: order.freightType ?? undefined, receiverName: order.receiverName ?? undefined,
        receiverPhone: order.receiverPhone ?? undefined, receiverAddress: order.receiverAddress ?? undefined,
        items: newItems,
      })
      toast.success('已按可用量调整明细，正在重新占库…')
      await reserve.mutateAsync({ id: orderId })
      onClose()
    } finally {
      setApplying(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>可用库存不足</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">以下商品可用库存不足，无法整单占用：</p>
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {shortages.map(s => (
            <div key={s.productId} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
              <span>{s.productName}</span>
              <span className="text-muted-foreground">需 {s.required} · <span className="text-destructive font-medium">可用 {s.available}</span></span>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>关闭，手动处理</Button>
          {!allZero && (
            <Button disabled={applying || update.isPending || reserve.isPending} onClick={handleApply}>
              {applying ? '调整中…' : '按可用量修改订单并重新占库'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
