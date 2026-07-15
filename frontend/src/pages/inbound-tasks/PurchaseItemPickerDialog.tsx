import { useEffect, useState } from 'react'
import { AppDialog } from '@/components/shared/AppDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useInboundPurchaseCandidates } from '@/hooks/useInboundTasks'
import type { InboundPurchaseCandidate } from '@/types/inbound-tasks'

export interface PickedPurchaseItem {
  item: InboundPurchaseCandidate
  qty: number
}

interface Props {
  open: boolean
  supplierId: number | null
  /** 已选中的明细（key: purchaseItemId），用于重新打开弹窗时预填已选数量 */
  initialSelection: Record<number, PickedPurchaseItem>
  onClose: () => void
  onConfirm: (rows: PickedPurchaseItem[]) => void
}

const GRID_COLS = 'grid-cols-[110px_minmax(220px,1fr)_100px_80px_80px_80px_80px_120px]'

export function PurchaseItemPickerDialog({ open, supplierId, initialSelection, onClose, onConfirm }: Props) {
  const [search, setSearch] = useState('')
  const [keyword, setKeyword] = useState('')
  const [qtyMap, setQtyMap] = useState<Record<number, string>>({})

  const { data: candidates = [], isLoading } = useInboundPurchaseCandidates(open ? supplierId : null, keyword)

  // 每次打开弹窗，用当前已选数量重新初始化草稿，保证重复打开时能看到之前选过的行
  useEffect(() => {
    if (!open) return
    setSearch('')
    setKeyword('')
    const next: Record<number, string> = {}
    for (const [id, entry] of Object.entries(initialSelection)) {
      next[Number(id)] = String(entry.qty)
    }
    setQtyMap(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function setLineQty(purchaseItemId: number, remainingQty: number, raw: string) {
    const value = raw.trim()
    if (!value) {
      setQtyMap(prev => {
        const next = { ...prev }
        delete next[purchaseItemId]
        return next
      })
      return
    }
    const qty = Number(value.replace(/,/g, ''))
    if (!Number.isFinite(qty) || qty < 0 || qty > remainingQty) return
    setQtyMap(prev => ({ ...prev, [purchaseItemId]: String(qty) }))
  }

  const selectedCount = Object.values(qtyMap).filter(v => Number(v) > 0).length

  function handleConfirm() {
    const rows: PickedPurchaseItem[] = candidates
      .map(item => ({ item, qty: Number(qtyMap[item.purchaseItemId] || 0) }))
      .filter(entry => Number.isFinite(entry.qty) && entry.qty > 0)
    onConfirm(rows)
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={v => { if (!v) onClose() }}
      dialogId="inbound-purchase-item-picker"
      title="选择收货商品"
      defaultWidth={1080}
      defaultHeight={620}
      minWidth={860}
      minHeight={420}
      footer={
        <div className="flex w-full items-center justify-between">
          <span className="text-sm text-muted-foreground">已选 {selectedCount} 项</span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button onClick={handleConfirm}>确定</Button>
          </div>
        </div>
      }
    >
      <div className="flex h-full flex-col gap-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <Input
            className="flex-1"
            placeholder="按采购单号 / SKU / 商品名称搜索"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') setKeyword(search.trim())
            }}
          />
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setKeyword(search.trim())}>搜索</Button>
            <Button
              variant="outline"
              onClick={() => {
                setSearch('')
                setKeyword('')
              }}
            >
              清空
            </Button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border">
          <div className={`grid ${GRID_COLS} gap-3 border-b bg-muted/30 px-4 py-3 text-xs font-medium text-muted-foreground`}>
            <span>采购单</span>
            <span>商品</span>
            <span>仓库</span>
            <span className="text-left">订单数量</span>
            <span className="text-left">已收数量</span>
            <span className="text-left">未收数量</span>
            <span className="text-left">单价</span>
            <span className="text-left">本次数量</span>
          </div>

          <div className="flex-1 overflow-auto">
            {!isLoading && candidates.length === 0 && (
              <div className="py-12 text-center text-sm text-muted-foreground">
                暂无可用采购明细
              </div>
            )}

            <div className="divide-y">
              {candidates.map(item => (
                <div key={item.purchaseItemId} className={`grid ${GRID_COLS} gap-3 px-4 py-3 text-sm`}>
                  <div className="text-doc-code">{item.purchaseOrderNo}</div>
                  <div className="min-w-0">
                    <div className="truncate text-xs text-muted-foreground">
                      <span className="font-mono text-doc-code-muted">{item.productCode}</span>
                      {' · 货号 '}{item.articleNumber || '—'}
                      {' · 型号 '}{item.spec || '—'}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-medium text-foreground">{item.productName}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">颜色 {item.color || '—'}（{item.unit ?? '—'}）</span>
                    </div>
                  </div>
                  <div className="text-muted-foreground">{item.warehouseName}</div>
                  <div className="text-left text-muted-foreground">{item.orderedQty}</div>
                  <div className="text-left text-muted-foreground">{item.receivedQty}</div>
                  <div className="text-left font-medium text-foreground">{item.remainingQty}</div>
                  <div className="text-left text-muted-foreground">{item.unitPrice.toFixed(2)}</div>
                  <div>
                    <Input
                      className="text-left"
                      placeholder="0"
                      value={qtyMap[item.purchaseItemId] ?? ''}
                      onChange={e => setLineQty(item.purchaseItemId, item.remainingQty, e.target.value)}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AppDialog>
  )
}
