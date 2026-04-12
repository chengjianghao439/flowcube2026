import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { DateRangeQueryBar } from '@/components/shared/DateRangeQueryBar'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getMonthDateRange, getRelativeDateRange } from '@/lib/dateRange'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { FocusModePanel } from '@/components/shared/FocusModePanel'
import { getProfitAnalysisApi, type ProfitSaleOrderRow, type ProfitProductRow, type ProfitStockValueRow, type ProfitSlowMovingRow } from '@/api/reports'
import type { TableColumn } from '@/types'

type ProfitTab = 'sale' | 'product' | 'stock' | 'slow'

function SummaryCard({ label, value, hint, tone }: { label: string; value: number | string; hint: string; tone: 'blue' | 'amber' | 'emerald' | 'rose' }) {
  const toneClass = tone === 'amber'
    ? 'border-amber-200 bg-amber-50'
    : tone === 'emerald'
      ? 'border-emerald-200 bg-emerald-50'
      : tone === 'rose'
        ? 'border-rose-200 bg-rose-50'
        : 'border-blue-200 bg-blue-50'
  return (
    <div className={`rounded-2xl border px-4 py-3 shadow-sm ${toneClass}`}>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}

export default function ProfitAnalysisPage() {
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
    queryFn: () => getProfitAnalysisApi({
      startDate: applied.startDate || undefined,
      endDate: applied.endDate || undefined,
    }).then(r => r.data.data!),
  })

  const { data, isLoading, isError, error, refetch } = profitQ
  const summary = data?.summary

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
  const currentFocusTitle = tab === 'sale'
    ? '销售毛利优先看最近成交单据'
    : tab === 'product'
      ? '商品毛利优先看高毛利与低毛利商品'
      : tab === 'stock'
        ? '库存金额优先看高金额库存占用'
        : '滞销库存优先看高金额且长期未出库商品'
  const currentFocusSummary = tab === 'sale'
    ? `当前销售单 ${data?.saleOrders.length ?? 0} 条`
    : tab === 'product'
      ? `当前商品 ${data?.products.length ?? 0} 条`
      : tab === 'stock'
        ? `当前库存 ${data?.stockValue.length ?? 0} 条`
        : `当前滞销 ${data?.slowMoving.length ?? 0} 条`

  const saleColumns: TableColumn<ProfitSaleOrderRow>[] = [
    { key: 'orderNo', title: '销售单号', width: 160, render: v => <span className="text-doc-code">{String(v)}</span> },
    { key: 'customerName', title: '客户' },
    { key: 'warehouseName', title: '仓库', width: 120 },
    { key: 'totalAmount', title: '销售额', width: 110, render: v => <span className="font-medium tabular-nums">¥{Number(v).toFixed(2)}</span> },
    { key: 'costAmount', title: '成本', width: 110, render: v => <span className="tabular-nums text-muted-foreground">¥{Number(v).toFixed(2)}</span> },
    { key: 'grossProfit', title: '毛利', width: 110, render: v => <span className="tabular-nums font-semibold text-success">¥{Number(v).toFixed(2)}</span> },
    { key: 'marginRate', title: '毛利率', width: 100, render: v => <Badge variant="outline">{Number(v).toFixed(1)}%</Badge> },
    { key: 'path', title: '操作', width: 120, render: v => <Button size="sm" variant="outline" onClick={() => openPath(String(v), '销售单详情')}>打开原单</Button> },
  ]

  const productColumns: TableColumn<ProfitProductRow>[] = [
    { key: 'code', title: '商品编码', width: 140, render: v => <span className="text-doc-code">{String(v)}</span> },
    { key: 'name', title: '商品名称' },
    { key: 'unit', title: '单位', width: 70 },
    { key: 'totalQty', title: '销售量', width: 90, render: v => <span className="tabular-nums">{Number(v).toFixed(2)}</span> },
    { key: 'revenueAmount', title: '销售额', width: 110, render: v => <span className="tabular-nums">¥{Number(v).toFixed(2)}</span> },
    { key: 'costAmount', title: '成本', width: 110, render: v => <span className="tabular-nums text-muted-foreground">¥{Number(v).toFixed(2)}</span> },
    { key: 'grossProfit', title: '毛利', width: 110, render: v => <span className="tabular-nums font-semibold text-success">¥{Number(v).toFixed(2)}</span> },
    { key: 'marginRate', title: '毛利率', width: 100, render: v => <Badge variant="outline">{Number(v).toFixed(1)}%</Badge> },
    { key: 'path', title: '操作', width: 120, render: v => <Button size="sm" variant="outline" onClick={() => openPath(String(v), '商品管理')}>查看商品</Button> },
  ]

  const stockColumns: TableColumn<ProfitStockValueRow>[] = [
    { key: 'code', title: '商品编码', width: 140, render: v => <span className="text-doc-code">{String(v)}</span> },
    { key: 'name', title: '商品名称' },
    { key: 'warehouseName', title: '仓库', width: 120 },
    { key: 'unit', title: '单位', width: 70 },
    { key: 'totalQty', title: '库存数量', width: 100, render: v => <span className="tabular-nums font-medium">{Number(v).toFixed(2)}</span> },
    { key: 'totalValue', title: '库存金额', width: 120, render: v => <span className="tabular-nums font-semibold">¥{Number(v).toFixed(2)}</span> },
    { key: 'path', title: '操作', width: 120, render: v => <Button size="sm" variant="outline" onClick={() => openPath(String(v), '库存总览')}>查看库存</Button> },
  ]

  const slowColumns: TableColumn<ProfitSlowMovingRow>[] = [
    { key: 'code', title: '商品编码', width: 140, render: v => <span className="text-doc-code">{String(v)}</span> },
    { key: 'name', title: '商品名称' },
    { key: 'unit', title: '单位', width: 70 },
    { key: 'currentQty', title: '现存数量', width: 100, render: v => <span className="tabular-nums font-medium">{Number(v).toFixed(2)}</span> },
    { key: 'stockValue', title: '库存金额', width: 120, render: v => <span className="tabular-nums font-semibold">¥{Number(v).toFixed(2)}</span> },
    { key: 'lastOutboundAt', title: '最近出库', width: 160, render: v => v ? formatDisplayDateTime(String(v)) : <span className="text-muted-foreground">从未出库</span> },
    { key: 'outbound90d', title: '90天出库量', width: 120, render: v => <span className="tabular-nums">{Number(v).toFixed(2)}</span> },
    { key: 'path', title: '操作', width: 120, render: v => <Button size="sm" variant="outline" onClick={() => openPath(String(v), '库存总览')}>查看库存</Button> },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="利润 / 库存分析基础版"
        description="先看销售毛利、商品毛利、库存金额与滞销库存，所有分析都能回跳原始单据或基础管理页。"
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => openPath('/sale', '销售管理')}>查看销售管理</Button>
            <Button variant="outline" onClick={() => openPath('/inventory/overview', '库存总览')}>查看库存总览</Button>
            <Button onClick={() => refetch()}>立即刷新</Button>
          </div>
        )}
      />

      <div className="grid gap-4 md:grid-cols-4">
        <SummaryCard label="销售毛利" value={`¥${(summary?.grossProfit ?? 0).toFixed(2)}`} hint={`销售额 ¥${(summary?.saleAmount ?? 0).toFixed(2)}`} tone="emerald" />
        <SummaryCard label="销售成本" value={`¥${(summary?.costAmount ?? 0).toFixed(2)}`} hint="按销售单明细成本估算" tone="amber" />
        <SummaryCard label="库存金额" value={`¥${(summary?.stockValue ?? 0).toFixed(2)}`} hint="当前库存成本价值" tone="blue" />
        <SummaryCard label="滞销库存" value={summary?.slowMovingCount ?? 0} hint={`金额 ¥${(summary?.slowMovingValue ?? 0).toFixed(2)}`} tone="rose" />
      </div>

      <FocusModePanel
        badge="轻 BI 默认视角"
        title={currentFocusTitle}
        description="利润 / 库存分析保持轻量，不做复杂 BI；建议先看最近区间，再从高金额、高影响项下钻回原始业务。"
        summary={currentFocusSummary}
        steps={[
          '先保留最近时间范围',
          '优先查看高金额或高风险项',
          '再回跳原单、商品或库存总览',
        ]}
        actions={[
          { label: '销售毛利', variant: tab === 'sale' ? 'default' : 'outline', onClick: () => setTab('sale') },
          { label: '商品毛利', variant: tab === 'product' ? 'default' : 'outline', onClick: () => setTab('product') },
          { label: '库存金额', variant: tab === 'stock' ? 'default' : 'outline', onClick: () => setTab('stock') },
          { label: '滞销库存', variant: tab === 'slow' ? 'default' : 'outline', onClick: () => setTab('slow') },
        ]}
      />

      <DateRangeQueryBar
        label="统计日期"
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

      {isError && !data && (
        <QueryErrorState
          error={error}
          onRetry={() => void refetch()}
          title="利润 / 库存分析加载失败"
          description="当前利润分析数据暂时无法加载，请点击重试或稍后再试"
          compact
        />
      )}

      <div className="flex gap-1 border-b border-border">
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
            className={`px-4 py-2 text-sm font-medium transition-colors ${tab === item.key ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'sale' && !isError && (
        <DataTable
          columns={saleColumns}
          data={data?.saleOrders ?? []}
          loading={isLoading}
          emptyText="暂无销售毛利数据"
          onRowDoubleClick={row => openPath(row.path, row.orderNo)}
        />
      )}

      {tab === 'product' && !isError && (
        <DataTable
          columns={productColumns}
          data={data?.products ?? []}
          loading={isLoading}
          emptyText="暂无商品毛利数据"
          onRowDoubleClick={row => openPath(row.path, row.name)}
        />
      )}

      {tab === 'stock' && !isError && (
        <DataTable
          columns={stockColumns}
          data={data?.stockValue ?? []}
          loading={isLoading}
          emptyText="暂无库存金额数据"
          onRowDoubleClick={row => openPath(row.path, row.name)}
        />
      )}

      {tab === 'slow' && !isError && (
        <DataTable
          columns={slowColumns}
          data={data?.slowMoving ?? []}
          loading={isLoading}
          emptyText="暂无滞销库存数据"
          onRowDoubleClick={row => openPath(row.path, row.name)}
        />
      )}
    </div>
  )
}
