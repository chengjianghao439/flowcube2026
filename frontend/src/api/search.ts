import { payloadClient as client } from './client'

export interface GlobalSearchItem {
  type: string
  label: string
  no: string
  subtitle?: string
  path: string
  [key: string]: unknown
}

/** 全局搜索（GlobalSearch 组件用；仓库数据权限由后端按用户 scope 过滤） */
export async function searchGlobalApi(q: string, startDate = '', endDate = ''): Promise<GlobalSearchItem[]> {
  const res = await client.get<GlobalSearchItem[]>('/search', { params: { q, startDate, endDate } })
  return res ?? []
}
