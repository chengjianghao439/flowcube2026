import { useEffect, useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { WarehouseSelect } from '@/components/shared/WarehouseSelect'
import { Loader2, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
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
        qty: i.remainToReserve,
      }]),
    ))
  }, [preview])

  const items = useMemo(() => preview?.items ?? [], [preview])
  const credit = preview?.credit ?? null

  const selectedRows = useMemo(
    () => items.filter(i => rows[i.itemId]?.checked && (rows[i.itemId]?.qty ?? 0) > 0),
    [items, rows],
  )

  const availableFor = (itemId: number, warehouseId: number) =>
    items.find(i => i.itemId === itemId)?.warehouses.find(w => w.warehouseId === warehouseId)?.available ?? 0
  const expectedFor = (itemId: number, warehouseId: number) =>
    items.find(i => i.itemId === itemId)?.warehouses.find(w => w.warehouseId === warehouseId)?.expected ?? 0

  const shortRows = selectedRows.filter(i => {
    const st = rows[i.itemId]
    return availableFor(i.itemId, st.warehouseId) < (st?.qty ?? 0)
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
        qty: i.remainToReserve,
      }]),
    ))
  }

  const allChecked = items.length > 0 && items.every(i => rows[i.itemId]?.checked)

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
      <DialogContent className="max-w-4xl">
        <DialogHeader><DialogTitle>占用库存 · 按产品选择</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          勾选要占用的商品并填写本次占库数量（默认占满未占余量），不同商品可选不同仓库（分仓发货）。
        </p>

        {credit?.willExceed && (
          <p className="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-sm text-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              客户授信将超额：额度 {money(credit.creditLimit)}，已用 {money(credit.used)}，本单 {money(credit.thisOrder)}，超出约 {money(credit.overAmount)}。
              占库时若无放行权限将被拦截，可先发起{' '}
              <a href="#/credit-overrides" className="underline underline-offset-2">超额放行申请</a>。
            </span>
          </p>
        )}

        {isLoading && (
          <div className="flex h-32 items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />加载中…
          </div>
        )}

        {!isLoading && (
          <div className="max-h-[28rem] overflow-y-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="w-10 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={e => toggleAll(e.target.checked)}
                      aria-label="全选"
                    />
                  </th>
                  <th className="px-2 py-2 text-left">商品</th>
                  <th className="w-20 px-2 py-2 text-right">需求</th>
                  <th className="w-24 px-2 py-2 text-right">已占</th>
                  <th className="w-32 px-2 py-2 text-left">发货仓库</th>
                  <th className="w-28 px-2 py-2 text-right">本次占库量</th>
                  <th className="w-20 px-2 py-2 text-right">可用量</th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => {
                  const st = rows[item.itemId] ?? { checked: false, warehouseId: item.currentWarehouseId, warehouseName: item.currentWarehouseName, qty: item.remainToReserve }
                  const available = availableFor(item.itemId, st.warehouseId)
                  const short = st.checked && available < (st.qty ?? 0)
                  const fullyReserved = item.remainToReserve <= 0
                  return (
                    <tr key={item.itemId} className={cn('border-t', fullyReserved && 'opacity-60')}>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={!!st.checked}
                          disabled={fullyReserved}
                          onChange={e => setRow(item.itemId, { checked: e.target.checked })}
                          aria-label={`选择 ${item.productName}`}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <div className="font-medium">{item.productName}</div>
                        <div className="text-xs text-muted-foreground">
                          {item.productCode}{item.articleNumber ? ` · 货号 ${item.articleNumber}` : ''}{item.spec ? ` · ${item.spec}` : ''}{item.color ? ` · ${item.color}` : ''}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{item.quantity} {item.unit}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{item.reservedQty}</td>
                      <td className="px-2 py-2">
                        <WarehouseSelect
                          value={st.warehouseId}
                          onChange={(id, name) => {
                            if (id == null) return
                            setRow(item.itemId, { warehouseId: id, warehouseName: name })
                          }}
                          className="h-9 text-sm"
                          disabled={!st.checked}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <Input
                          type="number"
                          min={0}
                          max={item.remainToReserve}
                          value={st.qty ?? 0}
                          disabled={!st.checked}
                          onChange={e => setRow(item.itemId, { qty: Number(e.target.value) })}
                          className="h-9 text-sm tabular-nums"
                        />
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums font-medium">
                        <span className="inline-flex items-center gap-1">
                          {short && <AlertTriangle className="h-3.5 w-3.5" />}
                          {available}
                        </span>
                        {(() => { const exp = expectedFor(item.itemId, st.warehouseId); return exp > 0
                          ? <div className="text-xs font-normal text-info">在途 +{exp}</div> : null })()}
                      </td>
                    </tr>
                  )
                })}
                {!items.length && (
                  <tr><td colSpan={7} className="px-2 py-6 text-center text-muted-foreground">没有可占用库存的明细</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {shortRows.length > 0 && (
          <p className="flex items-center gap-1.5 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {shortRows.length} 项商品在所选仓库可用量不足，仍可尝试占用，届时会给出可用量不足的详情
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button disabled={isLoading || reserve.isPending || !selectedRows.length} onClick={handleConfirm}>
            {reserve.isPending ? '占用中…' : `确认占用库存（${selectedRows.length} 项）`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
