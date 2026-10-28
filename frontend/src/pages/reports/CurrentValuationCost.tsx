import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { unitPrice } from '@/lib/format'
import type { AvgCostRow } from '@/hooks/useAvgCostReconciliation'

/** 当前对账估值的来源说明；不改成本、库存、历史快照或金额。 */
export function CurrentValuationCost({ value, source, productName }: {
  value: number | null | undefined; source: AvgCostRow['unitCostSource']; productName: string
}) {
  const detail = source === 'avg_cost' ? ['当前移动均价', '按当前商品移动均价估值。']
    : source === 'cost_price' ? ['当前进价估值', '移动均价无有效非零值，沿当前商品进价估值。']
    : source === 'zero_fallback' ? ['当前按0估值', '成本资料缺失，或均价及进价均无有效非零值。']
    : ['来源未记录', '当前服务未返回估值来源标注。']
  return <Popover>
    <PopoverTrigger asChild><Button type="button" variant="ghost" className="h-auto p-0 tabular-nums underline decoration-dotted underline-offset-4"
      aria-label={'查看' + productName + '的当前估值来源'}>{unitPrice(value)}</Button></PopoverTrigger>
    <PopoverContent aria-label={productName + '的当前估值来源'} align="end" className="w-[min(20rem,calc(100vw-2rem))] space-y-2 p-3 text-left text-sm">
      <p className="font-medium">{detail[0]}</p><p>{detail[1]}</p>
      <p>此页用于当前库存对账估值；历史出库成本依原销售行首次记录的成本。</p>
    </PopoverContent>
  </Popover>
}
