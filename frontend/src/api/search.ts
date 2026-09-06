import { payloadClient as client } from './client'
import { useAuthStore } from '@/store/authStore'

export interface GlobalSearchItem {
  id: number
  type: string
  typeLabel: string
  title: string
  subtitle: string
  details?: { label: string; value: string }[]
  path: string
}

export interface GlobalSearchPage {
  items: GlobalSearchItem[]
  nextCursors: Record<string, number | null>
}

/** 自动取齐各类游标批次，界面不提供翻页或加载更多。 */
export async function searchGlobalApi(q: string, options?: {signal?: AbortSignal}): Promise<GlobalSearchPage> {
  const config = { signal: options?.signal, _authSessionGeneration: useAuthStore.getState().sessionGeneration }
  const first = await client.get<GlobalSearchPage>('/search', { ...config, params: { q, paginated: '1' } })
  const items = [...first.items]
  for (const [type, initial] of Object.entries(first.nextCursors)) {
    let beforeId = initial
    while (beforeId != null) {
      const page = await client.get<GlobalSearchPage>('/search', { ...config, params: {q, paginated: '1', type, beforeId} })
      const next = page.nextCursors[type]
      if (next != null && next >= beforeId) throw new Error('搜索结果发生变化，请重试')
      items.push(...page.items)
      beforeId = next
    }
  }
  return { items, nextCursors: {} }
}
