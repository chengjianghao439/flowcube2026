import { useRef, useState, useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { getHandlingSourcesApi } from '@/api/disposal-handling'
import { collectAllRecords } from '@/api/allRecords'
import DataTable from '@/components/shared/DataTable'
import ListSummary from '@/components/shared/ListSummary'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import { useDisposalHandlingOperation } from '@/hooks/useDisposalHandlingOperation'
import { captureHandlingOwner, handlingOwnerCurrent, handlingConfig, handlingRevision, mayHandle, subscribeHandling } from '@/lib/disposalHandlingRecovery'
import { PERMISSIONS as P } from '@/lib/permission-codes'
import { qty } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { createRequestKey } from '@/lib/requestKey'
import type { HandlingSource, HandlingLink } from '@/types/disposal-handling'
import type { TableColumn } from '@/types'
import { HandlingOperationPanel } from './HandlingOperationPanel'
import { openHandlingTab } from './openHandlingTab'

function ReleaseDialog({ source, link, open, available, onClose }: { source: HandlingSource; link: HandlingLink; open: boolean; available: boolean; onClose: () => void }) {
  const [owner] = useState(captureHandlingOwner), active = useActiveWorkspaceTab(), latest = useRef({ open, active, available, revision: source.revision })
  latest.current = { open, active, available, revision: source.revision }
  const permission = source.originKind === 'legacy' ? P.INVENTORY_DISPOSAL_APPROVE : P.INVENTORY_DISPOSAL_CREATE
  const own = () => latest.current.open && latest.current.active && handlingOwnerCurrent(owner) && mayHandle(P.INVENTORY_DISPOSAL_VIEW, permission)
  const current = () => own() && latest.current.available && latest.current.revision === source.revision
  const identity = `handling-release:${source.id}:${link.linkId}`
  const write = useDisposalHandlingOperation(identity, open && active, current)
  const [reason, setReason] = useState(''), [operationUuid] = useState(() => crypto.randomUUID()), [requestKey] = useState(() => createRequestKey('handling-release'))
  async function release() {
    if (!current() || write.blocked || link.state !== 'ACTIVE' || !reason.trim() || Array.from(reason).length > 500) return
    const body = { operationUuid, expectedRevision: source.revision, reason }
    const result = await write.submit({ kind: 'release', draftIdentity: identity, sourceId: source.id, linkId: link.linkId, intentUuid: source.intentUuid, operationUuid, requestKey, action: `disposal.handling.link.release.${link.linkId}`, path: `/disposals/handling-sources/${source.id}/links/${link.linkId}/release`, body })
    if (result && write.canApply(result)) onClose()
  }
  return <Dialog open={open && active && handlingOwnerCurrent(owner) && mayHandle(P.INVENTORY_DISPOSAL_VIEW)} onOpenChange={v => { if (!v && own()) onClose() }}><DialogContent><DialogHeader description={<>{<>只解除已终结目标的未执行量。服务器核对全历史出库和实物归还，不会取消目标或修改库存。</>}</>}><DialogTitle>核对并解除</DialogTitle></DialogHeader><label>核对说明<Input aria-label="解除说明" maxLength={500} value={reason} disabled={!current() || write.blocked} onChange={e => { if (current() && !write.blocked) setReason(e.target.value) }} /></label><HandlingOperationPanel write={write} /><Button disabled={!current() || write.blocked || !reason.trim() || link.state !== 'ACTIVE'} onClick={() => void release()}>确认核对解除</Button><Button variant="outline" onClick={() => { if (own()) onClose() }}>关闭并保留说明</Button></DialogContent></Dialog>
}
export function HandlingSourcesPanel() {
  useSyncExternalStore(subscribeHandling, handlingRevision)
  const owner = captureHandlingOwner(), active = useActiveWorkspaceTab(), navigate = useNavigate()
  const live = useRef(active); live.current = active
  const current = () => live.current && handlingOwnerCurrent(owner) && mayHandle(P.INVENTORY_DISPOSAL_VIEW)
  const [dialogs, setDialogs] = useState<Record<string, { source: HandlingSource; link: HandlingLink; owner: ReturnType<typeof captureHandlingOwner> }>>({}), [selected, setSelected] = useState<string | null>(null)
  const data = useQuery({ queryKey: ['disposal-handling', 'sources', owner, 'all'], enabled: current(), subscribed: current(), staleTime: 0, refetchOnMount: 'always', queryFn: ({ signal }) => collectAllRecords(async (page, pageSize = 100) => { if (!current()) throw Error('读取暂停'); const value = await getHandlingSourcesApi({ page, pageSize }, { ...handlingConfig(owner), signal }); if (!current()) throw Error('读取归属已变化'); return value }, signal) })
  const readable = current() && data.isSuccess && !data.isFetching && data.fetchStatus === 'idle'
  const rows = readable ? data.data.list : []
  const latestRows = useRef(rows); latestRows.current = rows
  const sourceCurrent = (source: HandlingSource) => current() && latestRows.current.some(row => row.id === source.id && row.revision === source.revision)
  const total = readable ? data.data.pagination.total : 0
  function target(source: HandlingSource) {
    if (!sourceCurrent(source)) return
    const path = source.handlingType === 1 ? '/sale/new' : source.handlingType === 2 ? '/returns/purchase/new' : '/disposals/new'
    const permission = source.handlingType === 1 ? P.SALE_ORDER_CREATE : source.handlingType === 2 ? P.RETURN_ORDER_CREATE : P.INVENTORY_DISPOSAL_CREATE
    if (mayHandle(permission, P.INVENTORY_DISPOSAL_VIEW)) openHandlingTab(`${path}?handlingSourceId=${source.id}`, navigate)
  }
  const columns: TableColumn<HandlingSource>[] = [{ key: 'id', title: '商品与处理进度', render: (_, source) => <article className="space-y-2"><p>{source.productCode} {source.productName} · {source.warehouseName} · {source.originKind === 'legacy' ? '旧单签认' : '普通意图'}</p><p>意图 {qty(source.budget.intentionQuantity)} / 关联 {qty(source.budget.allocatedQuantity)} / 实际 {source.budget.actualExecutedQuantity == null ? '待核对' : qty(source.budget.actualExecutedQuantity)} / 已解除 {qty(source.budget.releasedQuantity)} {source.unit}</p><p>{source.budget.progress}；可关联 {qty(source.budget.availableQuantity)} {source.unit}</p><Button variant="outline" disabled={source.budget.availableQuantity <= 0 || !mayHandle(source.handlingType === 1 ? P.SALE_ORDER_CREATE : source.handlingType === 2 ? P.RETURN_ORDER_CREATE : P.INVENTORY_DISPOSAL_CREATE)} onClick={() => target(source)}>创建正常目标</Button>
      {source.links.map(link => <div key={link.linkId}><span>{link.state === 'TERMINATED' ? '已核对终结' : '已关联'} · 已执行 {link.executedQuantity == null ? '待核对' : qty(link.executedQuantity)} · 已解除 {qty(link.releasedQuantity)}</span>{link.pendingReason && <p>{link.pendingReason.message}</p>}
        {link.target && <Button variant="link" onClick={() => { if (sourceCurrent(source) && mayHandle(link.target!.type === 'sale_order' ? P.SALE_ORDER_VIEW : link.target!.type === 'purchase_return' ? P.RETURN_ORDER_VIEW : P.INVENTORY_DISPOSAL_VIEW)) openHandlingTab(link.target!.path, navigate) }}>{link.target.orderNo}</Button>}
        <Button variant="outline" disabled={link.state !== 'ACTIVE' || !link.returnClosed || !mayHandle(source.originKind === 'legacy' ? P.INVENTORY_DISPOSAL_APPROVE : P.INVENTORY_DISPOSAL_CREATE)} onClick={() => { if (sourceCurrent(source) && link.state === 'ACTIVE') { const key = JSON.stringify([source.id, link.linkId, owner]); setDialogs(old => ({ ...old, [key]: { source, link, owner } })); setSelected(key) } }}>核对解除</Button></div>)}
    </article> }]
  return <section className="space-y-3 border rounded p-4"><h2 className="font-semibold">处理来源</h2><p className="text-sm text-muted-foreground">意图量、关联量、实际执行量和已解除量来自服务器；意图不承诺库存。金额与执行仍走原业务。</p>
    {data.isError && <QueryErrorState error={data.error} title="来源读取失败" onRetry={() => { if (current() && !data.isFetching) void data.refetch() }} />}
    {current() && data.isFetching && <p role="status" className="text-sm text-muted-foreground">正在加载处理来源…</p>}
    {readable && rows.length > 0 && <DataTable columns={columns} data={rows} virtualized preserveFocus retainFocusedRow={selected !== null} />}
    {readable && total === 0 && <p>暂无处理来源</p>}
    {readable && (data.data.truncated ? <p role="status" className="text-sm text-muted-foreground">已读取 {rows.length.toLocaleString()} 条，匹配 {total.toLocaleString()} 条；来源未全部读取，请处理现有来源后重新读取。</p> : <ListSummary total={total} />)}
    {Object.entries(dialogs).map(([key, draft]) => <ReleaseDialog key={key} source={draft.source} link={draft.link} open={selected === key && handlingOwnerCurrent(draft.owner)} available={rows.some(source => source.id === draft.source.id && source.revision === draft.source.revision && source.links.some(link => link.linkId === draft.link.linkId && link.state === 'ACTIVE' && link.returnClosed))} onClose={() => setSelected(null)} />)}
  </section>
}
