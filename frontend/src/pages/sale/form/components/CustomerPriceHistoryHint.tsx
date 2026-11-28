import type { CustomerSalePriceHistoryItem } from '@/api/sale'

interface CustomerPriceHistoryHintProps {
  history?: CustomerSalePriceHistoryItem[]
  disabled?: boolean
  onSelect: (unitPrice: number) => void
}

/**
 * 在销售明细「历史价」独立列中展示该客户对此商品的最近一次成交价，点击一键填入单价。
 */
export function CustomerPriceHistoryHint({ history, disabled = false, onSelect }: CustomerPriceHistoryHintProps) {
  const latest = history?.[0]
  if (!latest) return <span className="text-muted-foreground/50">—</span>
  return (
    <button
      type="button"
      disabled={disabled}
      title={`${latest.orderNo} · ${latest.orderDate} · ${latest.quantity}${latest.unit}（点击填入单价）`}
      onClick={() => onSelect(latest.unitPrice)}
      className="inline-flex items-center justify-end rounded-md border border-border/70 bg-muted/40 px-2 py-1 text-xs font-medium text-foreground tabular-nums transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
    >
      ¥{latest.unitPrice}
    </button>
  )
}
