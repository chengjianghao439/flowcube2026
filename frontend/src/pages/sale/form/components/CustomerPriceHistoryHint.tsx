import type { CustomerSalePriceHistoryItem } from '@/api/sale'

interface CustomerPriceHistoryHintProps {
  history?: CustomerSalePriceHistoryItem[]
  disabled?: boolean
  onSelect: (unitPrice: number) => void
}

/**
 * 在销售明细单价输入框下方展示该客户对此商品的最近一次历史成交价，点击一键填入。
 */
export function CustomerPriceHistoryHint({ history, disabled = false, onSelect }: CustomerPriceHistoryHintProps) {
  const latest = history?.[0]
  if (!latest) return null
  return (
    <div className="mt-1.5 flex justify-end">
      <button
        type="button"
        disabled={disabled}
        title={`${latest.orderNo} · ${latest.orderDate} · ${latest.quantity}${latest.unit}（点击填入）`}
        onClick={() => onSelect(latest.unitPrice)}
        className="group inline-flex max-w-full items-center gap-1 rounded-md border border-border/70 bg-muted/50 px-2 py-0.5 text-[11px] leading-4 text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
      >
        <span className="shrink-0 text-muted-foreground/80 group-hover:text-primary/80">上次</span>
        <span className="truncate font-medium text-foreground tabular-nums group-hover:text-primary">
          ¥{latest.unitPrice}
        </span>
      </button>
    </div>
  )
}
