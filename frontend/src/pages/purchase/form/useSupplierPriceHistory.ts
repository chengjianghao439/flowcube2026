import { useEffect, useMemo, useState } from 'react'
import { getSupplierPriceHistoryApi, type SupplierPurchasePriceHistoryItem } from '@/api/purchase'

/**
 * 读取当前供应商对已选商品的最近一次历史采购价。
 * 按 productId 去重；供应商或商品变化时中止旧请求，避免竞态回写。
 */
export function useSupplierPriceHistory(supplierId: number, productIds: number[], enabled = true) {
  const productKey = useMemo(
    () => Array.from(new Set(productIds.filter(id => Number.isInteger(id) && id > 0))).sort((a, b) => a - b).join(','),
    [productIds],
  )
  const [map, setMap] = useState<Map<number, SupplierPurchasePriceHistoryItem[]>>(() => new Map())

  useEffect(() => {
    if (!enabled || !(supplierId > 0) || !productKey) {
      setMap(new Map())
      return
    }
    const ids = productKey.split(',').map(Number)
    const controller = new AbortController()
    let active = true

    Promise.all(
      ids.map(async (productId) => {
        try {
          const rows = await getSupplierPriceHistoryApi(supplierId, productId, 1, controller.signal)
          return [productId, Array.isArray(rows) ? rows.slice(0, 1) : []] as const
        } catch {
          return [productId, [] as SupplierPurchasePriceHistoryItem[]] as const
        }
      }),
    ).then((entries) => {
      if (!active || controller.signal.aborted) return
      const next = new Map<number, SupplierPurchasePriceHistoryItem[]>()
      for (const [productId, rows] of entries) {
        if (rows.length > 0) next.set(productId, rows)
      }
      setMap(next)
    })

    return () => {
      active = false
      controller.abort()
    }
  }, [supplierId, productKey, enabled])

  return map
}
