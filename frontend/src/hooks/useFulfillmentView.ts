import { useState } from 'react'
import { useAuthStore } from '@/store/authStore'

const filters = ['open', 'mine', 'unassigned', 'overdue', 'resolved']
const types = ['', 'sale', 'purchase', 'inbound', 'transfer']
interface View { filter: string; documentType: string; keyword: string; draft: string }
function readView(key: string | null): View {
  const empty = { filter: 'open', documentType: '', keyword: '', draft: '' }
  if (!key) return empty
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '{}')
    return { ...empty, filter: filters.includes(saved?.filter) ? saved.filter : 'open', documentType: types.includes(saved?.documentType) ? saved.documentType : '' }
  } catch { return empty }
}
/** 只保存用户自己的状态/类型偏好；搜索词及业务数据留在当前页面内存。 */
export function useFulfillmentView() {
  const userId = useAuthStore(s => s.user?.id)
  const key = userId ? `flowcube:fulfillment-view:v1:${userId}` : null
  const [state, setState] = useState(() => ({ key, view: readView(key) }))
  // 会话切换时同步隔离，避免 effect 下一帧前发出上一用户的筛选请求。
  let view = state.view
  if (state.key !== key) { view = readView(key); setState({ key, view }) }
  const update = (patch: Partial<View>) => {
    const next = { ...view, ...patch }
    setState({ key, view: next })
    if (key && (patch.filter !== undefined || patch.documentType !== undefined)) {
      try { localStorage.setItem(key, JSON.stringify({ filter: next.filter, documentType: next.documentType })) } catch { /* 存储受限时仍可正常筛选。 */ }
    }
  }
  return { view, update, userId }
}
