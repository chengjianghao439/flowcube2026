import { Fragment, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { resolveRouteTitle } from '@/router/routeRegistry'
import { buildWorkspaceTabRegistrationFromPath } from '@/router/workspaceRouteMeta'

export const ASSISTANT_GUIDE_LINKS = [
  { label: '新建销售单', path: '/sale/new-kit' },
  { label: '销售订单', path: '/sale' },
  { label: '采购订单', path: '/purchase' },
  { label: '库存管理', path: '/inventory' },
  { label: '客户往来', path: '/payments/receivable' },
] as const
const GUIDE_PATHS = new Set<string>([
  ...ASSISTANT_GUIDE_LINKS.map(link => link.path),
  '/payments/payable', '/approvals/pending', '/warehouse-shipping', '/products',
])

export function useOpenWorkspacePath() {
  const navigate = useNavigate()
  const addTab = useWorkspaceStore(s => s.addTab)
  return (path: string) => {
    if (!GUIDE_PATHS.has(path)) return
    const tab = { ...buildWorkspaceTabRegistrationFromPath(path), title: resolveRouteTitle(path) || path }
    if (addTab(tab)) navigate(path)
  }
}

// 只呈现强调、文字列表，以及回复里显式给出的站内菜单。其他 HTML、链接与脚本保留为普通文本。
function inline(text: string, open: (path: string) => void) {
  const nodes: ReactNode[] = []
  const pattern = /\[\[([^[\]|]{1,20})\|(\/[a-z0-9\-/]+)\]\]/g
  let last = 0
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0
    nodes.push(...emphasize(text.slice(last, index), `${index}-text`))
    const label = match[1]
    const path = match[2]
    nodes.push(GUIDE_PATHS.has(path)
      ? <button key={`${index}-guide`} type="button" className="xiaoman-guide" onClick={() => open(path)}>{label}</button>
      : <Fragment key={`${index}-plain`}>{label}</Fragment>)
    last = index + match[0].length
  }
  nodes.push(...emphasize(text.slice(last), `${last}-rest`))
  return nodes
}
function emphasize(text: string, keyPrefix: string) {
  return text.split(/(\*\*[^*\n]+\*\*)/g).map((part, index) => part.startsWith('**') && part.endsWith('**')
    ? <strong key={`${keyPrefix}-${index}`}>{part.slice(2, -2)}</strong> : <Fragment key={`${keyPrefix}-${index}`}>{part}</Fragment>)
}
export default function MessageText({ text }: { text: string }) {
  const open = useOpenWorkspacePath()
  return <>{text.split(/\n\s*\n/).map((block, index) => {
    const lines = block.split('\n')
    if (lines.every(line => /^\d+[.)]\s+/.test(line))) return <ol key={index} start={Number(lines[0].match(/^\d+/)?.[0]) || 1}>{lines.map((line, i) => <li key={i}>{inline(line.replace(/^\d+[.)]\s+/, ''), open)}</li>)}</ol>
    if (lines.every(line => /^[-*•]\s+/.test(line))) return <ul key={index}>{lines.map((line, i) => <li key={i}>{inline(line.replace(/^[-*•]\s+/, ''), open)}</li>)}</ul>
    return <p key={index}>{lines.map((line, i) => <Fragment key={i}>{i > 0 && <br />}{inline(line, open)}</Fragment>)}</p>
  })}</>
}
