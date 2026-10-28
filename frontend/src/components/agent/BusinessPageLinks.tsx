import { ArrowUpRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { usePermission } from '@/hooks/usePermission'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { getRouteByPath } from '@/router/routeRegistry'
import { buildWorkspaceTabRegistrationFromPath } from '@/router/workspaceRouteMeta'
import type { AssistantBusinessPage } from './types'

// 模型文本不提供 URL。响应只可选择此白名单；最终入口仍取当前注册路由和权限。
const PAGE_PATHS: Record<AssistantBusinessPage, string> = {
  sale: '/sale', purchase: '/purchase', inventory: '/inventory', 'price-change': '/price-change',
  receivable: '/payments/receivable', payable: '/payments/payable', approvals: '/approvals/pending', shipping: '/warehouse-shipping',
}

export default function BusinessPageLinks({ pages }: { pages?: AssistantBusinessPage[] }) {
  const navigate = useNavigate()
  const { can } = usePermission()
  const addTab = useWorkspaceStore(s => s.addTab)
  const valid = Array.isArray(pages) ? pages.filter(page => typeof page === 'string' && Object.hasOwn(PAGE_PATHS, page)) : []
  const routes = [...new Set(valid)].map(page => getRouteByPath(PAGE_PATHS[page]))
    .filter(route => route && route.permission && can(route.permission))
  return routes.length ? <div className="xiaoman-result-links">{routes.map(route => route && <button key={route.path} type="button" onClick={() => {
    if (!route.permission || !can(route.permission)) return
    if (addTab({ ...buildWorkspaceTabRegistrationFromPath(route.path), title: route.title })) navigate(route.path)
  }}>前往{route.title}<ArrowUpRight size={14} aria-hidden="true" /></button>)}</div> : null
}
