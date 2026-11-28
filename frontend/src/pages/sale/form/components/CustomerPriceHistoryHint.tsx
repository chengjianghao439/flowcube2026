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
      className="text-sm text-muted-foreground tabular-nums transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
    >
      ¥{latest.unitPrice}
    </button>
  )
}
