import { useId, useRef, useState, useSyncExternalStore } from 'react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ProductFinder } from '@/components/finder'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import { useDisposalHandlingOperation } from '@/hooks/useDisposalHandlingOperation'
import { captureHandlingOwner, handlingOwnerCurrent, handlingConfig, handlingQty, mayHandle, handlingRevision, subscribeHandling } from '@/lib/disposalHandlingRecovery'
import { PERMISSIONS as P } from '@/lib/permission-codes'
import { createRequestKey } from '@/lib/requestKey'
import { getProductApi } from '@/api/products'
import { getWarehousesActiveApi } from '@/api/warehouses'
import { useQuery } from '@tanstack/react-query'
import type { ProductFinderResult } from '@/types/products'
import { HandlingOperationPanel } from './HandlingOperationPanel'
export function HandlingIntentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  useSyncExternalStore(subscribeHandling, handlingRevision)
  const fieldId = useId()
  const [owner] = useState(captureHandlingOwner), active = useActiveWorkspaceTab()
  const latest = useRef({ open, active }); latest.current = { open, active }
  const [intentUuid, setIntentUuid] = useState(() => crypto.randomUUID()), [operationUuid, setOperationUuid] = useState(() => crypto.randomUUID()), [requestKey, setRequestKey] = useState(() => createRequestKey('handling-intent'))
  const identity = `handling-intent:${intentUuid}`
  const current = () => latest.current.open && latest.current.active && handlingOwnerCurrent(owner) && mayHandle(P.INVENTORY_DISPOSAL_CREATE, P.INVENTORY_DISPOSAL_VIEW)
  const write = useDisposalHandlingOperation(identity, open && active, current)
  const editable = () => current() && !write.blocked
  const [product, setProduct] = useState<ProductFinderResult | null>(null), [warehouseId, setWarehouseId] = useState(''), [quantity, setQuantity] = useState(''), [type, setType] = useState<1 | 2 | 3>(1), [finder, setFinder] = useState(false), [finderVisited, setFinderVisited] = useState(false)
  const warehouses = useQuery({ queryKey: ['disposal-handling', 'intent-warehouses', owner, intentUuid], enabled: open && active && editable() && mayHandle(P.WAREHOUSE_VIEW), queryFn: async () => { if (!editable() || !mayHandle(P.WAREHOUSE_VIEW)) throw Error('读取已暂停'); const value = await getWarehousesActiveApi(handlingConfig(owner)); if (!editable()) throw Error('读取归属已变化'); return value } })
  async function save() {
    if (!editable() || !product || !handlingQty(Number(quantity)) || !mayHandle(P.PRODUCT_VIEW)) return
    const currentProduct = await getProductApi(product.id, handlingConfig(owner)).catch(() => null)
    if (!editable() || !currentProduct || !currentProduct.isActive || currentProduct.unit !== product.unit || (currentProduct.allowDecimalQty === false && !Number.isInteger(Number(quantity))) || !warehouses.data?.some(w => w.id === Number(warehouseId))) return
    const body = { intentUuid, operationUuid, productId: product.id, warehouseId: Number(warehouseId), unit: currentProduct.unit, handlingType: type, quantity: Number(quantity) }
    const result = await write.submit({ kind: 'source', draftIdentity: identity, intentUuid, operationUuid, requestKey, action: 'disposal.handling.source.create', path: '/disposals/handling-sources', body })
    if (result && write.canApply(result)) onClose()
  }
  function newIntent() {
    if (!current() || !write.result || write.pending) return
    setProduct(null); setWarehouseId(''); setQuantity(''); setIntentUuid(crypto.randomUUID()); setOperationUuid(crypto.randomUUID()); setRequestKey(createRequestKey('handling-intent'))
  }
  return <>
    <Dialog open={open && active && handlingOwnerCurrent(owner) && mayHandle(P.INVENTORY_DISPOSAL_VIEW)} onOpenChange={next => { if (!next && current()) onClose() }}>
      <DialogContent className="fc-form-dialog sm:max-w-lg">
        <DialogHeader description="仅保存要处理的基本量，不预占或承诺现货；正常目标仍重新核对库存与原审批。">
          <DialogTitle>保存处理意图</DialogTitle>
        </DialogHeader>
        <div className="fc-form-dialog-body desktop-entry-controls space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-product`}>商品</Label>
            <Button id={`${fieldId}-product`} variant="outline" className="w-full justify-start" disabled={!editable() || !mayHandle(P.PRODUCT_VIEW)} onClick={() => {
              if (editable()) { setFinderVisited(true); setFinder(true) }
            }}>{product ? `${product.code} ${product.name}` : '选择意图商品'}</Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-warehouse`}>处理仓库</Label>
              <Select value={warehouseId || '__none__'} disabled={!editable()} onValueChange={value => { if (editable()) setWarehouseId(value === '__none__' ? '' : value) }}>
                <SelectTrigger id={`${fieldId}-warehouse`} className="h-9"><SelectValue placeholder="请选择仓库" /></SelectTrigger>
                <SelectContent><SelectItem value="__none__">请选择仓库</SelectItem>{warehouses.data?.map(w => <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-type`}>处理方式</Label>
              <Select value={String(type)} disabled={!editable()} onValueChange={value => { if (editable()) setType(Number(value) as 1 | 2 | 3) }}>
                <SelectTrigger id={`${fieldId}-type`} className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">正常销售</SelectItem>
                  <SelectItem value="2">采购退货</SelectItem>
                  <SelectItem value="3">重新报废</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-qty`}>意图基本量</Label>
            <div className="flex items-center gap-2">
              <Input id={`${fieldId}-qty`} quantity aria-label="意图基本量" value={quantity} disabled={!editable()} onChange={e => { if (editable()) setQuantity(e.target.value) }} />
              {product?.unit && <span className="shrink-0 text-sm text-muted-foreground">{product.unit}</span>}
            </div>
          </div>
          <HandlingOperationPanel write={write} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { if (current()) onClose() }}>关闭并保留输入</Button>
          {write.result && <Button variant="outline" onClick={newIntent}>另存新意图</Button>}
          <Button disabled={!editable() || !product || !warehouseId || !handlingQty(Number(quantity))} onClick={() => void save()}>保存处理意图</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {finderVisited && <ProductFinder open={finder} readOwner={owner} readGuard={() => editable() && mayHandle(P.PRODUCT_VIEW)} onConfirm={p => { if (editable()) { setProduct(p); setFinder(false) } }} onClose={() => { if (editable()) setFinder(false) }} />}
  </>
}
