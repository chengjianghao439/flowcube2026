import { useSyncExternalStore } from 'react'
import { getApiClientBaseURL, subscribeApiClientBaseURL } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS as P } from '@/lib/permission-codes'
import { qty } from '@/lib/format'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { InventoryOverviewItem, InventoryReservationSummary } from '@/types/inventory'
import { ReservationSnapshotRead } from './ReservationSnapshotRead'

type Item = Pick<InventoryOverviewItem, 'productId' | 'warehouseId' | 'productName' | 'warehouseName' | 'unit'> & Partial<Pick<InventoryOverviewItem, 'productCode' | 'spec' | 'color' | 'articleNumber'>>

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
      <DialogHeader description={!can(P.INVENTORY_VIEW) ? '没有查看库存的权限' : !valid ? '库存商品或仓库信息无效' : '核对预占来源、订单与仓库分布。'}><DialogTitle>库存预占明细</DialogTitle></DialogHeader>
      {open && active && (can(P.INVENTORY_VIEW) ? valid && item
        ? <ReservationSnapshotRead renderSummary={summary => <QuantitySummary summary={summary} />} key={`${owner}:${item.productId}:${item.warehouseId}`} item={item} owner={owner} server={server} generation={generation} />
        : null : null)}
      <DialogFooter><Button variant="outline" onClick={onClose}>关闭</Button></DialogFooter>
    </DialogContent>
  </Dialog>
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
