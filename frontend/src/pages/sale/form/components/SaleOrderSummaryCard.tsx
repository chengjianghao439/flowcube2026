import { AlertTriangle, PackageOpen, ReceiptText } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { SectionCard } from '@/components/shared/SectionCard'
import { cn } from '@/lib/utils'
import type { DraftItem } from '../validate'

export function SaleOrderSummaryCard({
  items, total, discount, discountedTotal, discountAmount, onDiscountChange,
  editableDiscount = true, warningText,
}: {
  items: DraftItem[]
  total: number
  discount: number
  discountedTotal: number
  discountAmount: string
  onDiscountChange?: (value: string) => void
  editableDiscount?: boolean
  warningText?: string
}) {
  const filled = items.filter(item => item.productId > 0)
  const quantity = filled.reduce((sum, item) => sum + item.quantity, 0)
  const belowCost = filled.some(item => item.costPrice != null && item.unitPrice < Number(item.costPrice))

  return (
    <SectionCard title="订单汇总" compact className="overflow-hidden">
      <div className="grid gap-5 md:grid-cols-3 md:items-center">
        <div className="flex items-center gap-3 rounded-lg bg-muted/35 p-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <PackageOpen className="h-[18px] w-[18px]" />
          </span>
          <div className="grid flex-1 grid-cols-2 gap-3 text-sm">
            <div><p className="text-xs text-muted-foreground">商品种数</p><p className="mt-0.5 font-semibold tabular-nums">{filled.length} 种</p></div>
            <div><p className="text-xs text-muted-foreground">合计数量</p><p className="mt-0.5 font-semibold tabular-nums">{quantity}</p></div>
          </div>
        </div>

        <div className="space-y-3 border-border text-sm md:border-l md:pl-5">
          <div className="flex items-center justify-between gap-3 text-muted-foreground">
            <span>商品金额</span><span className="tabular-nums text-foreground">¥{total.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <label className="text-muted-foreground" htmlFor="sale-discount-amount">折扣金额</label>
            {editableDiscount ? (
              <Input id="sale-discount-amount" type="number" min={0} step={0.01} value={discountAmount}
                onChange={event => onDiscountChange?.(event.target.value)} placeholder="0.00" className="h-8 w-28 text-right text-sm tabular-nums" />
            ) : <span className="tabular-nums text-foreground">-¥{discount.toFixed(2)}</span>}
          </div>
        </div>

        <div className="border-t border-border pt-4 md:border-l md:border-t-0 md:pl-5 md:pt-0">
          <div className="flex items-center gap-2 text-xs font-medium text-primary"><ReceiptText className="h-3.5 w-3.5" />订单金额</div>
          <p className="mt-2 text-3xl font-semibold tracking-tight text-foreground tabular-nums">¥{discountedTotal.toFixed(2)}</p>
        </div>

        {belowCost && warningText && (
          <div className={cn('flex gap-2 rounded-lg border border-destructive/20 bg-destructive/[0.04] px-3 py-2.5 text-xs leading-5 text-destructive md:col-span-3')}>
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{warningText}</span>
          </div>
        )}
      </div>
    </SectionCard>
  )
}
