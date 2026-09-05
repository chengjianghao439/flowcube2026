import { AlertTriangle } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { SectionCard } from '@/components/shared/SectionCard'
import { cn } from '@/lib/utils'
import { baseQtyOf, type DraftItem } from '../validate'
import { summarizeSaleQuantities } from '@/lib/salePresentation'

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
  const quantities = summarizeSaleQuantities(filled.map(item => ({ ...item, quantity: baseQtyOf(item) })))
  const belowCost = filled.some(item => item.costPrice != null && item.unitPrice < Number(item.costPrice))

  return (
    <SectionCard compact className="overflow-hidden" contentClassName="px-5 py-4">
      <div className="grid grid-cols-[1.2fr_1fr_.8fr] items-center gap-8">
        <div className="flex items-center gap-3">
          <div className="grid flex-1 grid-cols-2 gap-3 text-sm">
            <div><p className="text-xs text-muted-foreground">商品明细</p><p className="mt-0.5 font-semibold tabular-nums">{filled.length} 行</p></div>
            <div><p className="text-xs text-muted-foreground">基本单位数量</p><p className="mt-0.5 font-semibold tabular-nums">{quantities.map(q => `${q.ordered} ${q.unit}`).join(' / ') || '—'}</p></div>
          </div>
        </div>

        <div className="space-y-2 border-border text-sm md:border-l md:pl-5">
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
          <div className="text-xs font-medium text-muted-foreground">订单金额</div>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground tabular-nums">¥{discountedTotal.toFixed(2)}</p>
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
