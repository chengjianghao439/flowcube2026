import { useState, useEffect } from 'react'
import { toast } from '@/lib/toast'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCreatePurchase } from '@/hooks/usePurchase'
import { useSuppliers } from '@/hooks/useSuppliers'
import { useWarehousesActive } from '@/hooks/useWarehouses'
import ProductFinderModal from '@/components/shared/ProductFinderModal'
import type { PurchaseOrderItem } from '@/types/purchase'
import type { ProductFinderResult } from '@/types/products'

interface Props { open: boolean; onClose: () => void }

interface DraftItem extends Omit<PurchaseOrderItem, 'id' | 'amount'> {
  _key: number
}

export default function PurchaseFormDialog({ open, onClose }: Props) {
  const create = useCreatePurchase()
  const { data: suppliers } = useSuppliers({ page: 1, pageSize: 200, keyword: '' })
  const { data: warehouses } = useWarehousesActive()

  const [supplierId,   setSupplierId]   = useState('')
  const [warehouseId,  setWarehouseId]  = useState('')
  const [expectedDate, setExpectedDate] = useState('')
  const [remark,       setRemark]       = useState('')
  const [items,        setItems]        = useState<DraftItem[]>([])
  const [counter,      setCounter]      = useState(0)

  // ProductFinder 状态
  const [finderOpen,    setFinderOpen]    = useState(false)
  const [finderItemKey, setFinderItemKey] = useState<number | null>(null)

  useEffect(() => {
    if (!open) {
      setSupplierId(''); setWarehouseId(''); setExpectedDate(''); setRemark(''); setItems([])
      setFinderOpen(false); setFinderItemKey(null)
    }
  }, [open])

  const addItem = () => {
    setCounter(c => c + 1)
    setItems(p => [...p, { _key: counter, productId: 0, productCode: '', productName: '', unit: '', quantity: 1, unitPrice: 0, remark: '' }])
  }
  const removeItem = (k: number) => setItems(p => p.filter(i => i._key !== k))
  const updateItem = (k: number, field: string, val: string | number) =>
    setItems(p => p.map(i => i._key === k ? { ...i, [field]: val } : i))

  function openFinder(k: number) {
    setFinderItemKey(k)
    setFinderOpen(true)
  }

  function handleFinderConfirm(product: ProductFinderResult) {
    if (finderItemKey === null) return
    const k = finderItemKey
    setItems(prev => prev.map(i =>
      i._key === k
        ? { ...i, productId: product.id, productCode: product.code, productName: product.name, unit: product.unit }
        : i
    ))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const sup = suppliers?.list.find(s => String(s.id) === supplierId)
    const wh  = warehouses?.find(w => String(w.id) === warehouseId)
    if (!sup || !wh) { toast.warning('请选择供应商和仓库'); return }
    if (!items.length) { toast.warning('请添加至少一条明细'); return }
    if (items.find(i => !i.productId || i.quantity <= 0)) { toast.warning('请完整填写所有明细（商品、数量）'); return }
    await create.mutateAsync({
      supplierId: sup.id, supplierName: sup.name,
      warehouseId: wh.id, warehouseName: wh.name,
      expectedDate: expectedDate || undefined, remark: remark || undefined,
      items: items.map(({ _key, ...rest }) => rest),
    })
    onClose()
  }

  const total = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)
  const selectedWarehouseId = warehouseId ? +warehouseId : null

  return (
    <>
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>新建采购单</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>供应商 *</Label>
                <select className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring" value={supplierId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSupplierId(e.target.value)} required>
                  <option value="">请选择</option>
                  {suppliers?.list.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label>入库仓库 *</Label>
                <select className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring" value={warehouseId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setWarehouseId(e.target.value)} required>
                  <option value="">请选择</option>
                  {warehouses?.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label>预计到货日期</Label>
                <Input type="date" value={expectedDate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setExpectedDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>备注</Label>
                <Input value={remark} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRemark(e.target.value)} />
              </div>
            </div>

            {/* 采购明细 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-base font-semibold">采购明细</Label>
                <Button type="button" size="sm" variant="outline" onClick={addItem}>+ 添加行</Button>
              </div>
              {items.length === 0 && <p className="text-sm text-muted-foreground text-center py-4 border rounded">暂无明细，点击添加行</p>}
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
                  <div className="col-span-2">
                    <Input type="number" min="0" step="0.01" placeholder="单价" value={item.unitPrice} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateItem(item._key, 'unitPrice', +e.target.value)} className="text-sm" />
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
              <Button type="submit" disabled={create.isPending}>{create.isPending ? '提交中...' : '创建采购单'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 商品选择中心（传入仓库ID以展示当前库存） */}
      <ProductFinderModal
        open={finderOpen}
        warehouseId={selectedWarehouseId}
        onConfirm={handleFinderConfirm}
        onClose={() => { setFinderOpen(false); setFinderItemKey(null) }}
      />
    </>
  )
}
