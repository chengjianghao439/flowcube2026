import { useContext, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { useWorkspaceStore } from '@/store/workspaceStore'

/**
 * 把当前工作区标签的标题换成**业务单号**。
 *
 * 背景（2026-09-19）：详情页的标签名原本只能取 `routePatterns` 的兜底名
 * 「销售单 #3260」「采购订单 #36」——那是数据库主键，不是业务单号。用户在标签栏上
 * 既认不出是哪张单，也与「从列表点进来」时的显示不一致（列表入口传的是 orderNo）。
 *
 * 详情页在数据到位后调用本 hook（`useWorkspaceTabTitle(order?.orderNo)`）即可。
 * 两个实现细节都是有原因的：
 *  - 用 `updateTabTitle` 而非 `addTab`：后者会 setActive，数据晚到时会把用户从别的标签拽回来。
 *  - 路径取 `TabPathContext` 而非 `location`：keep-alive 下非激活标签的详情页组件同样挂载，
 *    用 location 会把标题写到当前激活的那个标签上。
 */
export function useWorkspaceTabTitle(title?: string | null) {
  const tabPath = useContext(TabPathContext)
  const location = useLocation()
  useEffect(() => {
    if (!title) return
    const path = tabPath || location.pathname + location.search
    useWorkspaceStore.getState().updateTabTitle(path, title)
  }, [title, tabPath, location.pathname, location.search])
}
