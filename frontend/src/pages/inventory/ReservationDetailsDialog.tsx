import { useEffect, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getApiClientBaseURL, subscribeApiClientBaseURL } from '@/api/client'
import { getInventoryReservationsApi } from '@/api/inventory'
import { useAuthStore } from '@/store/authStore'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS as P } from '@/lib/permission-codes'
import { qty } from '@/lib/format'
import { formatDisplayDate, formatDisplayDateTime } from '@/lib/dateTime'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import type { InventoryOverviewItem, InventoryReservationSummary } from '@/types/inventory'

type Item = Pick<InventoryOverviewItem, 'productId' | 'warehouseId' | 'productName' | 'warehouseName' | 'unit'>
function readKey() {
  const state = useAuthStore.getState()
  return JSON.stringify([state.sessionGeneration, state.user?.id, state.user?.roleId, state.user?.permissions, getApiClientBaseURL()])
}
export default function ReservationDetailsDialog({ open, onClose, item }: { open: boolean; onClose: () => void; item: Item | null }) {
  const active = useActiveWorkspaceTab()
  const user = useAuthStore(state => state.user)
  const generation = useAuthStore(state => state.sessionGeneration)
  const server = useSyncExternalStore(subscribeApiClientBaseURL, getApiClientBaseURL)
  const owner = JSON.stringify([generation, user?.id, user?.roleId, user?.permissions, server])
  const { can } = usePermission()
  const valid = !!item && [item.productId, item.warehouseId].every(id => Number.isSafeInteger(id) && id > 0)
  return <Dialog open={open && active} onOpenChange={next => { if (!next) onClose() }}>
    <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle>库存预占明细</DialogTitle></DialogHeader>
      {open && active && (can(P.INVENTORY_VIEW) ? valid && item
        ? <ReservationRead key={`${owner}:${item.productId}:${item.warehouseId}`} item={item} owner={owner} server={server} generation={generation} />
        : <p>库存商品或仓库信息无效</p> : <p>没有查看库存的权限</p>)}
      <DialogFooter><Button variant="outline" onClick={onClose}>关闭</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}

