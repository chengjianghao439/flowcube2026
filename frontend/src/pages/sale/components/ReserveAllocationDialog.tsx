import { ProductIdentityCells, ProductIdentityHeaders } from '@/components/shared/ProductIdentityCells'
import { useEffect, useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { WarehouseSelect } from '@/components/shared/WarehouseSelect'
import { Loader2, AlertTriangle, Boxes, PackageSearch, Warehouse } from 'lucide-react'
import { clampAllocationQty, isAllocationQtyValid } from './saleAllocation'
import { cn } from '@/lib/utils'
import { summarizeSaleQuantities } from '@/lib/salePresentation'
import { useSaleReservePreview, useReserveSale } from '@/hooks/useSale'
import { ApiClientError } from '@/api/client'
import type { StockShortageItem } from './StockShortageDialog'

interface Props {
  open: boolean
  orderId: number | null
  onClose: () => void
  /** 提交时后端仍判定库存不足（并发占用）：交给调用方复用现有 StockShortageDialog 展示 */
  onShortage: (orderId: number, shortages: StockShortageItem[]) => void
}

type RowState = { checked: boolean; warehouseId: number; warehouseName: string; qty: number }

const money = (n: number) => `¥${Number(n).toFixed(2)}`

/**
 * 产品占库弹窗：按产品勾选 + 按数量指定本次占多少。
 * - 每行可勾选（是否占该行），勾选后填「本次占库数量」（默认 = 未占余量）。
 * - 支持从草稿/部分占库/已占库三种状态打开（补占）。
 * - 提交只把「勾选且 qty>0」的行传给后端 reserve。
 */
export default function ReserveAllocationDialog({ open, orderId, onClose, onShortage }: Props) {
  const { data: preview, isLoading } = useSaleReservePreview(orderId ?? 0, open)
  const reserve = useReserveSale()
  const [rows, setRows] = useState<Record<number, RowState>>({})

  useEffect(() => {
    if (!preview) return
    setRows(Object.fromEntries(
      preview.items.map(i => [i.itemId, {
        checked: i.remainToReserve > 0,
        warehouseId: i.currentWarehouseId,
        warehouseName: i.currentWarehouseName,
        qty: clampAllocationQty(i.remainToReserve, i.quantity),
      }]),
    ))
  }, [preview])

  const items = useMemo(() => preview?.items ?? [], [preview])
  const credit = preview?.credit ?? null

  const selectedRows = useMemo(
    () => items.filter(i => rows[i.itemId]?.checked && (rows[i.itemId]?.qty ?? 0) > 0),
    [items, rows],
  )
  const quantityGroups = summarizeSaleQuantities(items)
  const orderQty = quantityGroups.map(q => `${q.ordered} ${q.unit}`).join(' / ') || '—'
  const reservedQty = quantityGroups.map(q => `${q.reserved} ${q.unit}`).join(' / ') || '—'
  const remainingQty = summarizeSaleQuantities(items.map(i => ({ ...i, quantity: i.remainToReserve }))).map(q => `${q.ordered} ${q.unit}`).join(' / ') || '—'
  const selectedQty = summarizeSaleQuantities(selectedRows.map(i => ({ ...i, quantity: rows[i.itemId]?.qty ?? 0 }))).map(q => `${q.ordered} ${q.unit}`).join(' / ') || '—'


  const availableFor = (itemId: number, warehouseId: number) =>
    items.find(i => i.itemId === itemId)?.warehouses.find(w => w.warehouseId === warehouseId)?.available ?? 0
  const expectedFor = (itemId: number, warehouseId: number) =>
    items.find(i => i.itemId === itemId)?.warehouses.find(w => w.warehouseId === warehouseId)?.expected ?? 0
  const physicalFor = (itemId: number, warehouseId: number) =>
    items.find(i => i.itemId === itemId)?.warehouses.find(w => w.warehouseId === warehouseId)?.quantity ?? 0
  const reservedFor = (itemId: number, warehouseId: number) =>
    items.find(i => i.itemId === itemId)?.warehouses.find(w => w.warehouseId === warehouseId)?.reserved ?? 0

  const shortRows = selectedRows.filter(i => {
    const st = rows[i.itemId]
    return !isAllocationQtyValid(st?.qty ?? 0, Math.min(i.remainToReserve, availableFor(i.itemId, st.warehouseId)))
  })

  function setRow(itemId: number, patch: Partial<RowState>) {
    setRows(prev => ({ ...prev, [itemId]: { ...prev[itemId], ...patch } }))
  }

  function toggleAll(checked: boolean) {
    setRows(Object.fromEntries(
      items.map(i => [i.itemId, {
        checked: checked && i.remainToReserve > 0,
        warehouseId: i.currentWarehouseId,
        warehouseName: i.currentWarehouseName,
        qty: clampAllocationQty(i.remainToReserve, i.quantity),
      }]),
    ))
  }

  const reservableItems = items.filter(i => i.remainToReserve > 0)
  const allChecked = reservableItems.length > 0 && reservableItems.every(i => rows[i.itemId]?.checked)

  function handleConfirm() {
    if (!orderId) return
    const payload = selectedRows.map(i => {
      const st = rows[i.itemId]
      return {
        id: i.itemId,
        warehouseId: st.warehouseId,
        warehouseName: st.warehouseName,
        qty: st.qty,
      }
    })
    reserve.mutate({ id: orderId, items: payload }, {
      onSuccess: onClose,
      onError: (e: unknown) => {
        if (e instanceof ApiClientError && e.code === 'STOCK_SHORTAGE') {
          const shortages = (e.data as { shortages?: StockShortageItem[] } | null)?.shortages ?? []
          onShortage(orderId, shortages)
          onClose()
        }
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="flex max-h-[88vh] w-[min(96vw,1180px)] max-w-none flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-4 pr-12">
          <DialogTitle className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><Boxes className="h-5 w-5" /></span>
            <span>
              <span className="block text-base">占用库存</span>
              <span className="mt-0.5 block text-xs font-normal text-muted-foreground">核对商品身份，按明细选择发货仓库和本次占库数量</span>
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 border-b border-border bg-muted/20 sm:grid-cols-4">
          {[
            ['商品明细', `${items.length} 行`],
            ['订单总量', String(orderQty)],
            ['已占数量', String(reservedQty)],
            ['待占数量', String(remainingQty)],
          ].map(([label, value]) => (
            <div key={label} className="border-r border-border px-5 py-2.5 last:border-r-0">
              <div className="text-[11px] text-muted-foreground">{label}</div>
              <div className="mt-0.5 text-sm font-semibold tabular-nums">{value}</div>
            </div>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {credit?.willExceed && (
            <p className="mb-4 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2.5 text-sm text-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <span>
                客户授信将超额：额度 {money(credit.creditLimit)}，已用 {money(credit.used)}，本单 {money(credit.thisOrder)}，超出约 {money(credit.overAmount)}。
                占库时若无放行权限将被拦截，可先发起{' '}
                <a href="#/credit-overrides" className="font-medium text-primary underline underline-offset-2">超额放行申请</a>。
              </span>
            </p>
          )}

          {isLoading && (
            <div className="flex h-56 items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />加载商品与库存信息…
            </div>
          )}

          {!isLoading && (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[1560px] text-sm">
                <thead className="sticky top-0 z-[1] bg-muted text-xs text-muted-foreground">
                  <tr>
                    <th className="w-12 px-4 py-3">
                      <input type="checkbox" checked={allChecked} onChange={e => toggleAll(e.target.checked)} aria-label="全选可占商品" />
                    </th>
                    <ProductIdentityHeaders /><th className="min-w-20 px-3 py-3 text-left">单位</th>
                    <th className="w-44 px-3 py-3 text-left">订购情况</th>
                    <th className="w-52 px-3 py-3 text-left">发货仓库</th>
                    <th className="w-36 px-3 py-3 text-left">本次占库</th>
                    <th className="w-40 px-4 py-3 text-right">库存参考</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => {
                    const st = rows[item.itemId] ?? { checked: false, warehouseId: item.currentWarehouseId, warehouseName: item.currentWarehouseName, qty: item.remainToReserve }
                    const available = availableFor(item.itemId, st.warehouseId)
                    const expected = expectedFor(item.itemId, st.warehouseId)
                    const physical = physicalFor(item.itemId, st.warehouseId)
                    const warehouseReserved = reservedFor(item.itemId, st.warehouseId)
                    const short = st.checked && available < (st.qty ?? 0)
                    const fullyReserved = item.remainToReserve <= 0
                    return (
                      <tr key={item.itemId} className={cn('border-t align-top transition-colors hover:bg-muted/15', !st.checked && 'bg-muted/[0.08]', fullyReserved && 'opacity-60')}>
                        <td className="px-4 py-4 text-center">
                          <input type="checkbox" checked={!!st.checked} disabled={fullyReserved} onChange={e => setRow(item.itemId, { checked: e.target.checked })} aria-label={`选择 ${item.productName} ${item.spec || ''} ${item.color || ''}`} />
                        </td>
                        <ProductIdentityCells product={item} /><td className="px-3 py-3">{item.unit || '—'}</td>
                        <td className="px-3 py-4">
                          <div className="grid grid-cols-3 gap-2 text-center">
                            <div><div className="text-[11px] text-muted-foreground">需求</div><div className="mt-1 font-semibold tabular-nums">{item.quantity}</div></div>
                            <div><div className="text-[11px] text-muted-foreground">已占</div><div className="mt-1 font-semibold tabular-nums">{item.reservedQty}</div></div>
                            <div><div className="text-[11px] text-muted-foreground">待占</div><div className="mt-1 font-semibold tabular-nums text-primary">{item.remainToReserve}</div></div>
                          </div>

                        </td>
                        <td className="px-3 py-4">
                          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground"><Warehouse className="h-3.5 w-3.5" />选择库存所在仓库</div>
                          <WarehouseSelect value={st.warehouseId} onChange={(id, name) => { if (id == null) return; setRow(item.itemId, { warehouseId: id, warehouseName: name }) }} className="h-9 text-sm" disabled={!st.checked} />
                        </td>
                        <td className="px-3 py-4">
                          <div className="mb-1.5 text-[11px] text-muted-foreground">最多可占 {item.remainToReserve} {item.unit}</div>
                          <Input aria-label={`${item.productName}本次占库数量`} type="number" step={0.0001} min={0} max={item.remainToReserve} value={st.qty ?? 0} disabled={!st.checked} onChange={e => setRow(item.itemId, { qty: Number(e.target.value) })} className="h-9 text-right text-sm font-semibold tabular-nums" />
                        </td>
                        <td className="px-4 py-4 text-right">
                          <div className={cn('text-base font-semibold tabular-nums', short && 'text-destructive')}>{available} <span className="text-xs font-normal">{item.unit}</span></div>
                          <div className="mt-1 text-[11px] text-muted-foreground">可承诺量（ATP）</div>
                          <div className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
                            <div>现货 {physical} · 已占 {warehouseReserved}</div>
                            <div>预计到货 {expected}</div>
                          </div>
                          {st.checked && <div className={cn('mt-2 text-xs tabular-nums', short ? 'text-destructive' : 'text-muted-foreground')}>占后剩余 {available - (st.qty ?? 0)}</div>}
                        </td>
                      </tr>
                    )
                  })}
                  {!items.length && (
                    <tr><td colSpan={11} className="px-4 py-16 text-center text-muted-foreground"><PackageSearch className="mx-auto mb-2 h-8 w-8 opacity-35" />没有可占用库存的商品明细</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-border bg-muted/20 px-5 py-3.5 sm:items-center sm:justify-between">
          <div className="mr-auto text-sm">
            {shortRows.length > 0 ? (
              <span className="inline-flex items-center gap-1.5 text-destructive"><AlertTriangle className="h-4 w-4" />{shortRows.length} 项数量无效或库存不足，请检查数量（最多四位小数）与仓库</span>
            ) : (
              <span className="text-muted-foreground">已选择 <strong className="text-foreground">{selectedRows.length}</strong> 行明细，占用数量合计 <strong className="text-foreground">{selectedQty}</strong></span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button disabled={isLoading || reserve.isPending || !selectedRows.length || shortRows.length > 0} onClick={handleConfirm}>
              {reserve.isPending ? '占用中…' : `确认占用（${selectedRows.length} 项）`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
