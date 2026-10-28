import { ArrowUpRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { usePermission } from '@/hooks/usePermission'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { resolveRoutePermission, resolveRouteTitle } from '@/router/routeRegistry'
import { buildWorkspaceTabRegistrationFromPath } from '@/router/workspaceRouteMeta'
import type { AssistantTask } from './types'

const positiveId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
export default function ResultLinks({ task }: { task: AssistantTask }) {
  const navigate = useNavigate()
  const { can } = usePermission()
  const addTab = useWorkspaceStore(s => s.addTab)
  if (task.state !== 'DONE' || !task.result) return null
  const links: { path: string; label: string }[] = []
  const result = task.result
  if (task.graph === 'B-sale-draft' && positiveId(result.orderId)) links.push({ path: `/sale/${result.orderId}`, label: '查看销售单' })
  if (task.graph === 'B2-reserve' && positiveId(task.preview?.orderId)) links.push({ path: `/sale/${task.preview.orderId}`, label: '查看销售单' })
  if (task.graph === 'C-purchase-draft' && Array.isArray(result.orders)) {
    for (const order of result.orders as Record<string, unknown>[]) if (positiveId(order.orderId)) links.push({ path: `/purchase/${order.orderId}`, label: `查看采购单${typeof order.orderNo === 'string' ? ` ${order.orderNo}` : ''}` })
  }
  if (['D-receipt', 'D-settle'].includes(task.graph) && positiveId(result.receiptId)) links.push({ path: '/payments/receivable', label: '查看客户往来' })
  const visible = links.filter(link => { const permission = resolveRoutePermission(link.path); return permission && can(permission) })
  return visible.length ? <div className="xiaoman-result-links">{visible.map(link => <button key={link.path} type="button" onClick={() => {
    const tab = { ...buildWorkspaceTabRegistrationFromPath(link.path), title: resolveRouteTitle(link.path) || link.label }
    if (addTab(tab)) navigate(link.path)
  }}>{link.label}<ArrowUpRight size={14} aria-hidden="true" /></button>)}</div> : null
}
