import { ReportTable } from '@/components/shared/ReportTable'
import OrdinarySaleRecoveryNotice from './OrdinarySaleRecoveryNotice'
import { ProductIdentitySummary } from '@/components/shared/ProductIdentitySummary'
import { money } from '@/lib/format'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { PackageSearch } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { OrderFieldError } from '@/components/shared/OrderFieldError'
import { clampAllocationQty, isAllocationQtyValid } from './saleAllocation'
import { cn } from '@/lib/utils'
import { summarizeSaleQuantities } from '@/lib/salePresentation'
import { useSaleReservePreview, useReserveSale } from '@/hooks/useSale'
import { qtyStep, roundQuantity } from '@/lib/qtyStep'
import type { ReservePreview } from '@/types/sale'
import { ApiClientError } from '@/api/client'
import type { StockShortageItem } from './StockShortageDialog'

interface Props {
  open: boolean
  orderId: number | null
  onClose: () => void
  /** 提交时后端仍判定库存不足（并发占用）：交给调用方复用现有 StockShortageDialog 展示 */
  onShortage: (orderId: number, shortages: StockShortageItem[]) => void
}

type RowState = { checked: boolean; warehouseId: number; qty: number; qtyEdited?: boolean; qtyError?: string }
type PreviewItem = ReservePreview['items'][number]

function suggestedQuantity(item: PreviewItem, available: number) {
  const limit = Math.min(item.remainToReserve, available)
  return item.allowDecimalQty === false ? Math.max(0, Math.floor(limit + 1e-6)) : clampAllocationQty(limit, item.quantity)
}

function initialRow(item: PreviewItem): RowState {
  const warehouse = item.warehouses.find(w => w.warehouseId === item.currentWarehouseId)
  return {
    checked: item.remainToReserve > 0,
    warehouseId: item.currentWarehouseId,
    qty: suggestedQuantity(item, warehouse?.available ?? 0),
  }
}

/**
 * 产品占库弹窗：按产品勾选 + 按数量指定本次占多少。
 * - 每行可勾选，默认量受所选仓库可承诺量与未占数量限制。
 * - 草稿/部分占库及执行中有未占原需求时可打开，累计已占量不因实发归零。
 * - 提交只把「勾选且 qty>0」的行传给后端 reserve。
 */
