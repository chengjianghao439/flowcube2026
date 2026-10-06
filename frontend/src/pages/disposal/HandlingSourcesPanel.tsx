import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { getHandlingSourcesApi } from '@/api/disposal-handling'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import { useDisposalHandlingOperation } from '@/hooks/useDisposalHandlingOperation'
import { captureHandlingOwner, handlingOwnerCurrent, handlingConfig, handlingRevision, mayHandle, subscribeHandling } from '@/lib/disposalHandlingRecovery'
import { PERMISSIONS as P } from '@/lib/permission-codes'
import { MAX_WORKSPACE_TABS, useWorkspaceStore } from '@/store/workspaceStore'
import { buildWorkspaceTabRegistrationFromPath } from '@/router/workspaceRouteMeta'
import { resolveRouteTitle } from '@/router/routeDefinitions'
import { toast } from '@/lib/toast'
import { qty } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { createRequestKey } from '@/lib/requestKey'
import type { HandlingSource, HandlingLink } from '@/types/disposal-handling'
import { HandlingOperationPanel } from './HandlingOperationPanel'
export function openHandlingTab(path: string, navigate: (path: string) => void) {
  const tab = buildWorkspaceTabRegistrationFromPath(path), workspace = useWorkspaceStore.getState(), existing = workspace.tabs.find(t => t.key === tab.key)
  if (!existing && workspace.tabs.length >= MAX_WORKSPACE_TABS) { toast.warning('工作区标签已满，原草稿保留，请先关闭不需要的页面'); return false }
  if (workspace.addTab(existing ?? { ...tab, title: resolveRouteTitle(tab.path) ?? '处理来源' })) { navigate(existing?.path ?? tab.path); return true }
  return false
}
function ReleaseDialog({ source, link, open, onClose }: { source: HandlingSource; link: HandlingLink; open: boolean; onClose: () => void }) {
  const [owner] = useState(captureHandlingOwner), active = useActiveWorkspaceTab(), latest = useRef({ open, active })
  latest.current = { open, active }
  const permission = source.originKind === 'legacy' ? P.INVENTORY_DISPOSAL_APPROVE : P.INVENTORY_DISPOSAL_CREATE
  const current = () => latest.current.open && latest.current.active && handlingOwnerCurrent(owner) && mayHandle(P.INVENTORY_DISPOSAL_VIEW, permission)
  const identity = `handling-release:${source.id}:${link.linkId}`
  const write = useDisposalHandlingOperation(identity, open && active, current)
  const [reason, setReason] = useState(''), [operationUuid] = useState(() => crypto.randomUUID()), [requestKey] = useState(() => createRequestKey('handling-release'))
  async function release() {
    if (!current() || write.blocked || link.state !== 'ACTIVE' || !reason.trim() || Array.from(reason).length > 500) return
    const body = { operationUuid, expectedRevision: source.revision, reason }
    const result = await write.submit({ kind: 'release', draftIdentity: identity, sourceId: source.id, linkId: link.linkId, intentUuid: source.intentUuid, operationUuid, requestKey, action: `disposal.handling.link.release.${link.linkId}`, path: `/disposals/handling-sources/${source.id}/links/${link.linkId}/release`, body })
    if (result && write.canApply(result)) onClose()
  }
  return <Dialog open={open && active && handlingOwnerCurrent(owner) && mayHandle(P.INVENTORY_DISPOSAL_VIEW)} onOpenChange={v => { if (!v && current()) onClose() }}><DialogContent><DialogHeader><DialogTitle>核对并解除</DialogTitle></DialogHeader><p>只解除已终结目标的未执行量。服务器核对全历史出库和实物归还，不会取消目标或修改库存。</p><label>核对说明<Input aria-label="解除说明" maxLength={500} value={reason} disabled={!current() || write.blocked} onChange={e => { if (current() && !write.blocked) setReason(e.target.value) }} /></label><HandlingOperationPanel write={write} /><Button disabled={!current() || write.blocked || !reason.trim() || link.state !== 'ACTIVE'} onClick={() => void release()}>确认核对解除</Button><Button variant="outline" onClick={() => { if (current()) onClose() }}>关闭并保留说明</Button></DialogContent></Dialog>
}
export function HandlingSourcesPanel() {
  useSyncExternalStore(subscribeHandling, handlingRevision)
  const owner = captureHandlingOwner(), active = useActiveWorkspaceTab(), navigate = useNavigate(), [page, setPage] = useState(1)
  const live = useRef(active); live.current = active
  const current = () => live.current && handlingOwnerCurrent(owner) && mayHandle(P.INVENTORY_DISPOSAL_VIEW)
  const [dialogs, setDialogs] = useState<Record<string, { source: HandlingSource; link: HandlingLink; owner: ReturnType<typeof captureHandlingOwner> }>>({}), [selected, setSelected] = useState<string | null>(null)
  const data = useQuery({ queryKey: ['disposal-handling', 'sources', owner, page], enabled: current(), staleTime: 0, refetchOnMount: 'always', queryFn: async ({ signal }) => { if (!current()) throw Error('读取暂停'); const value = await getHandlingSourcesApi({ page, pageSize: 20 }, { ...handlingConfig(owner), signal }); if (!current()) throw Error('读取归属已变化'); return value } })
  const total = data.data?.pagination.total ?? 0, pages = Math.max(1, Math.ceil(total / 20))
  useEffect(() => { if (data.isSuccess && !data.isFetching && page > pages) setPage(pages) }, [page, pages, data.isSuccess, data.isFetching])
  function target(source: HandlingSource) {
    if (!current()) return
    const path = source.handlingType === 1 ? '/sale/new' : source.handlingType === 2 ? '/returns/purchase/new' : '/disposals/new'
    const permission = source.handlingType === 1 ? P.SALE_ORDER_CREATE : source.handlingType === 2 ? P.RETURN_ORDER_CREATE : P.INVENTORY_DISPOSAL_CREATE
    if (mayHandle(permission, P.INVENTORY_DISPOSAL_VIEW)) openHandlingTab(`${path}?handlingSourceId=${source.id}`, navigate)
  }
  return <section className="space-y-3 border rounded p-4"><h2 className="font-semibold">处理来源</h2><p className="text-sm text-muted-foreground">意图量、关联量、实际执行量和已解除量来自服务器；意图不承诺库存。金额与执行仍走原业务。</p>
    {data.isError && <p role="alert">来源读取失败，未显示旧结果</p>}
    {current() && !data.isFetching && data.data?.list.map(source => <article key={source.id} className="border rounded p-3 space-y-2"><p>{source.productCode} {source.productName} · {source.warehouseName} · {source.originKind === 'legacy' ? '旧单签认' : '普通意图'}</p><p>意图 {qty(source.budget.intentionQuantity)} / 关联 {qty(source.budget.allocatedQuantity)} / 实际 {source.budget.actualExecutedQuantity == null ? '待核对' : qty(source.budget.actualExecutedQuantity)} / 已解除 {qty(source.budget.releasedQuantity)} {source.unit}</p><p>{source.budget.progress}；可关联 {qty(source.budget.availableQuantity)} {source.unit}</p><Button variant="outline" disabled={source.budget.availableQuantity <= 0 || !mayHandle(source.handlingType === 1 ? P.SALE_ORDER_CREATE : source.handlingType === 2 ? P.RETURN_ORDER_CREATE : P.INVENTORY_DISPOSAL_CREATE)} onClick={() => target(source)}>创建正常目标</Button>
      {source.links.map(link => <div key={link.linkId}><span>{link.state === 'TERMINATED' ? '已核对终结' : '已关联'} · 已执行 {link.executedQuantity == null ? '待核对' : qty(link.executedQuantity)} · 已解除 {qty(link.releasedQuantity)}</span>{link.pendingReason && <p>{link.pendingReason.message}</p>}
        {link.target && <Button variant="link" onClick={() => { if (current() && mayHandle(link.target!.type === 'sale_order' ? P.SALE_ORDER_VIEW : link.target!.type === 'purchase_return' ? P.RETURN_ORDER_VIEW : P.INVENTORY_DISPOSAL_VIEW)) openHandlingTab(link.target!.path, navigate) }}>{link.target.orderNo}</Button>}
        <Button variant="outline" disabled={link.state !== 'ACTIVE' || !link.returnClosed || !mayHandle(source.originKind === 'legacy' ? P.INVENTORY_DISPOSAL_APPROVE : P.INVENTORY_DISPOSAL_CREATE)} onClick={() => { if (current() && link.state === 'ACTIVE') { const key = JSON.stringify([source.id, link.linkId, owner]); setDialogs(old => old[key] ? old : { ...old, [key]: { source, link, owner } }); setSelected(key) } }}>核对解除</Button></div>)}
    </article>)}
    {data.isSuccess && total === 0 && <p>暂无处理来源</p>}<div className="flex gap-3 items-center"><Button variant="outline" disabled={page <= 1 || !current()} onClick={() => { if (current()) setPage(p => p - 1) }}>上一页</Button><span>第 {page} / {pages} 页 · 共 {total} 条</span><Button variant="outline" disabled={page >= pages || !current()} onClick={() => { if (current()) setPage(p => p + 1) }}>下一页</Button></div>
    {Object.entries(dialogs).map(([key, draft]) => <ReleaseDialog key={key} source={draft.source} link={draft.link} open={selected === key && handlingOwnerCurrent(draft.owner)} onClose={() => setSelected(null)} />)}
  </section>
}
