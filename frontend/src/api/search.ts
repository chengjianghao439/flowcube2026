import { payloadClient as client } from './client'
import { useAuthStore } from '@/store/authStore'

export interface GlobalSearchItem {
  id: number
  type: string
  typeLabel: string
  title: string
  subtitle: string
  details?: { label: string; value: string }[]
  searchMatch?: string
  /** 商品编码/条码精确0、其它字段精确1、前缀2、包含3；不参与后端id游标分页。 */
  searchRank?: number
  path: string
}

export interface GlobalSearchPage {
  items: GlobalSearchItem[]
  nextCursors: Record<string, number | null>
}

/** 自动取齐各类游标批次，界面不提供翻页或加载更多。 */
export async function searchGlobalApi(q: string, options?: {signal?: AbortSignal}): Promise<GlobalSearchPage> {
  const keyword = q.trim()
  const config = { signal: options?.signal, _authSessionGeneration: useAuthStore.getState().sessionGeneration }
  const first = await client.get<GlobalSearchPage>('/search', { ...config, params: { q: keyword, paginated: '1' } })
  const items = [...first.items]
  for (const [type, initial] of Object.entries(first.nextCursors)) {
    let beforeId = initial
    while (beforeId != null) {
      const page = await client.get<GlobalSearchPage>('/search', { ...config, params: {q: keyword, paginated: '1', type, beforeId} })
      const next = page.nextCursors[type]
      if (next != null && next >= beforeId) throw new Error('搜索结果发生变化，请重试')
      items.push(...page.items)
      beforeId = next
    }
  }
  // 后端始终按id向后取批次；全部取齐后按四档和数字id降序排序商品。
  const products = items.filter(item => item.type === 'product')
    .sort((a, b) => (a.searchRank ?? 3) - (b.searchRank ?? 3) || b.id - a.id)
  let productIndex = 0
  return { items: items.map(item => item.type === 'product' ? products[productIndex++] : item), nextCursors: {} }
}