export default function ReserveAllocationDialog({ open, orderId, onClose, onShortage }: Props) {
  const { data: preview, isLoading, isFetching, isError, error, refetch } = useSaleReservePreview(orderId ?? 0, open)
  const reserve = useReserveSale(orderId)
  const frozen = reserve.isPending || !!reserve.recovery?.blocked
  const submitting = useRef(false)
  const rowSource = useRef<number | null>(null)
  const [rows, setRows] = useState<Record<number, RowState>>({})
  const readUnavailable = !preview || isLoading || isError

  useEffect(() => { if (!open) rowSource.current = null }, [open])

  useEffect(() => {
    if (!open || !preview || submitting.current || reserve.recovery?.pending) return
    const sameSource = rowSource.current === orderId
    setRows(previous => Object.fromEntries(
      preview.items.map(i => [i.itemId, sameSource && previous[i.itemId] ? previous[i.itemId] : initialRow(i)]),
    ))
    rowSource.current = orderId
  }, [preview, orderId, open, reserve.recovery?.pending])

  const items = useMemo(() => preview?.items ?? [], [preview])
  // 使用服务端返回的当前商品数量规则，服务端仍独立校验。
  const credit = preview?.credit ?? null

  const selectedRows = useMemo(
    () => items.filter(i => rows[i.itemId]?.checked && (rows[i.itemId]?.qty ?? 0) > 0),
    [items, rows],
  )
  const selectedQty = summarizeSaleQuantities(selectedRows.map(i => ({ ...i, quantity: rows[i.itemId].qty })))
    .map(q => `${q.ordered} ${q.unit}`).join(' / ')

  const shortRows = items.filter(item => {
    const row = rows[item.itemId]
    if (!row?.checked) return false
    if (row.qtyError) return true
    if (row.qty === 0) return false
    const available = item.warehouses.find(w => w.warehouseId === row.warehouseId)?.available ?? 0
    return !isAllocationQtyValid(row.qty, Math.min(item.remainToReserve, available), item.allowDecimalQty !== false)
  })
  const invalidItemIds = new Set(shortRows.map(item => item.itemId))

  function setRow(itemId: number, patch: Partial<RowState>) {
    if (submitting.current || frozen) return
    setRows(prev => ({ ...prev, [itemId]: { ...prev[itemId], ...patch } }))
  }

  function toggleAll(checked: boolean) {
    if (submitting.current || frozen) return
    setRows(previous => Object.fromEntries(items.map(item => [item.itemId, {
      ...(previous[item.itemId] ?? initialRow(item)),
      checked: checked && item.remainToReserve > 0,
    }])))
  }

  const reservableItems = items.filter(i => i.remainToReserve > 0)
  const allChecked = reservableItems.length > 0 && reservableItems.every(i => rows[i.itemId]?.checked)

  function handleConfirm() {
    if (!orderId || readUnavailable || isFetching || submitting.current || frozen || !selectedRows.length || shortRows.length > 0) return
    submitting.current = true
    const payload = selectedRows.map(i => {
      const st = rows[i.itemId]
      return {
        id: i.itemId,
        warehouseId: st.warehouseId,
        warehouseName: i.warehouses.find(w => w.warehouseId === st.warehouseId)?.warehouseName ?? i.currentWarehouseName,
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
      onSettled: () => { submitting.current = false },
    })
  }

  function requestClose() {
    if (!submitting.current && !reserve.isPending) onClose()
  }

  const description = isLoading ? <span role="status">加载商品与库存信息…</span>
    : !readUnavailable && credit?.willExceed ? (
      <span className="text-warning-ink">
        客户授信将超额：额度 {money(credit.creditLimit)}，已用 {money(credit.used)}，本单 {money(credit.thisOrder)}，超出约 {money(credit.overAmount)}。
        超额占库须先取得有效批准；原批准失效时可重新发起{' '}
        <a href="#/credit-overrides" className="font-medium text-primary underline underline-offset-2">超额放行申请</a>。
      </span>
    ) : undefined

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) requestClose() }}>
      <DialogContent {...(description ? {} : { 'aria-describedby': undefined })} aria-busy={reserve.isPending}
        onEscapeKeyDown={e => { if (submitting.current || frozen) e.preventDefault() }}
        className="fc-form-dialog max-h-[88vh] w-[min(96vw,1180px)] max-w-none">
        <DialogHeader description={description}>
          <DialogTitle>占用库存</DialogTitle>
        </DialogHeader>

        <div className="shrink-0 px-6 pt-3 empty:hidden">
          <OrdinarySaleRecoveryNotice recovery={reserve.recovery} onConfirmed={onClose} />
        </div>
        <div className="fc-form-dialog-body space-y-3">
          {isError && <QueryErrorState error={error} onRetry={() => { void refetch() }} description="没能加载占库预览，请重试后核对商品和仓库" />}

          {!readUnavailable && (
            <div className="overflow-x-auto rounded-lg border border-border">
              <ReportTable className="w-full min-w-[760px] text-sm">
                <thead data-selection-column className="data-table-header text-xs text-muted-foreground">
                  <tr>
                    <th className="w-10 px-3 py-2">
                      <input type="checkbox" checked={allChecked} disabled={frozen} onChange={e => toggleAll(e.target.checked)} aria-label="全选待占商品" />
                    </th>
                    <th className="w-52 px-3 py-2 text-left">商品</th>
                    <th className="w-18 px-3 py-2 text-left">待占</th>
                    <th className="w-52 px-3 py-2 text-left">发货仓库</th>
                    <th className="w-24 px-3 py-2 text-right">本次占库</th>
                    <th className="w-26 px-3 py-2 text-right">本仓可用</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => {
                    const row = rows[item.itemId] ?? initialRow(item)
                    const warehouse = item.warehouses.find(w => w.warehouseId === row.warehouseId)
                    const available = warehouse?.available ?? 0
                    const pickable = warehouse?.pickableQuantity ?? 0
                    const limit = suggestedQuantity(item, available)
                    const fullyReserved = item.remainToReserve <= 0
                    const hasReservation = item.remainToReserve < item.quantity
                    const invalid = invalidItemIds.has(item.itemId)
                    const noAvailable = !fullyReserved && limit === 0
                    const feedbackId = `reserve-qty-feedback-${item.itemId}`
                    const fieldError = invalid ? row.qtyError || (row.qty < 0
                      ? '占库数量不能为负数'
                      : row.qty > limit ? `本仓最多可占 ${limit} ${item.unit}`
                      : item.allowDecimalQty === false ? '该商品数量只能是整数' : '数量最多保留两位小数') : null
                    return (
                      <tr key={item.itemId} className={cn('border-t align-top transition-colors hover:bg-muted/15', !row.checked && 'bg-muted/[0.08]', fullyReserved && 'opacity-60')}>
                        <td className="px-3 py-3 text-center">
                          <input type="checkbox" checked={row.checked} disabled={frozen || fullyReserved} onChange={e => setRow(item.itemId, { checked: e.target.checked })} aria-label={`选择 ${item.productName} ${item.spec || ''} ${item.color || ''}`} />
                        </td>
                        <td className="px-3 py-3"><ProductIdentitySummary product={item} /></td>
                        <td className="space-y-1 px-3 py-3 tabular-nums">
                          <div className="font-medium">{item.remainToReserve} {item.unit}</div>
                          {item.reservedQty > 0 && <div className="text-xs text-muted-foreground">已占 {item.reservedQty} / {item.quantity}</div>}
                        </td>
                        <td className="px-3 py-3">
                          <Select value={String(row.warehouseId)} disabled={frozen || !row.checked || hasReservation || !item.warehouses.length} onValueChange={value => {
                            const nextWarehouse = item.warehouses.find(w => w.warehouseId === Number(value))
                            if (!nextWarehouse || hasReservation || !row.checked) return
                            setRow(item.itemId, {
                              warehouseId: nextWarehouse.warehouseId,
                              qty: row.qtyEdited ? row.qty : suggestedQuantity(item, nextWarehouse.available),
                            })
                          }}>
                            <SelectTrigger className="h-9 px-2" aria-label={`${item.productName}发货仓库`}><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {!warehouse && <SelectItem value={String(row.warehouseId)} disabled>{item.currentWarehouseName}</SelectItem>}
                              {item.warehouses.map(w => <SelectItem key={w.warehouseId} value={String(w.warehouseId)}>{w.warehouseName}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          {hasReservation && <p className="mt-1 text-xs text-muted-foreground">已有预占，释放后可换仓</p>}
                        </td>
                        <td className="px-3 py-3">
                          <Input quantity aria-label={`${item.productName}本次占库数量`} aria-invalid={invalid || undefined} aria-describedby={invalid || noAvailable ? feedbackId : undefined}
                            type="number" step={qtyStep(item.allowDecimalQty !== false)} min={0} max={limit} value={row.qty} disabled={frozen || !row.checked || fullyReserved}
                            onQuantityError={message => setRow(item.itemId, { qtyError: message ?? undefined })}
                            onChange={e => setRow(item.itemId, { qty: Number(e.target.value), qtyEdited: true })} className="h-8 text-right font-semibold tabular-nums" />
                          <OrderFieldError id={feedbackId}>{fieldError}</OrderFieldError>
                          {!invalid && noAvailable && (
                            <p id={feedbackId} className="mt-1 text-xs text-muted-foreground">本仓暂无可占量</p>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button type="button" variant="link" size="sm" className="h-auto p-0 font-semibold" aria-label={`查看${item.productName}库存参考，本仓可用 ${available} ${item.unit}`}>{available} {item.unit}</Button>
                            </PopoverTrigger>
                            <PopoverContent side="top" align="end" className="w-64 space-y-2 p-3 text-left text-xs" aria-label={`${item.productName}库存参考`}>
                              <dl className="grid grid-cols-2 gap-2">
                                <dt>现货</dt><dd className="text-right">{warehouse?.quantity ?? 0} {item.unit}</dd>
                                <dt>已占</dt><dd className="text-right">{warehouse?.reserved ?? 0} {item.unit}</dd>
                                <dt>预计到货</dt><dd className="text-right">{warehouse?.expected ?? 0} {item.unit}</dd>
                                <dt>当前可拣现货</dt><dd className="text-right">{pickable} {item.unit}</dd>
                                {row.checked && <>
                                  <dt className="border-t pt-2">占后剩余</dt>
                                  <dd className={cn('border-t pt-2 text-right', invalid && 'text-destructive-ink')}>{roundQuantity(available - row.qty)} {item.unit}</dd>
                                </>}
                              </dl>
                              {available > pickable && <p className="text-warning-ink">可承诺量包含预计到货或已被其他作业锁定的库存，可能无法立即拣货。</p>}
                            </PopoverContent>
                          </Popover>
                          {available > pickable && <p className="mt-1 text-xs text-warning-ink">可拣 {pickable}</p>}
                        </td>
                      </tr>
                    )
                  })}
                  {!items.length && (
                    <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground"><PackageSearch className="mx-auto mb-2 h-8 w-8 opacity-35" />没有可占用库存的商品明细</td></tr>
                  )}
                </tbody>
              </ReportTable>
            </div>
          )}
        </div>

        <DialogFooter>
          {!readUnavailable && <div className="mr-auto text-sm text-muted-foreground">
            {shortRows.length > 0 ? <span className="text-destructive-ink">请检查占库数量</span>
              : selectedRows.length > 0 ? <>
                本次占用 <strong className="text-foreground">{selectedQty}</strong>
                {items.length > 1 && <span> · 已选 {selectedRows.length}/{items.length} 项</span>}
              </> : '未选占库明细'}
          </div>}
          <div className="flex gap-2">
            <Button variant="outline" disabled={reserve.isPending} onClick={requestClose}>取消</Button>
            <Button disabled={readUnavailable || isFetching || frozen || !selectedRows.length || shortRows.length > 0} onClick={handleConfirm}>
              {reserve.isPending ? '占用中…' : '确认占用'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
