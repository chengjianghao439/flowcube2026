import KeepAliveSection from '@/components/shared/KeepAliveSection'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import { productIdentityColumns } from '@/components/shared/productIdentityColumns'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { DateRangeQueryBar } from '@/components/shared/DateRangeQueryBar'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getMonthDateRange, getRelativeDateRange } from '@/lib/dateRange'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { ReportQueryFeedback } from './ReportQueryFeedback'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { getProfitAnalysisApi, type ProfitSaleOrderRow, type ProfitProductRow, type ProfitStockValueRow, type ProfitSlowMovingRow } from '@/api/reports'
import { downloadExport } from '@/lib/exportDownload'
import { toast } from '@/lib/toast'
import type { TableColumn } from '@/types'

type ProfitTab = 'sale' | 'product' | 'stock' | 'slow'

function SummaryCard({ label, value, hint, negative, onClick }: { label: string; value: number | string; hint: string; negative?: boolean; onClick?: () => void }) {
  const content = <>
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className={`mt-1 break-words text-2xl font-bold tabular-nums ${negative ? 'text-destructive' : 'text-foreground'}`}>{value}</p>
    <p className="mt-1 text-xs leading-5 text-muted-foreground">{hint}</p>
  </>
  const className = 'card-base min-w-0 px-4 py-3 text-left'
  return onClick
    ? <button type="button" aria-label="查看滞销库存明细" className={`${className} transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`} onClick={onClick}>{content}</button>
    : <div className={className}>{content}</div>
}

