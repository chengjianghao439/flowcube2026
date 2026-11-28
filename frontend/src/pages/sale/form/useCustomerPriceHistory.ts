import { useEffect, useMemo, useState } from 'react'
import { getCustomerPriceHistoryApi, type CustomerSalePriceHistoryItem } from '@/api/sale'

/**
 * 读取当前客户对已选商品的最近历史成交价。
 * 按 productId 去重；客户或商品变化时中止旧请求，避免竞态回写。
 */
export function useCustomerPriceHistory(customerId: number, productIds: number[], enabled = true) {
  const productKey = useMemo(
    () => Array.from(new Set(productIds.filter(id => Number.isInteger(id) && id > 0))).sort((a, b) => a - b).join(','),
    [productIds],
  )
  const [map, setMap] = useState<Map<number, CustomerSalePriceHistoryItem[]>>(() => new Map())

  useEffect(() => {
    if (!enabled || !(customerId > 0) || !productKey) {
      setMap(new Map())
      return
    }
    const ids = productKey.split(',').map(Number)
    const controller = new AbortController()
    let active = true

    Promise.all(
      ids.map(async (productId) => {
        try {
          const rows = await getCustomerPriceHistoryApi(customerId, productId, 1, controller.signal)
          return [productId, Array.isArray(rows) ? rows.slice(0, 1) : []] as const
        } catch {
          return [productId, [] as CustomerSalePriceHistoryItem[]] as const
        }
      }),
    ).then((entries) => {
      if (!active || controller.signal.aborted) return
      const next = new Map<number, CustomerSalePriceHistoryItem[]>()
      for (const [productId, rows] of entries) {
        if (rows.length > 0) next.set(productId, rows)
      }
      setMap(next)
    })

    return () => {
      active = false
      controller.abort()
    }
  }, [customerId, productKey, enabled])

  return map
}
