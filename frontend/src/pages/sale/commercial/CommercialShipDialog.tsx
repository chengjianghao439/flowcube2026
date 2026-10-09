import { commercialWarehouseName } from './warehouseName'
import { commercialUnit } from './commercialDraft'
import type { SaleOrder } from '@/types/sale'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { ProductIdentityCells, ProductIdentityHeaders } from '@/components/shared/ProductIdentityCells'
import { PackageCheck } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
export default function CommercialShipDialog({
  order,
  quantities,
  onChange,
  locked,
  onClose,
  onConfirm
}: {
  order: SaleOrder
  quantities: Record<number, string>
  onChange: (next: Record<number, string>) => void
  locked: boolean
  onClose: () => void
  onConfirm: (groups: { groupId: number; qty: number }[]) => void
}) {
  const available = (order.commercialGroups ?? []).filter((g) => (g.dispatch?.availableQty ?? 0) > 0)
  const chosen = available.filter((g) => Number(quantities[g.id] || 0) > 0)
  const valid =
    chosen.length > 0 &&
    chosen.every(
      (g) =>
        /^\d+(?:\.\d{1,2})?$/.test(quantities[g.id]) &&
        Number(quantities[g.id]) <= g.dispatch!.availableQty &&
        (g.kind !== 'kit' || Number.isSafeInteger(Number(quantities[g.id])))
    )
  return (
    <Dialog open onOpenChange={(open) => {
        if (!open && !locked) onClose()
      }}>
      <DialogContent aria-busy={locked} onEscapeKeyDown={event => { if (locked) event.preventDefault() }} className="flex max-h-[86vh] w-[min(94vw,900px)] max-w-none flex-col overflow-hidden">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><PackageCheck className="h-5 w-5 text-primary" />发起出库</DialogTitle></DialogHeader>
        <DialogDescription className="sr-only">选择本次出库明细与数量</DialogDescription>
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border">
          <table className="w-full min-w-[1560px] text-sm">
            <thead data-selection-column className="sticky top-0 data-table-header text-xs text-muted-foreground"><tr>
              <th className="w-10 px-3 py-2"><input type="checkbox" aria-label="选择全部可出库明细" disabled={locked} checked={available.length > 0 && chosen.length === available.length} onChange={event => onChange({ ...quantities, ...Object.fromEntries(available.map(group => [group.id, event.target.checked ? quantities[group.id] && Number(quantities[group.id]) > 0 ? quantities[group.id] : String(group.dispatch!.availableQty) : '0'])) })} /></th>
              <ProductIdentityHeaders /><th className="min-w-20 px-3 py-3 text-left">单位</th>
              <th className="w-40 px-3 py-2 text-left">发货仓库</th>
              <th className="w-28 px-3 py-2 text-right">可发数量</th>
              <th className="w-36 px-3 py-2 text-right">本次发货</th>
            </tr></thead>
            <tbody>{available.map(g => {
              const name = g.kind === 'kit' ? g.kitName : g.components[0]?.productName
              const identity = g.kind === 'kit' ? g.metadata.kitIdentity : g.components[0]
              const value = quantities[g.id] ?? ''
              const invalid = value !== '' && Number(value) !== 0 && (!/^\d+(?:\.\d{1,2})?$/.test(value) || Number(value) > g.dispatch!.availableQty || (g.kind === 'kit' && !Number.isSafeInteger(Number(value))))
              return <tr key={g.id} className="border-t align-top hover:bg-muted/20">
                <td className="px-3 py-3 text-center"><input type="checkbox" aria-label={`选择 ${name}`} disabled={locked} checked={Number(value) > 0} onChange={event => onChange({ ...quantities, [g.id]: event.target.checked ? String(g.dispatch!.availableQty) : '0' })} /></td>
                <ProductIdentityCells product={{ ...identity, productCode: g.kind === 'kit' ? g.kitCode : g.components[0]?.productCode, productName: name }} />
                <td className="px-3 py-3">{commercialUnit(g)}</td>
                <td className="px-3 py-3">{commercialWarehouseName(order, g.warehouseId)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{g.dispatch!.availableQty} {commercialUnit(g)}<details className="mt-1 text-xs font-normal text-muted-foreground"><summary className="cursor-pointer">发货依据</summary>已确认实发 {g.dispatch!.confirmedShippedQty} · 待完成 {g.dispatch!.outstandingQty}</details></td>
                <td className="px-3 py-3">
            <Input
              quantity
              aria-label={`${g.kind === 'kit' ? g.kitName : g.components[0]?.productName}本批数量`}
              type="number"
              min="0"
              max={g.dispatch!.availableQty}
              step={g.kind === 'kit' ? 1 : 0.01}
              aria-invalid={invalid}
              value={quantities[g.id] ?? ''}
              disabled={locked}
              onChange={(e) => onChange({ ...quantities, [g.id]: e.target.value })}
              className="h-9 text-right tabular-nums"
            />
                {invalid && <p role="alert" className="mt-1 text-xs text-destructive-ink">{g.kind === 'kit' ? '请填写完整整数套数且不超过可发数量' : '数量不得超过可发数量，最多两位小数'}</p>}
                </td>
              </tr>
            })}
            {!available.length && <tr><td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">没有可选发货余量，请核对原批次和实物归还进度。</td></tr>}
            </tbody>
          </table>
        </div>
        <DialogFooter className="sm:items-center sm:justify-between"><span className="mr-auto text-sm text-muted-foreground">已选择 {chosen.length} 项</span><Button variant="outline" disabled={locked} onClick={onClose}>取消</Button><Button disabled={locked || !valid} onClick={() => onConfirm(chosen.map(g => ({ groupId: g.id, qty: Number(quantities[g.id]) })))}>确认发起出库</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
