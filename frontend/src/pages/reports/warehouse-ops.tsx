/**
 * 仓库运营看板
 * 路由：/reports/warehouse-ops
 *
 * 一屏看清仓库全貌：今日核心指标、人员效率、流程瓶颈、每小时趋势、最新错误
 */
import { useQuery } from '@tanstack/react-query'
import { getWarehouseOpsApi } from '@/api/reports'
import PageHeader from '@/components/shared/PageHeader'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { ReportPanel } from '@/components/shared/ReportPanel'
import { Button } from '@/components/ui/button'
import type { OpsOperator, FlowBottleneck } from '@/api/reports'

// ── 数字卡片 ────────────────────────────────────────────────────────────────
function KpiCard({ icon, label, value, sub, danger }: {
  icon: string; label: string; value: string | number; sub?: string; danger?: boolean
}) {
  return (
    <div className={`rounded-xl border p-4 ${danger ? 'border-red-200 bg-red-50' : 'border-border bg-card'}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xl">{icon}</span>
        <p className="text-helper">{label}</p>
      </div>
      <p className={`text-3xl font-bold tabular-nums ${danger ? 'text-red-600' : 'text-foreground'}`}>{value}</p>
      {sub && <p className="text-helper mt-0.5">{sub}</p>}
    </div>
  )
}

// ── 每小时趋势图 ────────────────────────────────────────────────────────────
function HourlyChart({ data }: { data: { hour: string; count: number }[] }) {
  const max = Math.max(...data.map(d => d.count), 1)
  return (
    <div className="flex items-end gap-0.5 h-20">
      {data.map(d => (
        <div key={d.hour} className="flex-1 flex flex-col items-center gap-1 group relative">
          <div
            title={`${d.hour}：${d.count} 次`}
            className="w-full rounded-t bg-primary/60 hover:bg-primary transition-colors"
            style={{ height: `${Math.max(3, (d.count / max) * 72)}px` }}
          />
        </div>
      ))}
    </div>
  )
}

// ── 流程瓶颈条 ─────────────────────────────────────────────────────────────
const FLOW_COLOR: Record<number, string> = {
  1: 'bg-gray-300',
  2: 'bg-blue-400',
  3: 'bg-yellow-400',
  4: 'bg-orange-400',
  5: 'bg-green-400',
}

function FlowBar({ items }: { items: FlowBottleneck[] }) {
  const max = Math.max(...items.map(i => i.count), 1)
  return (
    <div className="space-y-2">
      {items.map(item => (
        <div key={item.status} className="flex items-center gap-3">
          <p className="w-16 shrink-0 text-helper">{item.label}</p>
          <div className="flex-1 h-3 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${FLOW_COLOR[item.status]}`}
              style={{ width: `${Math.max(2, (item.count / max) * 100)}%` }}
            />
          </div>
          <p className="w-8 text-right text-sm font-bold text-foreground">{item.count}</p>
        </div>
      ))}
    </div>
  )
}

