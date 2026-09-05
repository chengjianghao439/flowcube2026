import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { AlertTriangle } from 'lucide-react'

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
      <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-destructive" />可用库存不足</DialogTitle></DialogHeader>
        <DialogDescription>以下商品本次占库数量超过可用库存，请关闭后回占库弹窗调整数量：</DialogDescription>
        <div className="max-h-72 overflow-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted text-xs text-muted-foreground">
              <tr><th className="px-3 py-2 text-left font-medium">商品</th><th className="px-3 py-2 text-right font-medium">本次需占</th><th className="px-3 py-2 text-right font-medium">可用数量</th></tr>
            </thead>
            <tbody className="divide-y">
              {shortages.map((s, index) => (
                <tr key={`${s.productId}-${index}`}>
                  <td className="max-w-48 break-words px-3 py-3 font-medium">{s.productName}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{s.required}</td>
                  <td className="px-3 py-3 text-right font-medium tabular-nums text-destructive">{s.available}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>关闭，调整数量</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
