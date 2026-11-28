import type { PermCode } from '@/lib/permissions'

export interface MergedPageGroup {
  key: string
  title: string
  tabTitle?: 'group'
  views: { path: string; label: string; permission: PermCode }[]
}

/**
 * 已按产品决策取消页内合并 Tab，各业务视图均保留独立顶栏菜单入口与独立工作区标签。
 */
export const MERGED_PAGE_GROUPS: MergedPageGroup[] = []

export function getMergedPageGroup(path: string): MergedPageGroup | undefined {
  const pathname = path.split(/[?#]/)[0]
  return MERGED_PAGE_GROUPS.find(group => group.views.some(view => view.path === pathname))
}

export function getMergedPageView(path: string): { group: MergedPageGroup; view: MergedPageGroup['views'][number] } | undefined {
  const pathname = path.split(/[?#]/)[0]
  for (const group of MERGED_PAGE_GROUPS) {
    const view = group.views.find(item => item.path === pathname)
    if (view) return { group, view }
  }
  return undefined
}
