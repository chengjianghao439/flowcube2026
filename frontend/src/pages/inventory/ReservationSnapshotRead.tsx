import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { getApiClientBaseURL } from '@/api/client'
import { getInventoryReservationSnapshotApi } from '@/api/inventory'
import { useAuthStore } from '@/store/authStore'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS as P } from '@/lib/permission-codes'
import { qty } from '@/lib/format'
import { formatDisplayDate, formatDisplayDateTime } from '@/lib/dateTime'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { VirtualTableBody, VIRTUAL_TABLE_THRESHOLD } from '@/components/shared/VirtualTableBody'
import { validateReservationBatch } from './reservationSnapshot'
import type { InventoryOverviewItem, InventoryReservationDisplayRow, InventoryReservationSnapshotParams,
  InventoryReservationSnapshotResult, InventoryReservationSummary } from '@/types/inventory'

type Item = Pick<InventoryOverviewItem, 'productId' | 'warehouseId' | 'productName' | 'warehouseName' | 'unit'>
type Cursor = Pick<InventoryReservationSnapshotParams, 'snapshotId' | 'offset'>
function readKey() {
  const state = useAuthStore.getState()
  return JSON.stringify([state.sessionGeneration, state.user?.id, state.user?.roleId, state.user?.permissions, getApiClientBaseURL()])
}
const rowKey = (row: InventoryReservationDisplayRow) => row.id

