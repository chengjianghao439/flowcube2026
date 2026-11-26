import { ChartContainer } from '@/components/shared/ChartContainer'
import { MonthlyAmountChart } from '@/components/shared/MonthlyAmountChart'
import { ChartTooltipContent } from '@/components/shared/ChartPresentation'
import KeepAliveSection from '@/components/shared/KeepAliveSection'
import { EmptyState } from '@/components/shared/EmptyState'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import { productIdentityColumns } from '@/components/shared/productIdentityColumns'
import { Fragment, useId, useReducer, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import type { InventoryStats, TurnoverUnavailableReason } from '@/api/reports'
import { getInventoryStatsApi, getPurchaseStatsApi, getSaleStatsApi, getPurchasePriceTrendApi } from '@/api/reports'
import PageHeader from '@/components/shared/PageHeader'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/shared/DatePicker'
import ProductFinderModal from '@/components/shared/ProductFinderModal'
import { chartGrid, CHART_TONES, axisTick, money } from '@/components/dashboard/chartTheme'
import DataTable from '@/components/shared/DataTable'
import type { TableColumn } from '@/types'
import { todayYmd } from '@/lib/dateTime'

function withRank<T extends object>(rows: T[]): (T & { rank: number })[] {
  return rows.map((row, index) => ({ ...row, rank: index + 1 }))
}

function rankColumn<T extends { rank: number }>(): TableColumn<T> {
  return {
    key: 'rank', title: '排名', width: 70,
    render: v => <span className="text-muted-foreground">#{v as number}</span>,
  }
}

type SummaryTab = 'purchase' | 'sale' | 'inventory'

const turnoverUnavailableText: Record<TurnoverUnavailableReason, string> = {
  date_range_required: '请选择完整且截至今天的日期区间。',
  history_outside_retention: '所选日期已超出库存流水保留窗口，出入库量仅含留存记录。',
  insufficient_movements: '仅有一条库存流水，暂无法核对期间库存。',
  stock_history_unavailable: '库存流水无法与库存数量连续核对。',
}

const turnoverColumns: TableColumn<InventoryStats['turnover'][number] & { rank: number }>[] = [
  { key: 'rank', title: '排名', width: 70, render: v => <span className="text-muted-foreground">#{v as number}</span> },
  { key: 'code', title: '编码', width: 120, render: v => <span className="text-muted-foreground">{String(v)}</span> },
  { key: 'name', title: '名称', width: 180, render: v => <span className="font-medium">{String(v)}</span> },
  { key: 'unit', title: '单位', width: 70 },
  { key: 'inboundQty', title: '入库量', width: 95, render: v => <span className="text-success-ink">+{String(v)}</span> },
  { key: 'outboundQty', title: '出库量', width: 95, render: v => <span className="text-destructive-ink">-{String(v)}</span> },
  { key: 'currentQty', title: '当前库存', width: 100, render: v => <span className="font-semibold">{String(v)}</span> },
  { key: 'periodEndQty', title: '期末库存', width: 95, render: v => v == null ? '—' : String(v) },
  { key: 'avgStock', title: '平均库存', width: 100, render: v => v == null ? '—' : String(v) },
  {
    key: 'turnRate',
    title: '周转率',
    width: 100,
    render: (v, row) => v == null
      ? <span className="text-muted-foreground" title={row.unavailableReason ? turnoverUnavailableText[row.unavailableReason] : undefined}>暂不可用</span>
      : <span className="font-medium tabular-nums">{Number(v).toFixed(2)}</span>,
  },
  {
    key: 'turnDays',
    title: '周转天数',
    width: 100,
    render: v => v == null
      ? <span className="text-muted-foreground">—</span>
      : <span className="font-medium tabular-nums">{Number(v).toFixed(1)}</span>,
  },
]

export default function ReportsPage() {
  const active = useActiveWorkspaceTab()
  const [tab, setTab] = useState<SummaryTab>('purchase')
  const [applied, setApplied] = useState(() => {
    const today = todayYmd()
    return { startDate: today, endDate: today }
  })
  const [startDate, setStartDate] = useState(applied.startDate)
  const [endDate, setEndDate] = useState(applied.endDate)
  const [dateReset, resetDateFields] = useReducer((version: number) => version + 1, 0)
  const dateInputId = useId()
  const rangeInvalid = !!(startDate && endDate && startDate > endDate)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [priceProduct, setPriceProduct] = useState<{ id: number; name: string } | null>(null)

  const summaryTabs: { key: SummaryTab; label: string }[] = [
    { key: 'purchase', label: '采购统计' },
    { key: 'sale', label: '销售统计' },
    { key: 'inventory', label: '库存周转' },
  ]

  const appliedRange = applied.startDate && applied.endDate
    ? `${applied.startDate} 至 ${applied.endDate}`
    : applied.startDate ? `自 ${applied.startDate} 起` : applied.endDate ? `截至 ${applied.endDate}` : '不限'

  const purchaseQ = useQuery({
    queryKey: ['report-purchase', applied],
    queryFn: () => getPurchaseStatsApi(applied),
    enabled: active && tab === 'purchase',
  })
  const saleQ = useQuery({
    queryKey: ['report-sale', applied],
    queryFn: () => getSaleStatsApi(applied),
    enabled: active && tab === 'sale',
  })
  const invQ = useQuery({
    queryKey: ['report-inv', applied],
    queryFn: () => getInventoryStatsApi(applied),
    enabled: active && tab === 'inventory',
  })

  // 采购价格趋势：只在商品已选且位于采购 tab 时请求
  const priceTrendQ = useQuery({
    queryKey: ['report-price-trend', priceProduct?.id, applied],
    queryFn: () => getPurchasePriceTrendApi({ productId: priceProduct!.id, ...applied }),
    enabled: active && tab === 'purchase' && priceProduct != null,
  })

  const activeQ = tab === 'purchase' ? purchaseQ : tab === 'sale' ? saleQ : invQ

  return (
    <div className="space-y-4">
      <PageHeader
        title="报表中心"
        description="查看采购、销售与库存统计。"
      />

      <section className="space-y-4" aria-label="经营总览">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-card-title">经营总览</h2>
            <p role="status" className="text-xs text-muted-foreground">已应用日期：{appliedRange}</p>
          </div>
          <form className="flex flex-wrap items-start gap-2"
            onInvalid={event => event.preventDefault()}
            onSubmit={event => {
              event.preventDefault()
              if (!rangeInvalid) setApplied({ startDate, endDate })
            }}>
            <span className="self-center text-muted-body">日期范围：</span>
            <Fragment key={dateReset}>
              <div className="w-40">
                <label htmlFor={`${dateInputId}-start`} className="sr-only">开始日期</label>
                <DatePicker className="h-9" id={`${dateInputId}-start`} value={startDate} onChange={setStartDate}
                  max={endDate || undefined} aria-invalid={rangeInvalid}
                  aria-describedby={rangeInvalid ? `${dateInputId}-error` : undefined} />
              </div>
              <span className="self-center text-muted-body">至</span>
              <div className="w-40">
                <label htmlFor={`${dateInputId}-end`} className="sr-only">结束日期</label>
                <DatePicker className="h-9" id={`${dateInputId}-end`} value={endDate} onChange={setEndDate}
                  min={startDate || undefined} aria-invalid={rangeInvalid}
                  aria-describedby={rangeInvalid ? `${dateInputId}-error` : undefined} />
              </div>
            </Fragment>
            <Button type="submit" className="h-9" disabled={rangeInvalid}>查询</Button>
            <Button type="button" variant="outline" className="h-9"
              onClick={() => {
                setStartDate('')
                setEndDate('')
                setApplied({ startDate: '', endDate: '' })
                resetDateFields()
              }}>
              重置
            </Button>
            {rangeInvalid && <p id={`${dateInputId}-error`} role="alert" className="basis-full text-xs text-destructive-ink">开始日期不能晚于结束日期。</p>}
          </form>
        </div>

        <div className="fc-segmented-control w-fit" role="group" aria-label="统计维度">
          {summaryTabs.map(item => (
            <button
              key={item.key}
              type="button"
              aria-pressed={tab === item.key}
              onClick={() => setTab(item.key)}
              className="fc-segmented-option"
            >
              {item.label}
            </button>
          ))}
        </div>

        {activeQ.isError && !activeQ.data && (
          <QueryErrorState
            error={activeQ.error}
            onRetry={() => activeQ.refetch()}
            title="报表加载失败"
            description="当前经营总览暂时无法加载，请重试或稍后再试。"
          />
        )}

        <KeepAliveSection active={tab === 'purchase' && !purchaseQ.isError}>
          <div className="space-y-6">
            {purchaseQ.isLoading && <p className="py-12 text-center text-muted-foreground">加载中…</p>}
            {purchaseQ.data && (
              <>
                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="rounded-lg border border-border bg-card p-5">
                    <h3 className="mb-4 text-card-title">按月趋势</h3>
                    {!purchaseQ.data.byMonth.length && <EmptyState variant="no-data" compact />}
                    {!!purchaseQ.data.byMonth.length && <MonthlyAmountChart rows={purchaseQ.data.byMonth} label="采购金额" />}
                  </div>
                  <div className="rounded-lg border border-border bg-card p-5">
                    <h3 className="mb-4 text-card-title">供应商排名 Top 10</h3>
                    <DataTable
                      columns={[
                        rankColumn(),
                        { key: 'supplierName', title: '供应商', width: 180 },
                        { key: 'orderCount', title: '单数', width: 90 },
                        { key: 'totalAmount', title: '金额', width: 120, align: 'right', render: v => <span className="font-medium">{money(Number(v))}</span> },
                      ]}
                      data={withRank(purchaseQ.data.bySupplier)}
                      rowKey="rank"
                      emptyText="暂无数据"
                    />
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-card p-5">
                  <h3 className="mb-4 text-card-title">商品采购量 Top 20</h3>
                  <DataTable
                    columns={[
                      rankColumn(),
                      ...productIdentityColumns(),
                      { key: 'totalQty', title: '数量', width: 90 },
                      { key: 'totalAmount', title: '金额', width: 120, align: 'right', render: v => <span className="font-medium">{money(Number(v))}</span> },
                    ]}
                    data={withRank(purchaseQ.data.byProduct)}
                    rowKey="rank"
                    emptyText="暂无数据"
                  />
                </div>
                <div className="rounded-lg border border-border bg-card p-5">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-card-title">采购价格趋势</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        按商品查看已收齐采购单的月度均价（当前日期范围），便于观察进价波动
                      </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
                      {priceProduct ? `切换商品：${priceProduct.name}` : '选择商品'}
                    </Button>
                  </div>
                  {priceTrendQ.isError && !priceTrendQ.data && (
                    <QueryErrorState error={priceTrendQ.error} onRetry={() => priceTrendQ.refetch()} title="价格趋势加载失败" />
                  )}
                  {!priceProduct ? (
                    <p className="py-8 text-center text-muted-body">先选择商品，查看其采购单价走势</p>
                  ) : priceTrendQ.isLoading ? (
                    <p className="py-8 text-center text-muted-foreground">加载中…</p>
                  ) : priceTrendQ.data && priceTrendQ.data.length > 0 ? (
                    <div className="h-72">
                      <ChartContainer width="100%" height="100%">
                        <LineChart data={priceTrendQ.data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                          <CartesianGrid {...chartGrid} />
                          <XAxis axisLine={false} tickLine={false} tickMargin={10} dataKey="month" padding={{ left: 12, right: 24 }} tick={axisTick} />
                          <YAxis axisLine={false} tickLine={false} tick={axisTick} width={64} tickFormatter={(v) => money(Number(v))} domain={['auto', 'auto']} />
                          <Tooltip
                            formatter={(v) => [money(Number(v ?? 0)), '均价']}
                            content={<ChartTooltipContent />}
                            cursor={{ stroke: 'hsl(var(--border))' }}
                          />
                          <Line type="monotone" dataKey="avgPrice" name="均价" stroke={CHART_TONES.warning} strokeWidth={2} dot={{ r: 2.5, strokeWidth: 0, fill: CHART_TONES.warning }} activeDot={{ r: 4, strokeWidth: 2, stroke: 'hsl(var(--card))' }} />
                        </LineChart>
                      </ChartContainer>
                    </div>
                  ) : (
                    <p className="py-8 text-center text-muted-body">该区间内没有已收齐的采购记录</p>
                  )}
                </div>
              </>
            )}
          </div>
        </KeepAliveSection>

        <KeepAliveSection active={tab === 'sale' && !saleQ.isError}>
          <div className="space-y-6">
            {saleQ.isLoading && <p className="py-12 text-center text-muted-foreground">加载中…</p>}
            {saleQ.data && (
              <>
                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="rounded-lg border border-border bg-card p-5">
                    <h3 className="mb-4 text-card-title">按月销售趋势</h3>
                    {!saleQ.data.byMonth.length && <EmptyState variant="no-data" compact />}
                    {!!saleQ.data.byMonth.length && <MonthlyAmountChart rows={saleQ.data.byMonth} label="销售金额" />}
                  </div>
                  <div className="rounded-lg border border-border bg-card p-5">
                    <h3 className="mb-4 text-card-title">客户销售排名 Top 10</h3>
                    <DataTable
                      columns={[
                        rankColumn(),
                        { key: 'customerName', title: '客户', width: 180 },
                        { key: 'orderCount', title: '单数', width: 90 },
                        { key: 'totalAmount', title: '金额', width: 120, align: 'right', render: v => <span className="font-medium">{money(Number(v))}</span> },
                      ]}
                      data={withRank(saleQ.data.byCustomer)}
                      rowKey="rank"
                      emptyText="暂无数据"
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        </KeepAliveSection>

        <KeepAliveSection active={tab === 'inventory' && !invQ.isError}>
          <div className="space-y-6">
            {invQ.isLoading && <p className="py-12 text-center text-muted-foreground">加载中…</p>}
            {invQ.data && (
              <>
                <div className="rounded-lg border border-border bg-card p-5">
                  <h3 className="mb-4 text-card-title">商品出入库量 Top 30（周转率 / 周转天数）</h3>
                  <DataTable
                    columns={turnoverColumns}
                    data={invQ.data.turnover.map((item, index) => ({ ...item, rank: index + 1 }))}
                    rowKey="rank"
                    emptyText="暂无数据"
                  />
                  <p className="mt-3 text-xs text-muted-foreground">
                    周转率 = 期内出库量 ÷ 平均库存（(期初+期末)÷2）；周转天数 = 期内天数 ÷ 周转率。
                    期末为今天时使用当前库存。没有出库或平均库存为 0 时，周转天数显示 —。
                  </p>
                  {invQ.data.unavailableReason && (
                    <p role="status" className="mt-2 text-xs text-muted-foreground">
                      {turnoverUnavailableText[invQ.data.unavailableReason]}
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        </KeepAliveSection>
      </section>

      <ProductFinderModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onConfirm={(product) => {
          setPriceProduct({ id: product.id, name: product.name })
          setPickerOpen(false)
        }}
      />
    </div>
  )
}
