import { useState, useEffect, useCallback } from 'react'
import { toast } from '@/lib/toast'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCreateSale } from '@/hooks/useSale'
import { useCustomersActive } from '@/hooks/useCustomers'
import { useWarehousesActive } from '@/hooks/useWarehouses'
import { getCustomerPriceApi } from '@/api/price-lists'
import ProductFinderModal from '@/components/shared/ProductFinderModal'
import type { SaleOrderItem } from '@/types/sale'
import type { ProductFinderResult } from '@/types/products'

interface Props { open: boolean; onClose: () => void }
interface DraftItem extends Omit<SaleOrderItem, 'id' | 'amount'> { _key: number; priceSource?: 'list' | 'default' | 'manual' }

export default function SaleFormDialog({ open, onClose }: Props) {
  const create = useCreateSale()
  const { data: customers } = useCustomersActive()
  const { data: warehouses } = useWarehousesActive()

  const [customerId,  setCustomerId]  = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [saleDate,    setSaleDate]    = useState('')
  const [remark,      setRemark]      = useState('')
  const [items,       setItems]       = useState<DraftItem[]>([])
  const [counter,     setCounter]     = useState(0)
  const [priceLoading, setPriceLoading] = useState<Record<number, boolean>>({})

  // ProductFinder 状态：记录当前正在为哪一行选品
  const [finderOpen,    setFinderOpen]    = useState(false)
  const [finderItemKey, setFinderItemKey] = useState<number | null>(null)

  useEffect(() => {
    if (!open) {
      setCustomerId(''); setWarehouseId(''); setSaleDate(''); setRemark(''); setItems([])
      setFinderOpen(false); setFinderItemKey(null)
    }
  }, [open])

  // 切换客户时重新查询所有已选商品的专属价格
  const handleCustomerChange = useCallback(async (cid: string) => {
    setCustomerId(cid)
    if (!cid || !items.length) return
    for (const item of items) {
      if (!item.productId) continue
      try {
        const r = await getCustomerPriceApi(+cid, item.productId)
        if (r.data.data?.salePrice !== undefined) {
          setItems(prev => prev.map(i =>
            i._key === item._key ? { ...i, unitPrice: r.data.data!.salePrice, priceSource: 'list' } : i
          ))
        }
      } catch (_) {}
    }
  }, [items])

  const addItem = () => {
    setCounter(c => c + 1)
    setItems(p => [...p, { _key: counter, productId: 0, productCode: '', productName: '', unit: '', quantity: 1, unitPrice: 0, remark: '', priceSource: 'default' }])
  }
  const removeItem  = (k: number) => setItems(p => p.filter(i => i._key !== k))
  const updateItem  = (k: number, field: string, val: string | number) =>
    setItems(p => p.map(i => i._key === k ? { ...i, [field]: val, priceSource: field === 'unitPrice' ? 'manual' : i.priceSource } : i))

  // 打开 Finder：记录目标行
  function openFinder(k: number) {
    setFinderItemKey(k)
    setFinderOpen(true)
  }

  // Finder 确认回调
  async function handleFinderConfirm(product: ProductFinderResult) {
    if (finderItemKey === null) return
    const k = finderItemKey

    setItems(prev => prev.map(i =>
      i._key === k
        ? { ...i, productId: product.id, productCode: product.code, productName: product.name, unit: product.unit, unitPrice: product.salePrice ?? 0, priceSource: 'default' }
        : i
    ))

    // 若已选客户，查询专属价格
    if (customerId) {
      setPriceLoading(prev => ({ ...prev, [k]: true }))
      try {
        const r = await getCustomerPriceApi(+customerId, product.id)
        if (r.data.data?.salePrice !== undefined) {
          setItems(prev => prev.map(i =>
            i._key === k ? { ...i, unitPrice: r.data.data!.salePrice, priceSource: 'list' } : i
          ))
        }
      } catch (_) {}
      setPriceLoading(prev => ({ ...prev, [k]: false }))
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const cust = customers?.find(c => String(c.id) === customerId)
    const wh   = warehouses?.find(w => String(w.id) === warehouseId)
    if (!cust || !wh) { toast.warning('请选择客户和仓库'); return }
    if (!items.length) { toast.warning('请添加至少一条明细'); return }
    if (items.find(i => !i.productId || i.quantity <= 0)) { toast.warning('请完整填写所有明细'); return }
    await create.mutateAsync({
      customerId: cust.id, customerName: cust.name,
      warehouseId: wh.id, warehouseName: wh.name,
      saleDate: saleDate || undefined, remark: remark || undefined,
      items: items.map(({ _key, priceSource, ...r }) => r),
    })
    onClose()
  }

  const total = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)
  const selectedWarehouseId = warehouseId ? +warehouseId : null

  return (
    <>
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>新建销售单</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>客户 *</Label>
                <Select value={customerId || '__none__'} onValueChange={v => void handleCustomerChange(v === '__none__' ? '' : v)}>
                  <SelectTrigger className="h-10 w-full">
              <SelectValue placeholder="请选择" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">请选择</SelectItem>
                    {customers?.map(c => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>出库仓库 *</Label>
                <Select value={warehouseId || '__none__'} onValueChange={v => setWarehouseId(v === '__none__' ? '' : v)}>
                  <SelectTrigger className="h-10 w-full">
                    <SelectValue placeholder="请选择" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">请选择</SelectItem>
                    {warehouses?.map(w => (
                      <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>销售日期</Label>
                <Input type="date" value={saleDate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSaleDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>备注</Label>
                <Input value={remark} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRemark(e.target.value)} />
              </div>
            </div>

            {customerId && customers?.find(c => String(c.id) === customerId) && (
              <div className="flex items-center gap-2 text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-lg px-3 py-2">
                <span>💡</span>
                <span>已选择客户价格等级，商品价格将自动带入对应的 A / B / C / D 价格（如有）。</span>
              </div>
            )}

            {/* 销售明细 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-base font-semibold">销售明细</Label>
                <Button type="button" size="sm" variant="outline" onClick={addItem}>+ 添加行</Button>
              </div>
              {items.length === 0 && <p className="text-sm text-muted-foreground text-center py-4 border rounded">暂无明细</p>}
              {items.map(item => (
                <div key={item._key} className="grid grid-cols-12 gap-2 mb-2 items-center">
                  {/* 商品选择按钮（替代下拉） */}
                  <div className="col-span-4">
                    <button
                      type="button"
                      onClick={() => openFinder(item._key)}
                      className="w-full truncate rounded border border-border bg-background px-2 py-1.5 text-left text-sm transition-colors hover:border-primary hover:bg-muted/30"
                    >
                      {item.productName
                        ? <span className="flex items-center gap-1.5"><span className="font-medium truncate">{item.productName}</span><span className="shrink-0 text-xs text-muted-foreground">({item.productCode})</span></span>
                        : <span className="text-muted-foreground">点击选择商品...</span>}
                    </button>
                  </div>
                  <div className="col-span-1 text-sm text-muted-foreground text-center">{item.unit || '-'}</div>
                  <div className="col-span-2">
                    <Input type="number" min="0.01" step="0.01" placeholder="数量" value={item.quantity} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateItem(item._key, 'quantity', +e.target.value)} className="text-sm" />
                  </div>
                  <div className="col-span-2 relative">
                    <Input
                      type="number" min="0" step="0.01" placeholder="单价"
                      value={item.unitPrice}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateItem(item._key, 'unitPrice', +e.target.value)}
                      className={`text-sm ${item.priceSource === 'list' ? 'border-blue-400 bg-blue-50' : ''}`}
                    />
                    {priceLoading[item._key] && <span className="absolute right-2 top-2 text-xs text-blue-500">查询中...</span>}
                    {item.priceSource === 'list' && !priceLoading[item._key] && (
                      <span className="absolute -top-1 -right-1 text-[9px] bg-blue-500 text-white rounded-full px-1">等级</span>
                    )}
                  </div>
                  <div className="col-span-2 text-sm text-right pr-1">¥{(item.quantity * item.unitPrice).toFixed(2)}</div>
                  <div className="col-span-1 text-right">
                    <Button type="button" size="sm" variant="ghost" className="text-red-500 px-2" onClick={() => removeItem(item._key)}>✕</Button>
                  </div>
                </div>
              ))}
              {items.length > 0 && <div className="text-right text-sm font-semibold mt-2">合计：¥{total.toFixed(2)}</div>}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>取消</Button>
              <Button type="submit" disabled={create.isPending}>{create.isPending ? '提交中...' : '创建销售单'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 商品选择中心 */}
      <ProductFinderModal
        open={finderOpen}
        warehouseId={selectedWarehouseId}
        onConfirm={handleFinderConfirm}
        onClose={() => { setFinderOpen(false); setFinderItemKey(null) }}
      />
    </>
  )
}