export function ReservationSnapshotRead({ item, owner, server, generation, renderSummary }: {
  item: Item; owner: string; server: string | undefined; generation: number
  renderSummary: (summary: InventoryReservationSummary) => ReactNode
}) {
  const client = useQueryClient(), { can } = usePermission()
  const instance = useId()
  const [draft, setDraft] = useState(''), [keyword, setKeyword] = useState(''), [revision, setRevision] = useState(0)
  const [expired, setExpired] = useState(false)
  const key = ['inventory-reservation-snapshot', owner, instance, item.productId, item.warehouseId, keyword, revision]
  const query = useInfiniteQuery({
    queryKey: key, initialPageParam: { offset: 0 } as Cursor,
    queryFn: async ({ signal, pageParam }) => {
      const request = { productId: item.productId, warehouseId: item.warehouseId, keyword, ...pageParam }
      const previous = client.getQueryData<InfiniteData<InventoryReservationSnapshotResult, Cursor>>(key)?.pages ?? []
      const value = await getInventoryReservationSnapshotApi(request,
        { signal, baseURL: server, _authSessionGeneration: generation, _erpApiFallbackTried: true })
      if (signal.aborted || readKey() !== owner) throw new Error('库存读取信息已变化，请重新打开')
      return validateReservationBatch(value, request, previous)
    },
    getNextPageParam: last => last.snapshot.nextOffset === null ? undefined
      : { offset: last.snapshot.nextOffset, snapshotId: last.snapshot.snapshotId },
    enabled: !expired, staleTime: Infinity, gcTime: 0, placeholderData: undefined,
    refetchOnWindowFocus: false, refetchOnReconnect: false, retry: false,
  })
  const expiresAt = query.data?.pages[0]?.snapshot.expiresAt
  useEffect(() => {
    setExpired(false)
    if (!expiresAt) return
    const remaining = Date.parse(expiresAt) - Date.now()
    if (remaining <= 0) { setExpired(true); return }
    const timer = setTimeout(() => setExpired(true), remaining)
    return () => clearTimeout(timer)
  }, [expiresAt, revision])
  const fresh = query.isSuccess && !query.isPaused && !expired && readKey() === owner
    && (!query.isFetching || query.isFetchingNextPage)
  const pages = fresh ? query.data?.pages : undefined, first = pages?.[0]
  const rows = useMemo(() => pages?.flatMap(page => page.rows) ?? [], [pages])
  function refresh() { setExpired(false); setRevision(value => value + 1) }
  function more() { if (fresh && query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage({ cancelRefetch: false }) }
  function renderRow(row: InventoryReservationDisplayRow) {
    if (row.kind === 'sale') {
      const source = row.source
      return <tr key={row.id} className="border-t align-top" data-reservation-row={row.id}>
        <td className="p-2"><div className="flex flex-wrap items-center gap-2">{can(P.SALE_ORDER_VIEW)
          ? <Link className="text-primary underline" to={'/sale/' + row.saleOrderId}>{source.orderNo}</Link> : '原单查看权限已变化'}
          <StatusBadge type="sale" status={source.status} /></div>
          <div>{source.customerName || '—'}</div><div className="text-xs">{formatDisplayDateTime(source.createdAt)}</div></td>
        <td className="p-2"><div>预占记录 {qty(source.reservationQuantity)}；预计绑定 {qty(source.expectedBindingQuantity)}。</div>
          {source.hiddenBindingQuantity !== 0 && <div className="text-xs">无权查看采购来源的绑定：{qty(source.hiddenBindingQuantity)}</div>}
          {source.orphanBindingQuantity !== 0 && <div className="text-xs">绑定来源或明细关联待核对：{qty(source.orphanBindingQuantity)}</div>}</td>
        <td className="p-2">—</td>
      </tr>
    }
    const binding = row.binding
    return <tr key={row.id} className="border-t align-top bg-muted/20" data-reservation-row={row.id}>
      <td className="p-2">{can(P.SALE_ORDER_VIEW)
        ? <Link className="text-primary underline" to={'/sale/' + row.saleOrderId}>{row.orderNo}</Link> : '原单查看权限已变化'}
        <div className="text-xs">销售行 #{binding.saleOrderItemId}</div></td>
      <td className="p-2">绑定数量 {qty(binding.quantity)}
        {binding.sourceState !== 'expected_supply' && <div className="text-xs">{binding.sourceState === 'putaway_exceeds_order'
          ? '上架数量超过原采购数量，请核对来源' : '该绑定不在当前预计供给范围，请核对来源'}</div>}</td>
      <td className="p-2"><div className="flex flex-wrap items-center gap-2">{can(P.PURCHASE_ORDER_VIEW)
        ? <Link className="text-primary underline" to={'/purchase/' + binding.purchase.purchaseOrderId}>{binding.purchase.orderNo}</Link> : '采购查看权限已变化'}
        <StatusBadge type="purchase" status={binding.purchase.status} /><span>采购行 #{binding.purchase.purchaseItemId}</span></div>
        <div className="text-xs">未上架 {qty(binding.purchase.openQuantity)}，全部有效绑定 {qty(binding.purchase.boundQuantity)}。</div>
        <div className="text-xs">预计日期 {binding.purchase.expectedDate ? formatDisplayDate(binding.purchase.expectedDate) : '未安排'}。</div></td>
    </tr>
  }
  return <div className="space-y-3">
    <p className="text-sm">{item.productName} · {item.warehouseName} · 数量单位：{item.unit || '基本单位'}</p>
    <form className="flex flex-wrap items-center gap-2" onSubmit={event => { event.preventDefault(); setKeyword(draft.trim()); refresh() }}>
      <Input className="h-8 w-64" aria-label="筛选销售原单" placeholder="销售单号或客户" maxLength={100} value={draft} onChange={event => setDraft(event.target.value)} />
      <Button size="sm" type="submit">查询</Button><Button size="sm" variant="outline" type="button" onClick={refresh}>刷新</Button>
    </form>
    {query.isError || expired ? <QueryErrorState error={expired ? new Error('读取数据已过期，请重新读取') : query.error}
      title="预占明细读取失败" onRetry={refresh} compact />
      : !first ? <p role="status">{query.isPaused ? '网络暂不可用，等待重新读取' : '正在重新读取库存预占…'}</p> : <>
        {renderSummary(first.summary)}
        <p className="text-xs">预占按销售原单汇总；预计绑定用于解释采购依赖，不再从可承诺量重复扣除。</p>
        <p className="text-sm">匹配销售原单 {first.snapshot.totalSources} 张；不可查看的预占 {qty(first.summary.hiddenReservationQuantity)}，来源已缺失 {qty(first.summary.orphanReservationQuantity)}，未知来源类型 {qty(first.summary.unknownReservationQuantity)}。</p>
        <p className="text-xs">不可查看原单的预计绑定 {qty(first.summary.hiddenBindingQuantity)}；销售来源已缺失的绑定 {qty(first.summary.orphanBindingQuantity)}。</p>
        <div data-table-scroll aria-label="预占来源明细" tabIndex={0} className="max-h-[44vh] overflow-auto rounded-md border"
          onScroll={event => { const el = event.currentTarget; if (el.scrollHeight - el.scrollTop - el.clientHeight < 300) more() }}
          onKeyDown={event => { if (event.key === 'End') more() }}>
          <table className="w-full text-sm"><thead className="sticky top-0 z-10 bg-background"><tr>
            <th className="p-2 text-left font-medium">销售原单</th><th className="p-2 text-left font-medium">预占与绑定</th><th className="p-2 text-left font-medium">采购来源</th>
          </tr></thead>{rows.length >= VIRTUAL_TABLE_THRESHOLD
            ? <VirtualTableBody data={rows} columns={3} getRowKey={rowKey} renderRow={renderRow} preserveFocus />
            : <tbody>{rows.length ? rows.map(renderRow) : <tr><td className="p-4" colSpan={3}>当前没有匹配且可查看的销售原单。</td></tr>}</tbody>}</table>
        </div>
        <p className="text-xs" role="status">已读取 {rows.length} / {first.snapshot.totalRows} 行 · 读取于 {formatDisplayDateTime(first.snapshot.readAt)}
          {query.isFetchingNextPage ? ' · 正在继续读取…' : query.hasNextPage ? ' · 向下滚动继续读取' : ' · 已读完整'}</p>
      </>}
  </div>
}
