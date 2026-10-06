import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { getSaleReorderSourceApi } from '@/api/sale'
import { getCustomerApi } from '@/api/customers'
import { getProductApi } from '@/api/products'
import { getCustomerPriceApi } from '@/api/price-lists'
import { getKitApi } from '@/api/kits'
import { useActiveWorkspaceTab } from './useActiveWorkspaceTab'
import { PERMISSIONS } from '@/lib/permission-codes'
import { assertReorderOwner, assertReorderPermission, captureReorderOwner, positiveReorderId, reorderConfig, reorderEpoch, reorderOwnerCurrent, subscribeReorder } from '@/lib/saleReorder'
import type { CurrentReorderSource, CurrentReorderItem, SaleReorderSource } from '@/types/sale-reorder'
const message = (e: unknown) => e instanceof Error ? e.message : '当前资料读取失败，请重新核对'
export function useSaleReorderSource(sourceId: number, model: SaleReorderSource['model']) {
  const [owner] = useState(captureReorderOwner), active = useActiveWorkspaceTab()
  const activeRef = useRef(active)
  activeRef.current = active
  useSyncExternalStore(subscribeReorder, reorderEpoch)
  const [data, setData] = useState<CurrentReorderSource | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false)
  const serial = useRef(0)
  useEffect(() => {
    if (!active || data || error || !reorderOwnerCurrent(owner)) return
    const generation = ++serial.current, config = reorderConfig(owner)
    const current = () => activeRef.current && generation === serial.current && reorderOwnerCurrent(owner)
    const assertCurrent = () => { if (!current()) throw new Error('原读取代次已暂停，草稿保留'); assertReorderOwner(owner) }
    setLoading(true)
    void (async () => {
      try {
        assertReorderPermission(PERMISSIONS.SALE_ORDER_VIEW)
        assertCurrent()
        const source = await getSaleReorderSourceApi(sourceId, config)
        assertCurrent()
        if (source.id !== sourceId || source.model !== model || !positiveReorderId(source.customerId) || !source.orderNo?.trim() || !Array.isArray(source.items) || !source.items.length || source.items.length > 200 || (model === 'ordinary' && source.items.some(i => i.kind !== 'ordinary'))) throw new Error('返回来源身份或模型不一致，请保留原单并人工核对')
        assertReorderPermission(PERMISSIONS.CUSTOMER_VIEW)
        assertCurrent()
        const customer = await getCustomerApi(source.customerId, config)
        assertCurrent()
        const customerError = customer.id !== source.customerId || !customer.isActive ? '原客户当前不存在或已停用，请重新选择客户开单' : undefined
        assertReorderPermission(PERMISSIONS.PRODUCT_VIEW)
        const products = new Map<number, Promise<CurrentReorderItem>>()
        const items = await Promise.all(source.items.map(async identity => {
          if (identity.kind === 'ordinary' && positiveReorderId(identity.productId)) {
            let existing = products.get(identity.productId)
            if (!existing) {
              existing = (async (): Promise<CurrentReorderItem> => {
                try {
                  assertCurrent()
                  const product = await getProductApi(identity.productId, config)
                  assertCurrent()
                  if (product.id !== identity.productId || !product.isActive || !product.unit) throw new Error('商品当前不存在或已停用，请重新选择商品')
                  assertReorderPermission(PERMISSIONS.PRICE_LIST_VIEW)
                  assertCurrent()
                  const quote = await getCustomerPriceApi(source.customerId, identity.productId, config)
                  assertCurrent()
                  if (!quote || !Number.isFinite(quote.salePrice) || quote.salePrice <= 0) throw new Error('当前客户报价无效，请人工核价后重新选择商品')
                  return { identity, product, quote }
                } catch (e) { return { identity, error: message(e) } }
              })()
              products.set(identity.productId, existing)
            }
            return { ...await existing, identity }
          }
          if (identity.kind === 'kit' && positiveReorderId(identity.kitId) && positiveReorderId(identity.originalKitVersionId)) {
            try {
              assertCurrent()
              const kit = await getKitApi(identity.kitId, owner)
              assertCurrent()
              if (kit.id !== identity.kitId || !kit.isActive || kit.deletedAt || !positiveReorderId(kit.currentVersionId) || !kit.version || kit.version.id !== kit.currentVersionId || kit.version.kitId !== kit.id || !kit.version.components.length || kit.version.components.some(c => !c.productActive)) throw new Error('套定义或当前组成不可用，请重新选择套')
              return { identity, kit }
            } catch (e) { return { identity, error: message(e) } }
          }
          return { identity, error: '来源行身份无效，请保留原单并人工核对' }
        }))
        if (current()) setData({ source, customer, customerError, items })
      } catch (e) { if (current()) setError(message(e)) }
      finally { if (current()) setLoading(false) }
    })()
    return () => { serial.current = generation + 1 }
  }, [active, data, error, model, owner, sourceId])
  const current = reorderOwnerCurrent(owner)
  return { owner, active, current, isActiveCurrent: () => activeRef.current && reorderOwnerCurrent(owner), data: current ? data : null, error: current ? error : '账号、权限或服务器已变化，原草稿保留；请核对后重新打开新单', loading: current && loading, reload: () => { if (activeRef.current && reorderOwnerCurrent(owner)) { setError(''); setData(null) } } }
}
