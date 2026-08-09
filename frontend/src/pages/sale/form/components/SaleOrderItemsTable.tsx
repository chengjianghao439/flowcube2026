import { useNavigate } from 'react-router-dom'
import { Button }  from '@/components/ui/button'
import { Input }   from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { baseQtyOf, parsePositiveInteger, parsePrice, type DraftItem } from '../validate'

export function SaleOrderItemsTable({
  items, invalidItemKeys, quantityRefs, priceLoading,
  setFinderItemKey, setFinderOpen, updateItem, removeItem,
}: {
  items: DraftItem[]
  invalidItemKeys: Set<number>
  quantityRefs: React.MutableRefObject<Map<number, HTMLInputElement>>
  priceLoading: Record<number, boolean>
  setFinderItemKey: (k: number | null) => void
  setFinderOpen: (v: boolean) => void
  updateItem: (k: number, field: string, val: string | number) => void
  removeItem: (k: number) => void
}) {
  const navigate = useNavigate()
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-table-head">
            <th className="w-28 pb-2 text-left">编码</th>
            <th className="w-20 pb-2 text-left">货号</th>
            <th className="w-20 pb-2 text-left">型号</th>
            <th className="pb-2 text-left">商品</th>
            <th className="w-20 pb-2 text-left">颜色</th>
            <th className="w-16 pb-2 text-center">单位</th>
            <th className="w-20 pb-2 text-right">数量</th>
            <th className="w-24 pb-2 text-right">单价 (¥)</th>
            <th className="w-28 pb-2 text-right">金额</th>
            <th className="w-10 pb-2" />
          </tr>
        </thead>
        <tbody>
          {items.map(item => (
            <tr key={item._key} className="border-b border-border/40">
              <td className="py-2.5 text-doc-code-muted">{item.productCode || '—'}</td>
              <td className="py-2.5 text-muted-foreground">{item.articleNumber || '—'}</td>
              <td className="py-2.5 text-muted-foreground">{item.spec || '—'}</td>
              <td className="py-2.5 pr-3">
                <button
                  type="button"
                  onClick={() => { setFinderItemKey(item._key); setFinderOpen(true) }}
                  onDoubleClick={() => { setFinderOpen(false); setFinderItemKey(null); navigate('/products') }}
                  className={cn('block w-full overflow-hidden rounded-md border border-border bg-background px-3 py-2 text-left text-sm transition-colors hover:border-primary hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', invalidItemKeys.has(item._key) && 'border-destructive/60 bg-destructive/5')}
                >
                  {item.productName
                    ? <span className="truncate font-medium">{item.productName}</span>
                    : <span className="text-muted-foreground">点击选择商品...</span>}
                </button>
              </td>
              <td className="py-2.5 text-muted-foreground">{item.color || '—'}</td>

              <td className="py-2.5 text-center">
                {(item.units && item.units.filter(u => !u.isBase).length > 0) ? (
                  <select
                    value={item.entryUnit || item.unit}
                    onChange={e => updateItem(item._key, 'entryUnit', e.target.value)}
                    className="h-9 w-full rounded-md border border-border bg-background px-1 text-center text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    title="录入单位"
                  >
                    {(item.units || []).map(u => <option key={u.unitName} value={u.unitName}>{u.unitName}</option>)}
                  </select>
                ) : (
                  <span className="text-muted-body">{item.unit || '—'}</span>
                )}
              </td>

              <td className="py-2.5 pr-2">
                <Input
                  type="number" min="1" step="1" placeholder="数量"
                  value={item.quantity}
                  ref={(el: HTMLInputElement | null) => { if (el) quantityRefs.current.set(item._key, el); else quantityRefs.current.delete(item._key) }}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateItem(item._key, 'quantity', parsePositiveInteger(e.target.value))}
                  className="text-right text-sm"
                />
                {item.entryUnit && item.entryUnit !== item.unit && (
                  <div className="mt-0.5 text-right text-[11px] text-muted-foreground tabular-nums">= {baseQtyOf(item)} {item.unit}</div>
                )}
              </td>

              <td className="py-2.5">
                <Input
                  type="number" min="0" step="0.01" placeholder="单价"
                  value={item.unitPrice}
                  disabled={!!priceLoading[item._key]}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateItem(item._key, 'unitPrice', parsePrice(e.target.value))}
                  className={`text-right text-sm ${item.priceSource === 'list' ? 'border-blue-300 bg-blue-50/80' : item.priceSource === 'manual' ? 'border-amber-300 bg-amber-50/70' : ''}`}
                />
              </td>

              <td className="py-2.5 text-right font-medium tabular-nums">
                ¥{(item.quantity * item.unitPrice).toFixed(2)}
              </td>

              <td className="py-2.5 text-center">
                <Button
                  type="button" size="sm" variant="ghost"
                  className="h-8 w-9 p-0 text-muted-foreground hover:text-destructive"
                  onClick={() => removeItem(item._key)}
                >✕</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