function ReservationRead({ item, owner, server, generation }: { item: Item; owner: string; server: string | undefined; generation: number }) {
  const [page, setPage] = useState(1)
  const { can } = usePermission()
  const query = useQuery({
    queryKey: ['inventory-reservations', owner, item.productId, item.warehouseId, page, 20],
    queryFn: async ({ signal }) => {
      const data = await getInventoryReservationsApi({ productId: item.productId, warehouseId: item.warehouseId, page, pageSize: 20 },
        { signal, baseURL: server, _authSessionGeneration: generation, _erpApiFallbackTried: true })
      if (readKey() !== owner || data.productId !== item.productId || data.warehouseId !== item.warehouseId) throw new Error('库存读取信息已变化，请重新打开')
      return data
    },
    staleTime: 0, gcTime: 0, refetchOnMount: 'always', placeholderData: undefined, retry: false,
  })
  const fresh = query.isSuccess && !query.isFetching && !query.isPaused && readKey() === owner
  const data = fresh ? query.data : undefined
  const lastPage = Math.max(1, Math.ceil((data?.pagination.total ?? 0) / 20))
  useEffect(() => { if (data && page > lastPage) setPage(lastPage) }, [data, lastPage, page])
  return <div className="space-y-4">
    <p className="text-sm">{item.productName} · {item.warehouseName} · 数量单位：{item.unit || '基本单位'}</p>
    {query.isError ? <QueryErrorState error={query.error} title="预占明细读取失败" onRetry={() => { if (readKey() === owner) void query.refetch() }} compact />
      : !data ? <p role="status">{query.isPaused ? '网络暂不可用，等待重新读取' : '正在重新读取库存预占…'}</p> : <>
        <QuantitySummary summary={data.summary} />
        <p className="text-xs text-muted-foreground">预占按来源销售单汇总，历史预占记录没有销售行身份。预计绑定另有准确的销售行和采购行；它用于解释采购依赖，不是另一份扣减，不再从可承诺量重复扣除。</p>
        <p className="text-sm">可查看的销售原单：{data.pagination.total} 张；不可查看的预占 {qty(data.summary.hiddenReservationQuantity)}，来源已缺失 {qty(data.summary.orphanReservationQuantity)}，未知来源类型 {qty(data.summary.unknownReservationQuantity)}。</p>
        <p className="text-xs text-muted-foreground">不可查看原单的预计绑定 {qty(data.summary.hiddenBindingQuantity)}；销售来源已缺失的绑定 {qty(data.summary.orphanBindingQuantity)}。这些数量仍在汇总中，原单资料不展示。</p>
        {data.list.length === 0 ? <p>当前没有可查看的销售原单；零预占或没有原单查看权限时仍可核对上方数量。</p> : data.list.map(source => <section key={source.saleOrderId} className="space-y-2 rounded-md border p-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {can(P.SALE_ORDER_VIEW) ? <Link className="text-primary underline" to={`/sale/${source.saleOrderId}`}>{source.orderNo}</Link> : <span>原单查看权限已变化，请重新打开</span>}
            <span>{source.customerName || '—'}</span><StatusBadge type="sale" status={source.status} /><span>{formatDisplayDateTime(source.createdAt)}</span>
          </div>
          <p className="text-sm">预占记录 {qty(source.reservationQuantity)}；预计绑定 {qty(source.expectedBindingQuantity)}。</p>
          {source.hiddenBindingQuantity !== 0 && <p className="text-xs">无权查看采购来源的绑定：{qty(source.hiddenBindingQuantity)}</p>}
          {source.orphanBindingQuantity !== 0 && <p className="text-xs">绑定来源或明细关联待核对：{qty(source.orphanBindingQuantity)}</p>}
          {source.bindings.map(binding => <div key={binding.bindingId} className="rounded bg-muted/40 p-2 text-xs space-y-1">
            <p>销售行 #{binding.saleOrderItemId} · 绑定数量 {qty(binding.quantity)} · {can(P.PURCHASE_ORDER_VIEW) ? <Link className="text-primary underline" to={`/purchase/${binding.purchase.purchaseOrderId}`}>{binding.purchase.orderNo}</Link> : '采购查看权限已变化'} · 采购行 #{binding.purchase.purchaseItemId} <StatusBadge type="purchase" status={binding.purchase.status} /></p>
            <p>该采购行未上架 {qty(binding.purchase.openQuantity)}，全部有效绑定 {qty(binding.purchase.boundQuantity)}；预计日期 {binding.purchase.expectedDate ? formatDisplayDate(binding.purchase.expectedDate) : '未安排'}。</p>
            {binding.sourceState !== 'expected_supply' && <p>{binding.sourceState === 'putaway_exceeds_order' ? '上架数量超过原采购数量，请核对来源' : '该绑定不在当前预计供给范围，请核对来源'}</p>}
          </div>)}
        </section>)}
        <div className="flex items-center justify-between gap-3 text-sm">
          <Button variant="outline" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>上一页</Button>
          <span>第 {page} / {lastPage} 页 · 共 {data.pagination.total} 张</span>
          <Button variant="outline" disabled={page >= lastPage} onClick={() => setPage(value => value + 1)}>下一页</Button>
        </div>
      </>}
  </div>
}
function QuantitySummary({ summary: s }: { summary: InventoryReservationSummary }) {
  const cells = [
    ['实物在库', s.activeQuantity, '当前有效在库条码的剩余数量'], ['列表在库', s.cacheOnHand, '库存列表中的展示值'], ['已预占', s.reserved, '已登记的预占汇总，含依赖预计入库的占用'],
    ['列表可用', s.available, '列表在库减已预占，最低为零'], ['预计入库', s.expected, '已提交或待审批采购中尚未上架的数量'], ['含预计可承诺', s.atp, '实物在库加预计入库减全部预占，最低为零'],
    ['当前可拣参考', s.pickableQuantity, '未被拣货任务锁住的在库条码；不保证本单可直接发货'], ['预占记录合计', s.reservationQuantity, '当前仍有效的预占记录'], ['预计绑定合计', s.expectedBindingQuantity, '尚未释放的采购依赖，包含已占满和待核对来源'],
  ] as const
  return <div className="space-y-3">
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">{cells.map(([label, value, explanation]) => <div key={label} className="rounded border p-2"><dt className="text-sm">{label}</dt><dd className="tabular-nums font-medium">{qty(value)}</dd><p className="text-xs text-muted-foreground">{explanation}</p></div>)}</dl>
    <p className="text-xs">列表在库与实物差额：{qty(s.cacheDifference)}；已预占与有效记录差额：{qty(s.reservationDifference)}；绑定总量与当前预计范围绑定差额：{qty(s.bindingPoolDifference)}。差额保留原值，请核对，查看明细不会修正库存。</p>
  </div>
}
