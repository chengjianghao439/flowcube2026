import { useId } from 'react'
import { SaleEntryTable } from './SaleEntryTable'
import type { EntryIssue } from '@/lib/orderEntry'
import { money } from '@/lib/format'
import { ProductIdentityCells, ProductIdentityHeaders } from '@/components/shared/ProductIdentityCells'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { parsePositiveQuantity, parsePrice, type DraftItem } from '../validate'
import { useProductQtyPolicies } from '@/hooks/useProductQtyPolicies'
import { qtyStep } from '@/lib/qtyStep'

function canExplainBaseQty(item: DraftItem): boolean {
  const entryUnit = item.entryUnit || item.unit
  if (entryUnit === item.unit) return true
  const rate = Number(item.units?.find(unit => unit.unitName === entryUnit)?.conversionRate)
  return Number.isFinite(rate) && rate > 0
}

export function SaleOrderItemsTable({
  compact = false, issues = [], lockedIdentity = false, readEnabled = true, quantityRead, items, invalidItemKeys, quantityRefs, priceLoading, priceErrors = {},
  setFinderItemKey, setFinderOpen, updateItem, removeItem,
}: {
  /** 仅销售样板启用；默认保留其他录入入口的现有布局。 */
  compact?: boolean
  issues?: EntryIssue[]
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
  const fieldId = useId()
  // 「只能整数」的商品把数量框的 step 切成 1（迁移 254）；真正的拦截在服务端
  const allowDecimalOf = useProductQtyPolicies(readEnabled ? items.map(item => item.productId) : [], quantityRead)
  return (
    <div className={cn('overflow-x-auto', !compact && 'rounded-lg border border-border')}>
      <TableShell compact={compact}>
        <tbody>
          {items.map(item => {
            const quantityIssue = compact ? issues.find(issue => issue.itemKey === item._key && issue.target === `item-${item._key}-quantity`) : undefined
            const priceIssue = compact ? issues.find(issue => issue.itemKey === item._key && issue.target === `item-${item._key}-price`) : undefined
            const priceError = priceErrors[item._key]
            const showPriceIssue = priceIssue && (!priceError || !(priceIssue.message === priceError || priceIssue.message.endsWith(`：${priceError}`)))
            const quantityErrorId = `${fieldId}-${item._key}-quantity-error`
            const priceErrorId = `${fieldId}-${item._key}-price-error`
            const productButton = <button
              type="button" disabled={lockedIdentity}
              data-entry-field={`item-${item._key}-product`}
              onClick={() => { setFinderItemKey(item._key); setFinderOpen(true) }}
              onDoubleClick={() => { setFinderOpen(false); setFinderItemKey(null); navigate('/products') }}
              className={cn('block w-full rounded-md text-left text-sm transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', compact ? 'px-1 py-1' : 'overflow-hidden px-2 py-1.5', invalidItemKeys.has(item._key) && 'border-destructive/60 bg-destructive/5')}
            >
              {item.productName ? <>
                <span className={cn('break-words font-medium', compact && 'block leading-5')}>
                  {compact && <span className="mr-2 font-mono text-xs font-normal text-muted-foreground">{item.productCode}</span>}
                  {item.productName}
                </span>
                {compact && (item.spec || item.color || item.articleNumber) && <span className="mt-0.5 block break-words text-xs leading-5 text-muted-foreground">
                  {[item.spec && `型号 ${item.spec}`, item.color && `颜色 ${item.color}`, item.articleNumber && `供应商型号 ${item.articleNumber}`].filter(Boolean).join(' · ')}
                </span>}
              </> : <span className="text-muted-foreground">点击选择商品…</span>}
            </button>
            const unitCell = <td className={compact ? 'align-top' : 'py-2.5 text-center'}>
              {(item.units && item.units.filter(u => !u.isBase).length > 0) ? <select
                disabled={lockedIdentity}
                value={item.entryUnit || item.unit}
                onChange={e => updateItem(item._key, 'entryUnit', e.target.value)}
                className="h-9 w-full rounded-md border border-border bg-background px-1 text-center text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                title="录入单位" aria-label={`${item.productName || '商品'}录入单位`}
              >
                {(item.units || []).map(u => <option key={u.unitName} value={u.unitName}>{u.unitName}</option>)}
              </select> : <span className={cn('text-muted-body', compact && 'block py-2')}>{item.entryUnit || item.unit || '—'}</span>}
              {item.productId > 0 && !canExplainBaseQty(item) && <p role="status" className="mt-1 text-xs text-destructive-ink">换算待确认</p>}
            </td>
            const quantityCell = <td className="px-3 py-3 align-top">
              <Input quantity
                data-entry-input data-entry-field={`item-${item._key}-quantity`} aria-invalid={!!quantityIssue || (invalidItemKeys.has(item._key) && (!Number.isFinite(item.quantity) || item.quantity <= 0))}
                aria-describedby={quantityIssue ? quantityErrorId : undefined}
                aria-label={`${item.productName || '商品'}数量`}
                type="number" min="0.01" step={qtyStep(allowDecimalOf(item.productId))} placeholder="数量"
                value={item.quantity}
                ref={(el: HTMLInputElement | null) => { if (el) quantityRefs.current.set(item._key, el); else quantityRefs.current.delete(item._key) }}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateItem(item._key, 'quantity', parsePositiveQuantity(e.target.value))}
                className="h-9 text-right text-sm tabular-nums"
              />
              {quantityIssue && <p id={quantityErrorId} role="alert" className="mt-1 text-xs leading-5 text-destructive-ink">{quantityIssue.message}</p>}
            </td>
            return <tr key={item._key} className="border-b border-border/40 transition-colors hover:bg-muted/20">
              {compact ? <td className="align-top">{productButton}</td> : <ProductIdentityCells product={item} nameContent={productButton} />}
              {compact ? <>{quantityCell}{unitCell}</> : <>{unitCell}{quantityCell}</>}
              <td className="px-3 py-3 align-top">
                <Input
                  data-entry-input data-entry-field={`item-${item._key}-price`} aria-invalid={!!priceIssue || !!priceErrors[item._key] || (invalidItemKeys.has(item._key) && (!Number.isFinite(item.unitPrice) || item.unitPrice <= 0))}
                  aria-label={`${item.productName || '商品'}单价`}
                  aria-describedby={compact && (priceError || priceIssue) ? priceErrorId : undefined}
                  type="number" min="0" step="0.01" placeholder="单价"
                  value={item.unitPrice}
                  aria-busy={!!priceLoading[item._key]}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateItem(item._key, 'unitPrice', parsePrice(e.target.value))}
                  className="h-9 text-right text-sm tabular-nums"
                />
                {priceLoading[item._key] && <p role="status" className="mt-1 text-right text-[11px] text-muted-foreground">正在获取价格…</p>}
                {compact ? (priceError || showPriceIssue) && <div id={priceErrorId} role="alert" className="mt-1 text-xs leading-5 text-destructive-ink">
                  {showPriceIssue && <p>{priceIssue.message}</p>}
                  {priceError && <><p>{priceError}</p><button type="button" className="mt-1 underline" onClick={() => updateItem(item._key, 'unitPrice', item.unitPrice)}>确认当前单价</button></>}
                </div> : priceError && <div className="mt-1 text-xs text-destructive-ink"><p>{priceError}</p><button type="button" className="mt-1 underline" onClick={() => updateItem(item._key, 'unitPrice', item.unitPrice)}>确认当前单价</button></div>}
              </td>
              <td className={cn('py-2.5 text-right font-medium tabular-nums', compact && 'align-top')}>
                <span className={cn(compact && 'block py-1.5')}>{money(item.quantity * item.unitPrice)}</span>
              </td>
              <td className={cn('py-2.5 text-center', compact && 'align-top')}>
                <Input aria-label={`${item.productName || '商品'}备注`} maxLength={200} value={item.remark} placeholder="选填"
                  onChange={event => updateItem(item._key, 'remark', event.target.value)} className="h-9 w-full text-sm" />
              </td>
              <td className={cn('py-2.5 text-center', compact && 'align-top')}>
                <Button type="button" size="sm" variant="ghost" className="h-8 w-9 p-0 text-muted-foreground hover:text-destructive-ink"
                  disabled={lockedIdentity} onClick={() => removeItem(item._key)} aria-label="删除商品行"
                ><Trash2 className="h-4 w-4" /></Button>
              </td>
            </tr>
          })}
        </tbody>
      </TableShell>
    </div>
  )
}

function TableShell({ compact, children }: { compact: boolean; children: React.ReactNode }) {
  if (compact) return <SaleEntryTable>{children}</SaleEntryTable>
  return <table className="w-full min-w-[1320px] text-sm">
    <thead className="data-table-header"><tr className="border-b text-table-head">
      <ProductIdentityHeaders />
      <th className="w-16 px-2 py-2.5 text-center">单位</th>
      <th className="w-28 px-3 py-2.5 text-right">数量</th>
      <th className="w-32 px-3 py-2.5 text-right">单价 (¥)</th>
      <th className="w-32 px-3 py-2.5 text-right">金额</th>
      <th className="w-44 px-3 py-2.5 text-left">备注</th>
      <th className="w-10 px-2 py-2.5" />
    </tr></thead>
    {children}
  </table>
}
