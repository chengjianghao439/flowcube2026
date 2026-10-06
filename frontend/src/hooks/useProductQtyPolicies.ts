import { handlingConfig, type captureHandlingOwner } from '@/lib/disposalHandlingRecovery'
import { useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getProductQtyPoliciesApi } from '@/api/products'

/**
 * 商品数量小数策略（迁移 254）——数量输入框据此把 `step` 在 1 与 0.01 之间切换。
 *
 * 为什么是「按需查」而不是让每个接口都回带这个字段：数量输入框散在销售、采购、
 * 退货、调拨、请购、盘点、处置、库存调整十几个页面里，明细行有的来自商品选择器、
 * 有的来自后端单据、有的来自采购建议。逐个给这些查询补 JOIN，改十几处后端 SQL
 * 且以后每加一个明细接口都要记得补；一次批量查询 + React Query 缓存，则与数据
 * 来源无关，全站共用同一份答案。
 *
 * 查不到（新商品、接口失败、还没返回）一律按**允许**兜底：宁可让用户先填、
 * 由服务端拦下来，也不要因为一次查询失败就把整数框锁死。
 *
 * @param productIds 当前页面会出现的商品 ID（可变数组，内部自行去重排序）
 * @returns 查询函数：给商品 ID 返回是否允许小数
 */
export interface QuantityReadContext { owner: ReturnType<typeof captureHandlingOwner>; isCurrent: () => boolean }
export function useProductQtyPolicies(productIds: Array<number | null | undefined>, read?: QuantityReadContext) {
  const readable = !read || read.isCurrent()
  const activity = useRef({ readable, generation: 0 })
  if (read && activity.current.readable !== readable) activity.current.generation++
  activity.current.readable = readable
  const generation = activity.current.generation
  const isCurrent = () => !read || (activity.current.readable && activity.current.generation === generation && read.isCurrent())
  // 去重 + 排序后再拼 key：明细行增删顺序变化不该产生新请求
  const key = useMemo(
    () => [...new Set(productIds.filter((id): id is number => Number.isSafeInteger(id) && Number(id) > 0))].sort((a, b) => a - b).join(','),
    [productIds],
  )

  const { data } = useQuery({
    queryKey: read ? ['products', 'qty-policies', key, read.owner, generation] : ['products', 'qty-policies', key],
    queryFn: async ({ signal }) => {
      const assert = () => { if (!isCurrent()) throw Error('当前数量策略读取已暂停') }
      assert()
      const ids = key.split(',').map(Number)
      const batches = []
      for (let offset = 0; offset < ids.length; offset += 500) {
        assert()
        batches.push(await getProductQtyPoliciesApi(ids.slice(offset, offset + 500), read ? { ...handlingConfig(read.owner), signal } : undefined))
        assert()
      }
      return batches.flat()
    },
    enabled: key.length > 0 && isCurrent(),
    staleTime: 5 * 60 * 1000,
  })

  const map = useMemo(
    () => new Map((data || []).map(item => [item.id, item.allowDecimal])),
    [data],
  )

  return (productId?: number | null): boolean => {
    if (productId == null) return true
    const value = !isCurrent() ? undefined : map.get(Number(productId))
    return value === undefined ? true : value
  }
}
