import { commercialWarehouseName } from './warehouseName'
import type { SaleOrder } from '@/types/sale'
import { AppDialog } from '@/components/shared/AppDialog'
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
    <AppDialog
      open
      dialogId="sale-commercial-ship"
      title="安排本次发货"
      defaultWidth={850}
      defaultHeight={560}
      onOpenChange={(open) => {
        if (!open && !locked) onClose()
      }}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={locked} onClick={onClose}>
            返回订单
          </Button>
          <Button
            disabled={locked || !valid}
            onClick={() => onConfirm(chosen.map((g) => ({ groupId: g.id, qty: Number(quantities[g.id]) })))}
          >
            确认发起出库
          </Button>
        </div>
      }
    >
      <div className="space-y-3 p-4">
        <p className="text-sm">
          套必须填写完整整数套数；普通行填写基本量。可选余量来自原订单的发货记录；系统会核对原套组成、仓库及配件预留，缺件不能拆套派发。
        </p>
        {available.map((g) => (
          <div key={g.id} className="flex items-center justify-between gap-4 border-b py-3">
            <div>
              <p>
                {g.kind === 'kit' ? g.kitName : g.components[0]?.productName} ·{' '}
                {commercialWarehouseName(order, g.warehouseId)}
              </p>
              <p className="text-xs text-muted-foreground">
                已确认实发 {g.dispatch!.confirmedShippedQty} · 待完成 {g.dispatch!.outstandingQty} · 可选{' '}
                {g.dispatch!.availableQty}
                {g.kind === 'kit' ? '套' : g.components[0]?.unit}
              </p>
            </div>
            <Input
              quantity
              aria-label={`${g.kind === 'kit' ? g.kitName : g.components[0]?.productName}本批数量`}
              type="number"
              min="0"
              max={g.dispatch!.availableQty}
              step={g.kind === 'kit' ? 1 : 0.01}
              value={quantities[g.id] ?? ''}
              disabled={locked}
              onChange={(e) => onChange({ ...quantities, [g.id]: e.target.value })}
              className="w-32"
            />
          </div>
        ))}
        {!available.length && <p>没有可选发货余量，请核对原批次和实物归还进度。</p>}
      </div>
    </AppDialog>
  )
}
