import { money } from '@/lib/format'
import { ProductIdentityCells, ProductIdentityHeaders } from '@/components/shared/ProductIdentityCells'
import { useNavigate } from 'react-router-dom'
import { Button }  from '@/components/ui/button'
import { Input }   from '@/components/ui/input'
import { Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { baseQtyOf, parsePositiveQuantity, parsePrice, type DraftItem } from '../validate'
import { useProductQtyPolicies } from '@/hooks/useProductQtyPolicies'
import { qtyStep } from '@/lib/qtyStep'

function priceExplanationLabel(item: DraftItem): string {
  const source = item.priceExplanation
  switch (source?.kind) {
    case 'price_list': return `客户价格表：${source.name || '价格表'}`
    case 'price_level': return `客户等级价：${source.name || source.level || '等级名称未提供'}`
    case 'default': return '默认价格'
    case 'manual': return '手动定价'
    case 'saved': return '原订单价（历史来源未留存）'
    default: return '价格来源未提供'
  }
}

function canExplainBaseQty(item: DraftItem): boolean {
  const entryUnit = item.entryUnit || item.unit
  if (entryUnit === item.unit) return true
  const rate = Number(item.units?.find(unit => unit.unitName === entryUnit)?.conversionRate)
  return Number.isFinite(rate) && rate > 0
}

export function SaleOrderItemsTable({
  lockedIdentity = false, readEnabled = true, quantityRead, items, invalidItemKeys, quantityRefs, priceLoading, priceErrors = {},
  setFinderItemKey, setFinderOpen, updateItem, removeItem,
}: {
  lockedIdentity?: boolean
  readEnabled?: boolean
  quantityRead?: Parameters<typeof useProductQtyPolicies>[1]
  items: DraftItem[]
  invalidItemKeys: Set<number>
  quantityRefs: React.MutableRefObject<Map<number, HTMLInputElement>>
  priceLoading: Record<number, boolean>
  priceErrors?: Record<number, string>
  setFinderItemKey: (k: number | null) => void
  setFinderOpen: (v: boolean) => void
  updateItem: (k: number, field: string, val: string | number) => void
  removeItem: (k: number) => void
}) {
  const navigate = useNavigate()
  // 「只能整数」的商品把数量框的 step 切成 1（迁移 254）；真正的拦截在服务端
  const allowDecimalOf = useProductQtyPolicies(readEnabled ? items.map(item => item.productId) : [], quantityRead)
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[1320px] text-sm">
        <thead className="bg-muted/35">
          <tr className="border-b text-table-head">
            <ProductIdentityHeaders />
            <th className="w-16 px-2 py-2.5 text-center">单位</th>
            <th className="w-28 px-3 py-2.5 text-right">数量</th>
            <th className="w-32 px-3 py-2.5 text-right">单价 (¥)</th>
            <th className="w-32 px-3 py-2.5 text-right">金额</th>
            <th className="w-10 px-2 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {items.map(item => (
            <tr key={item._key} className="border-b border-border/40 transition-colors hover:bg-muted/20">
              <ProductIdentityCells product={item} nameContent={<button
                  type="button" disabled={lockedIdentity}
                  data-entry-field={`item-${item._key}-product`}
                  onClick={() => { setFinderItemKey(item._key); setFinderOpen(true) }}
                  onDoubleClick={() => { setFinderOpen(false); setFinderItemKey(null); navigate('/products') }}
                  className={cn('block w-full overflow-hidden rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', invalidItemKeys.has(item._key) && 'border-destructive/60 bg-destructive/5')}
                >
                  {item.productName
                    ? <span className="break-words font-medium">{item.productName}</span>
                    : <span className="text-muted-foreground">点击选择商品…</span>}
                </button>} />

              <td className="py-2.5 text-center">
                {(item.units && item.units.filter(u => !u.isBase).length > 0) ? (
                  <select
                    disabled={lockedIdentity}
                    value={item.entryUnit || item.unit}
                    onChange={e => updateItem(item._key, 'entryUnit', e.target.value)}
                    className="h-9 w-full rounded-md border border-border bg-background px-1 text-center text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    title="录入单位"
                  >
                    {(item.units || []).map(u => <option key={u.unitName} value={u.unitName}>{u.unitName}</option>)}
                  </select>
                ) : (
                  <span className="text-muted-body">{item.entryUnit || item.unit || '—'}</span>
                )}
              </td>

              <td className="px-3 py-3 align-top">
                <Input quantity
                  data-entry-input data-entry-field={`item-${item._key}-quantity`} aria-invalid={invalidItemKeys.has(item._key) && (!Number.isFinite(item.quantity) || item.quantity <= 0)}
                  aria-label={`${item.productName || '商品'}数量`}
                  type="number" min="0.01" step={qtyStep(allowDecimalOf(item.productId))} placeholder="数量"
                  value={item.quantity}
                  ref={(el: HTMLInputElement | null) => { if (el) quantityRefs.current.set(item._key, el); else quantityRefs.current.delete(item._key) }}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateItem(item._key, 'quantity', parsePositiveQuantity(e.target.value))}
                  className="h-9 text-right text-sm tabular-nums"
                />
                {item.productId > 0 && (
                  <div className="mt-0.5 text-right text-[11px] text-muted-foreground tabular-nums">基本数量：{canExplainBaseQty(item) ? `${baseQtyOf(item)} ${item.unit}` : '待确认换算'}</div>
                )}
              </td>

              <td className="px-3 py-3 align-top">
                <Input
                  data-entry-input data-entry-field={`item-${item._key}-price`} aria-invalid={!!priceErrors[item._key] || (invalidItemKeys.has(item._key) && (!Number.isFinite(item.unitPrice) || item.unitPrice <= 0))}
                  aria-label={`${item.productName || '商品'}单价`}
                  type="number" min="0" step="0.01" placeholder="单价"
                  value={item.unitPrice}
                  aria-busy={!!priceLoading[item._key]}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateItem(item._key, 'unitPrice', parsePrice(e.target.value))}
                  className={cn('h-9 text-right text-sm tabular-nums', item.priceSource === 'list' && 'border-primary/35 bg-primary/[0.04]', item.priceSource === 'manual' && 'border-warning/40 bg-warning/[0.05]')}
                />
                {item.productId > 0 && <p className="mt-0.5 text-right text-[11px] text-muted-foreground">每{item.entryUnit || item.unit || '录入单位'}</p>}
                <p className="mt-1 text-right text-[11px] text-muted-foreground">{priceLoading[item._key] ? '正在获取价格…' : priceExplanationLabel(item)}</p>
                {priceErrors[item._key] && <div className="mt-1 text-xs text-destructive-ink"><p>{priceErrors[item._key]}</p><button type="button" className="mt-1 underline" onClick={() => updateItem(item._key, 'unitPrice', item.unitPrice)}>确认当前单价</button></div>}
              </td>

              <td className="py-2.5 text-right font-medium tabular-nums">
                {money(item.quantity * item.unitPrice)}
              </td>

              <td className="py-2.5 text-center">
                <Button
                  type="button" size="sm" variant="ghost"
                  className="h-8 w-9 p-0 text-muted-foreground hover:text-destructive-ink"
                  disabled={lockedIdentity} onClick={() => removeItem(item._key)}
                  aria-label="删除商品行"
                ><Trash2 className="h-4 w-4" /></Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
