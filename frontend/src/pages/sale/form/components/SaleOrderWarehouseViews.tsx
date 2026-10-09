import DataTable from '@/components/shared/DataTable'
import { EmptyState } from '@/components/shared/EmptyState'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { formatDisplayDateTime } from '@/lib/dateTime'
import type { TableColumn } from '@/types'
import type { SaleOrder, SaleOrderItem } from '@/types/sale'
import type { ScanRow } from '../validate'

export function SaleOrderScanDetails({ order }: { order: SaleOrder }) {
  const hasTask = !!(order.taskNo || order.tasks?.length || order.commercialDispatches?.length)
  return (<div className="card-base p-4">
          {hasTask ? (
            <DataTable
              virtualized
              columns={[
                { key: 'productCode', title: '编码', width: 130 },
                { key: 'articleNumber', title: '供应商型号', width: 110, render: v => (v as string) || '-' },
                { key: 'spec', title: '型号', width: 110, render: v => (v as string) || '-' },
                { key: 'productName', title: '名称', width: 180 },
                { key: 'color', title: '颜色', width: 100, render: v => (v as string) || '-' },
                { key: 'unit', title: '单位', width: 70 },
                { key: 'barcode', title: '条码', width: 140 },
                { key: 'qtyLabel', title: '条码数量', width: 100 },
                { key: 'operatorName', title: '操作人', width: 110, render: v => (v as string) || '-' },
                { key: 'scannedAt', title: '操作时间', width: 150, render: v => v ? formatDisplayDateTime(v as string) : '-' },
              ] satisfies TableColumn<ScanRow>[]}
              data={(order.items ?? []).flatMap((item): ScanRow[] => {
                const scans = item.scans ?? []
                if (scans.length === 0) {
                  return [{
                    rowKey: `${item.id}`, productCode: item.productCode, articleNumber: item.articleNumber,
                    spec: item.spec, productName: item.productName, color: item.color, unit: item.unit,
                    barcode: '-', qtyLabel: `0/${item.quantity}`, operatorName: null, scannedAt: null,
                  }]
                }
                return scans.map((sc, si) => ({
                  rowKey: `${item.id}-${si}`, productCode: item.productCode, articleNumber: item.articleNumber,
                  spec: item.spec, productName: item.productName, color: item.color, unit: item.unit,
                  barcode: sc.barcode, qtyLabel: String(sc.qty), operatorName: sc.operatorName, scannedAt: sc.scannedAt,
                }))
              })}
              rowKey="rowKey"
              emptyText="暂无扫码记录"
            />
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">尚未创建仓库任务</p>
          )}
        </div>)
}

export function SaleOrderPackingDetails({ order }: { order: SaleOrder }) {
  const hasTask = !!(order.taskNo || order.tasks?.length || order.commercialDispatches?.length)
  return (<div className="card-base p-4">
          {hasTask ? (
            <div className="space-y-4">
              {(() => {
                const pkgs = order.packages ?? []
                const done = pkgs.filter(p => p.status === 2).length
                const totalLines = pkgs.reduce((sum, pkg) => sum + pkg.items.length, 0)
                return (
                  <div className="grid grid-cols-4 divide-x rounded-lg border py-3 text-sm">
                    <div className="px-4 text-center">
                      <p className="text-2xl font-semibold tabular-nums">{pkgs.length}</p>
                      <p className="text-xs text-muted-foreground">箱子总数</p>
                    </div>
                    <div className="px-4 text-center">
                      <p className="text-2xl font-semibold tabular-nums text-success-ink">{done}</p>
                      <p className="text-xs text-muted-foreground">已完成</p>
                    </div>
                    <div className="px-4 text-center">
                      <p className="text-2xl font-semibold tabular-nums">{pkgs.length - done}</p>
                      <p className="text-xs text-muted-foreground">未完成</p>
                    </div>
                    <div className="px-4 text-center">
                      <p className="text-2xl font-semibold tabular-nums">{totalLines}</p>
                      <p className="text-xs text-muted-foreground">装箱明细行数</p>
                    </div>
                  </div>
                )
              })()}
              {(order.packages ?? []).length > 0 ? (
                (order.packages ?? []).map(pkg => (
                  <div key={pkg.id} className="rounded-lg border border-border/70 bg-card px-4 py-3">
                    <div className="mb-3 flex items-center justify-between border-b pb-3 text-sm"><span className="font-mono font-medium">{pkg.barcode}</span><SoftStatusLabel label={pkg.status === 2 ? '已完成' : '未完成'} tone={pkg.status === 2 ? 'success' : 'active'} /></div>
                    <DataTable
              virtualized
                      columns={[
                        { key: 'productCode', title: '编码', width: 130 },
                        { key: 'articleNumber', title: '供应商型号', width: 110, render: v => (v as string) || '-' },
                        { key: 'spec', title: '型号', width: 110, render: v => (v as string) || '-' },
                        { key: 'productName', title: '名称', width: 180 },
                        { key: 'color', title: '颜色', width: 100, render: v => (v as string) || '-' },
                        { key: 'unit', title: '单位', width: 70 },
                        { key: 'qty', title: '数量', width: 80 },
                        { key: 'packedAt', title: '操作时间', width: 150, render: v => v ? formatDisplayDateTime(v as string) : '-' },
                      ]}
                      data={pkg.items.map((it, idx) => ({ ...it, rowKey: idx }))}
                      rowKey="rowKey"
                      emptyText="暂无装箱明细"
                    />
                  </div>
                ))
              ) : (
                <EmptyState variant="no-data" title="暂无装箱记录" compact />
              )}
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">尚未创建仓库任务</p>
          )}
        </div>)
}

export function SaleOrderPickingProgress({ order }: { order: SaleOrder }) {
  return ((order.taskNo || order.tasks?.length || order.commercialDispatches?.length) ? <DataTable
                virtualized
                columns={[
                  { key: 'productCode', title: '编码', width: 130 },
                  { key: 'articleNumber', title: '供应商型号', width: 110, render: v => (v as string) || '-' },
                  { key: 'spec', title: '型号', width: 110, render: v => (v as string) || '-' },
                  { key: 'productName', title: '名称', width: 180 },
                  { key: 'color', title: '颜色', width: 100, render: v => (v as string) || '-' },
                  { key: 'unit', title: '单位', width: 70 },
                  { key: 'quantity', title: '订单数量', width: 90, align: 'right' },
                  { key: 'picked', title: '取货数量', width: 90, align: 'right', render: v => <span className="tabular-nums">{Number(v ?? 0)}</span> },
                ] satisfies TableColumn<SaleOrderItem & { picked: number }>[]}
                data={(order.items ?? []).map(item => ({ ...item, picked: (item.scans ?? []).reduce((s, sc) => s + sc.qty, 0) }))}
                rowKey="id"
                emptyText="暂无商品明细"
              /> : null)
}