// ── 主组件 ──────────────────────────────────────────────────────────────────
export default function WarehouseOpsPage() {
  const warehouseOpsQ = useQuery({
    queryKey: ['warehouse-ops'],
    queryFn:  () => getWarehouseOpsApi().then(r => r.data.data!),
    refetchInterval: 60_000,   // 每分钟自动刷新
  })

  const { data, isLoading, isError, error, dataUpdatedAt, refetch } = warehouseOpsQ

  const s  = data?.summary
  const updatedTime = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '--'

  return (
    <div className="space-y-6">
      {/* 标题栏 */}
      <PageHeader
        title="仓库运营看板"
        description={`实时数据 · 每分钟自动刷新 · 更新于 ${updatedTime}`}
        actions={(
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            立即刷新
          </Button>
        )}
      />

      {isError && !data && (
        <QueryErrorState
          error={error}
          onRetry={() => void refetch()}
          title="仓库运营看板加载失败"
          description="当前仓库运营数据暂时无法加载，请点击重试或稍后再试"
          compact
        />
      )}

      {isLoading && <div className="flex h-40 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>}

      {!isLoading && data && !isError && (<>

        {/* 今日核心指标 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard icon="🚚" label="今日出库单数" value={s?.shippedToday ?? 0} sub="已完成出库" />
          <KpiCard icon="🗂️" label="正在拣货" value={s?.pickingNow ?? 0} sub="进行中任务" />
          <KpiCard icon="📥" label="今日入库" value={s?.inboundToday ?? 0} sub="已完成收货" />
          <KpiCard icon="📊" label="今日扫码" value={s?.scanCount ?? 0} sub={`拣货 ${s?.pickQty ?? 0} 件`} />
          <KpiCard icon="⚠️" label="扫码错误" value={s?.errorCount ?? 0} sub={`错误率 ${s?.errorRate}`} danger={(s?.errorCount ?? 0) > 0} />
          <KpiCard icon="↩️" label="撤销次数" value={s?.undoCount ?? 0} sub="今日" danger={(s?.undoCount ?? 0) > 5} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ReportPanel
            title="流程瓶颈分析"
            description="各步骤任务堆积量"
            helper="用于查看拣货、复核、打包、完成的积压情况"
            empty={data.flowBottleneck.length === 0}
            emptyTitle="暂无流程瓶颈数据"
            emptyDescription="当前时段没有可展示的流程堆积"
          >
            <FlowBar items={data.flowBottleneck} />
          </ReportPanel>

          <ReportPanel
            title="今日作业趋势"
            description="每小时扫码量"
            helper="一眼看出今天哪个时段最忙"
            empty={data.hourlyTrend.length === 0}
            emptyTitle="暂无作业趋势"
            emptyDescription="当前时段没有可展示的扫码趋势"
          >
            <>
              <HourlyChart data={data.hourlyTrend} />
              <div className="flex justify-between mt-1">
                <span className="text-[10px] text-muted-foreground">06:00</span>
                <span className="text-[10px] text-muted-foreground">14:00</span>
                <span className="text-[10px] text-muted-foreground">22:00</span>
              </div>
            </>
          </ReportPanel>

          <ReportPanel
            title="今日人员效率"
            description="按人员展示扫码、错误和效率"
            helper="查看每个操作员的拣货表现"
            empty={data.operators.length === 0}
            emptyTitle="暂无今日人员数据"
            emptyDescription="当前没有可展示的人员效率数据"
          >
            <div className="space-y-3">
              {data.operators.map((op: OpsOperator) => (
                <div key={op.operatorId} className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0">
                    {op.operatorName.slice(0, 1)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-foreground truncate">{op.operatorName}</p>
                      <p className="text-helper shrink-0">{op.pickQty} 件</p>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-muted-foreground">扫码 {op.scanCount}</span>
                      {op.errorCount > 0 && (
                        <span className="text-[10px] text-red-500">错误 {op.errorCount}（{op.errorRate}）</span>
                      )}
                      {op.efficiency && (
                        <span className="text-[10px] text-green-600">{op.efficiency} 件/分</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ReportPanel>

          <ReportPanel
            title="最新异常记录"
            description="最近 10 条异常日志"
            helper="关注扫码错误、撤销和条码问题"
            empty={data.recentErrors.length === 0}
            emptyTitle="暂无异常记录"
            emptyDescription="当前没有可展示的异常日志"
          >
            <div className="space-y-2">
              {data.recentErrors.slice(0, 6).map(e => (
                <div key={e.id} className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-100 px-3 py-2">
                  <span className="text-red-400 shrink-0 mt-0.5">⚠</span>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-red-700 truncate">{e.reason}</p>
                    <p className="text-[10px] text-red-500">{e.operatorName} · {e.barcode} · {new Date(e.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</p>
                  </div>
                </div>
              ))}
            </div>
          </ReportPanel>
        </div>
      </>)}
    </div>
  )
}