export default function ProfitAnalysisPage() {
  const active = useActiveWorkspaceTab()
  const navigate = useNavigate()
  const addTab = useWorkspaceStore(s => s.addTab)
  const [tab, setTab] = useState<ProfitTab>('sale')
  const recent30d = getRelativeDateRange(30)
  const recent90d = getRelativeDateRange(90)
  const monthRange = getMonthDateRange()
  const [startDate, setStartDate] = useState(recent30d.startDate)
  const [endDate, setEndDate] = useState(recent30d.endDate)
  const [applied, setApplied] = useState({ startDate: recent30d.startDate, endDate: recent30d.endDate })

  const profitQ = useQuery({
    queryKey: ['profit-analysis', applied],
    enabled: active,
    queryFn: () => getProfitAnalysisApi({
      startDate: applied.startDate || undefined,
      endDate: applied.endDate || undefined,
    }),
  })

  const { data, isLoading, isFetching, isError, error, refetch } = profitQ
  const summary = data?.summary
  const stockRows = useMemo(() => (data?.stockValue ?? []).map(row => ({ ...row, rowId: `${row.id}-${row.warehouseId}` })), [data?.stockValue])
  const money = (value: number | undefined) => value == null ? '—' : `¥${value.toFixed(2)}`

  function openPath(path: string, title: string) {
    addTab({ key: path, title, path })
    navigate(path)
  }

  function applyFilters() {
    setApplied({ startDate, endDate })
  }

  const presetItems = [
    { label: '近 30 天', ...recent30d },
    { label: '近 90 天', ...recent90d },
    { label: '本月', ...monthRange },
  ]

  const saleColumns: TableColumn<ProfitSaleOrderRow>[] = [
    { key: 'orderNo', title: '销售单号', width: 160, render: v => <span className="text-doc-code">{String(v)}</span> },
    { key: 'customerName', title: '客户' },
    { key: 'warehouseName', title: '仓库', width: 120 },
    { key: 'totalAmount', title: '销售额', width: 110, align: 'right', render: v => <span className="font-medium">¥{Number(v).toFixed(2)}</span> },
    { key: 'costAmount', title: '成本', width: 110, align: 'right', render: v => <span className="text-muted-foreground">¥{Number(v).toFixed(2)}</span> },
    { key: 'grossProfit', title: '毛利', width: 110, align: 'right', render: v => <span className={`font-semibold ${Number(v) < 0 ? 'text-destructive' : 'text-success'}`}>¥{Number(v).toFixed(2)}</span> },
    { key: 'marginRate', title: '毛利率', width: 100, align: 'right', render: v => <Badge variant="outline">{Number(v).toFixed(1)}%</Badge> },
    { key: 'path', title: '操作', width: 120, render: v => <Button size="sm" variant="outline" onClick={() => openPath(String(v), '销售单详情')}>打开原单</Button> },
  ]

  const productColumns: TableColumn<ProfitProductRow>[] = [
    ...productIdentityColumns({code: 'code', name: 'name'}),
    { key: 'unit', title: '单位', width: 70 },
    { key: 'totalQty', title: '销售量', width: 90, align: 'right', render: v => <span>{Number(v).toFixed(2)}</span> },
    { key: 'revenueAmount', title: '销售额', width: 110, align: 'right', render: v => <span>¥{Number(v).toFixed(2)}</span> },
    { key: 'costAmount', title: '成本', width: 110, align: 'right', render: v => <span className="text-muted-foreground">¥{Number(v).toFixed(2)}</span> },
    { key: 'grossProfit', title: '毛利', width: 110, align: 'right', render: v => <span className={`font-semibold ${Number(v) < 0 ? 'text-destructive' : 'text-success'}`}>¥{Number(v).toFixed(2)}</span> },
    { key: 'marginRate', title: '毛利率', width: 100, align: 'right', render: v => <Badge variant="outline">{Number(v).toFixed(1)}%</Badge> },
    { key: 'path', title: '操作', width: 120, render: v => <Button size="sm" variant="outline" onClick={() => openPath(String(v), '商品管理')}>查看商品</Button> },
  ]

  const stockColumns: TableColumn<ProfitStockValueRow>[] = [
    ...productIdentityColumns({code: 'code', name: 'name'}),
    { key: 'warehouseName', title: '仓库', width: 120 },
    { key: 'unit', title: '单位', width: 70 },
    { key: 'totalQty', title: '库存数量', width: 100, align: 'right', render: v => <span className="font-medium">{Number(v).toFixed(2)}</span> },
    { key: 'totalValue', title: '库存金额', width: 120, align: 'right', render: v => <span className="font-semibold">¥{Number(v).toFixed(2)}</span> },
    { key: 'path', title: '操作', width: 120, render: v => <Button size="sm" variant="outline" onClick={() => openPath(String(v), '库存总览')}>查看库存</Button> },
  ]

  const slowColumns: TableColumn<ProfitSlowMovingRow>[] = [
    ...productIdentityColumns({ code: 'code', name: 'name' }),
    { key: 'unit', title: '单位', width: 70 },
    { key: 'currentQty', title: '库存数量', width: 110, align: 'right' },
    { key: 'stockValue', title: '库存金额', width: 120, align: 'right', render: v => money(Number(v)) },
    { key: 'lastOutboundAt', title: '最后出库', width: 160, render: v => v ? formatDisplayDateTime(String(v)) : '无出库记录' },
    { key: 'path', title: '操作', width: 120, render: v => <Button size="sm" variant="outline" onClick={() => openPath(String(v), '库存总览')}>查看库存</Button> },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="利润 / 库存分析"
        description="查看已完成销售单的估算毛利与当前库存；销售明细可打开原单，库存明细可进入库存总览。"
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button variant="outline"
              onClick={() => downloadExport('/export/profit-analysis', {
                ...(applied.startDate ? { startDate: applied.startDate } : {}),
                ...(applied.endDate ? { endDate: applied.endDate } : {}),
              }).catch(e => toast.error((e as Error).message))}>
              导出排行榜
            </Button>
            <Button variant="outline" onClick={() => openPath('/sale', '销售订单')}>查看销售订单</Button>
            <Button variant="outline" onClick={() => openPath('/inventory/overview', '库存总览')}>查看库存总览</Button>
            <Button disabled={isFetching} onClick={() => void refetch()}>{isFetching ? '正在刷新…' : '立即刷新'}</Button>
          </div>
        )}
      />

      <div className="grid gap-3 sm:grid-cols-2 min-[960px]:grid-cols-4">
        <SummaryCard label="销售毛利" value={money(summary?.grossProfit)} hint={`销售净额 ${money(summary?.saleAmount)}`} negative={(summary?.grossProfit ?? 0) < 0} />
        <SummaryCard label="销售成本" value={money(summary?.costAmount)} hint="按销售时的成本价计算" />
        <SummaryCard label="库存金额" value={money(summary?.stockValue)} hint="当前账号可查看仓库的全部库存估值" />
        <SummaryCard label="滞销库存" value={summary ? `${summary.slowMovingCount} 种商品` : '—'} hint={`金额 ${money(summary?.slowMovingValue)} · 查看同口径明细`} onClick={() => setTab('slow')} />
      </div>

      <DateRangeQueryBar
        label="销售开单日期"
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
        onApply={applyFilters}
        onReset={() => {
          setStartDate(recent30d.startDate)
          setEndDate(recent30d.endDate)
          setApplied({ startDate: recent30d.startDate, endDate: recent30d.endDate })
        }}
        presets={presetItems}
        onPresetSelect={(preset) => {
          setStartDate(preset.startDate)
          setEndDate(preset.endDate)
          setApplied({ startDate: preset.startDate, endDate: preset.endDate })
        }}
      />

      <p className="text-xs leading-5 text-muted-foreground">日期仅筛选已完成销售单的开单时间。销售净额扣除整单折扣，商品净额按明细金额比例分摊；毛利为净额减成本估算。库存与滞销为当前授权仓库数据，不随日期变化。</p>
      <ReportQueryFeedback title="利润 / 库存分析" hasData={!!data} isError={isError} isFetching={isFetching} error={error} onRetry={() => void refetch()} />

      <div className="flex flex-wrap gap-1 border-b border-border">
        {([
          { key: 'sale' as const, label: '销售毛利' },
          { key: 'product' as const, label: '商品毛利' },
          { key: 'stock' as const, label: '库存金额' },
          { key: 'slow' as const, label: '滞销库存' },
        ]).map(item => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            aria-pressed={tab === item.key}
            className={`px-4 py-2 text-sm font-medium transition-colors ${tab === item.key ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <KeepAliveSection active={tab === 'sale' && (!isError || !!data)}>
        <p className="mb-3 text-xs text-muted-foreground">按毛利展示前 20 单；上方汇总覆盖全部符合条件的销售单。</p>
        <DataTable
          columns={saleColumns}
          data={data?.saleOrders ?? []}
          loading={isLoading}
          emptyText="暂无销售毛利数据"
          onRowDoubleClick={row => openPath(row.path, row.orderNo)}
        />
      </KeepAliveSection>

      <KeepAliveSection active={tab === 'product' && (!isError || !!data)}>
        <p className="mb-3 text-xs text-muted-foreground">按毛利展示前 20 种商品，销售额已分摊整单折扣。</p>
        <DataTable
          columns={productColumns}
          data={data?.products ?? []}
          loading={isLoading}
          emptyText="暂无商品毛利数据"
          onRowDoubleClick={row => openPath(row.path, row.name)}
        />
      </KeepAliveSection>

      <KeepAliveSection active={tab === 'stock' && (!isError || !!data)}>
        <p className="mb-3 text-xs text-muted-foreground">按库存金额展示前 30 条商品与仓库组合；汇总覆盖全部库存。按商品成本价估值，无成本价时参考售价，仅供经营分析。</p>
        <DataTable
          columns={stockColumns}
          data={stockRows}
          rowKey="rowId"
          loading={isLoading}
          emptyText="暂无库存金额数据"
          onRowDoubleClick={row => openPath(row.path, row.name)}
        />
      </KeepAliveSection>
      <KeepAliveSection active={tab === 'slow' && (!isError || !!data)}>
        <p className="mb-3 text-xs leading-5 text-muted-foreground">在授权仓库合并计算：仍有库存，且最近 90 天无出库（含无出库记录）。按金额展示前 30 种商品，上方数量与金额覆盖全部符合条件的商品。</p>
        <DataTable columns={slowColumns} data={data?.slowMoving ?? []} loading={isLoading} emptyText="暂无符合条件的滞销库存" />
        <Button className="mt-3" variant="outline" onClick={() => openPath('/reports/inventory-aging', '存放时长与滞销')}>按仓库查看存放时长与效期</Button>
      </KeepAliveSection>
    </div>
  )
}
