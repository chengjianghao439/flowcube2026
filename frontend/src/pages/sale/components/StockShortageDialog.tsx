import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

export interface StockShortageItem { productId: number; productName: string; required: number; available: number }

interface Props { open: boolean; onClose: () => void; shortages: StockShortageItem[] }

/**
 * 占库失败（可用库存不足）明细展示。
 * 占库弹窗本身已支持按数量占库，这里只展示缺货明细并引导回占库弹窗调整数量——
 * 不再提供「按可用量改单并重新占库」的一键操作（已按需求移除）。
 */
export default function StockShortageDialog({ open, onClose, shortages }: Props) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>可用库存不足</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">以下商品本次占库数量超过可用库存，请关闭后回占库弹窗调整数量：</p>
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {shortages.map(s => (
            <div key={s.productId} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
              <span>{s.productName}</span>
              <span className="text-muted-foreground">需 {s.required} · <span className="text-destructive font-medium">可用 {s.available}</span></span>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>关闭，调整数量</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
