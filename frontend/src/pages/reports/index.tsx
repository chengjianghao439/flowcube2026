import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { getInventoryStatsApi, getPurchaseStatsApi, getSaleStatsApi, getPurchasePriceTrendApi } from '@/api/reports'
import PageHeader from '@/components/shared/PageHeader'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/shared/DatePicker'
import ProductFinderModal from '@/components/shared/ProductFinderModal'
import { chartTooltip, axisTick, money } from '@/components/dashboard/chartTheme'
import { useWorkspaceStore } from '@/store/workspaceStore'
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

/** 库存周转明细列：周转率/周转天数由后端按（期初+期末）/2 口径计算 */
const turnoverColumns: TableColumn<{
  code: string
  name: string
  unit: string
  inboundQty: number
  outboundQty: number
  currentQty: number
  avgStock: number
  turnRate: number
  turnDays: number | null
  rank: number
}>[] = [
  { key: 'rank', title: '排名', width: 70, render: v => <span className="text-muted-foreground">#{v as number}</span> },
  { key: 'code', title: '编码', width: 120, render: v => <span className="text-muted-foreground">{String(v)}</span> },
  { key: 'name', title: '名称', width: 180, render: v => <span className="font-medium">{String(v)}</span> },
  { key: 'unit', title: '单位', width: 70 },
  { key: 'inboundQty', title: '入库量', width: 95, render: v => <span className="text-green-600">+{String(v)}</span> },
  { key: 'outboundQty', title: '出库量', width: 95, render: v => <span className="text-red-500">-{String(v)}</span> },
  { key: 'currentQty', title: '当前库存', width: 100, render: v => <span className="font-semibold">{String(v)}</span> },
  { key: 'avgStock', title: '平均库存', width: 100, render: v => <span className="text-muted-foreground">{String(v)}</span> },
  { key: 'turnRate', title: '周转率', width: 90, render: v => <span className="font-medium tabular-nums">{Number(v).toFixed(2)}</span> },
  {
    key: 'turnDays',
    title: '周转天数',
    width: 100,
    render: v => v == null
      ? <span className="text-muted-foreground">—</span>
      : <span className="font-medium tabular-nums">{Number(v).toFixed(1)}</span>,
  },
]

type HubCard = {
  title: string
  description: string
  hint: string
  path: string
  tabTitle: string
  tone: string
}

function AmountBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div className="flex items-center gap-2">
      <div className="h-3 flex-1 overflow-hidden rounded bg-gray-100">
        <div className="h-full rounded bg-blue-400" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-24 shrink-0 text-left text-xs">¥{value.toFixed(0)}</span>
    </div>
  )
}

function HubEntryCard({
  card,
  onOpen,
}: {
  card: HubCard
  onOpen: (path: string, title: string) => void
}) {
  return (
    <div className={`rounded-lg border p-5 ${card.tone}`}>
      <div className="space-y-2">
        <p className="text-helper">推荐入口</p>
        <h3 className="text-card-title">{card.title}</h3>
        <p className="text-muted-body min-h-[44px]">{card.description}</p>
        <p className="text-helper">{card.hint}</p>
      </div>
      <div className="mt-4">
        <Button onClick={() => onOpen(card.path, card.tabTitle)}>进入处理</Button>
      </div>
    </div>
  )
}

export default function ReportsPage() {
  const [tab, setTab] = useState<SummaryTab>('purchase')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [applied, setApplied] = useState({ startDate: todayYmd(), endDate: todayYmd() })
  const [pickerOpen, setPickerOpen] = useState(false)
  const [priceProduct, setPriceProduct] = useState<{ id: number; name: string } | null>(null)
  const addTab = useWorkspaceStore(s => s.addTab)
  const navigate = useNavigate()

  const openPage = (path: string, title: string) => {
    addTab({ key: path, title, path })
    navigate(path)
  }

  const hubGroups = useMemo(() => {
    const primaryFlow: HubCard[] = [
      {
        title: '岗位工作台',
        description: '按仓库、销售客服、管理角色聚合今日最该先处理的待办，适合作为日常进入系统后的第一站。',
        hint: '优先处理今日待办和最紧急事项',
        path: '/reports/role-workbench',
        tabTitle: '岗位工作台',
        tone: 'border-emerald-200 bg-emerald-50',
      },
    ]

    const management: HubCard[] = [
      {
        title: '供应商对账',
        description: '按时间范围核对采购应付账单，未结清和逾期记录会优先展示，可从对账单直接打开采购单与收货单。',
        hint: '适合先核对余额、状态，再回到原始单据',
        path: '/reports/reconciliation/payable',
        tabTitle: '供应商对账',
        tone: 'border-cyan-200 bg-cyan-50',
      },
      {
        title: '客户对账',
        description: '按时间范围核对销售应收账单，未结清和逾期记录会优先展示，可从对账单直接打开销售单。',
        hint: '适合先核对余额、状态，再回到原始单据',
        path: '/reports/reconciliation/receivable',
        tabTitle: '客户对账',
        tone: 'border-cyan-200 bg-cyan-50',
      },
      {
        title: '利润 / 库存分析',
        description: '用轻量化方式查看销售毛利、商品毛利、库存金额与滞销库存，可从结果直接打开原始单据。',
        hint: '默认按最近时间范围打开',
        path: '/reports/profit-analysis',
        tabTitle: '利润 / 库存分析',
        tone: 'border-violet-200 bg-violet-50',
      },
    ]

    const performance: HubCard[] = [
      {
        title: '仓库运营看板',
        description: '查看当日出入库、扫码量和作业瓶颈，是作业绩效页里最适合先打开的全局视角。',
        hint: '适合先看当日风险，再查看任务明细',
        path: '/reports/warehouse-ops',
        tabTitle: '仓库运营看板',
        tone: 'border-blue-200 bg-blue-50',
      },
      {
        title: '波次效率',
        description: '查看波次完成率、耗时与作业效率，用于判断拣货和分拣卡在哪里。',
        hint: '重点查看波次详情和仓库任务',
        path: '/reports/wave-performance',
        tabTitle: '波次效率',
        tone: 'border-indigo-200 bg-indigo-50',
      },
      {
        title: 'PDA 异常分析',
        description: '追踪扫码错误、撤销操作与异常条码，适合作为现场扫码问题排查和培训复盘的入口。',
        hint: '重点查看异常工作台和条码记录',
        path: '/reports/pda-anomaly',
        tabTitle: 'PDA 异常分析',
        tone: 'border-rose-200 bg-rose-50',
      },
    ]

    return { primaryFlow, management, performance }
  }, [])

  const summaryTabs: { key: SummaryTab; label: string }[] = [
    { key: 'purchase', label: '采购统计' },
    { key: 'sale', label: '销售统计' },
    { key: 'inventory', label: '库存周转' },
  ]

  const apply = () => setApplied({ startDate, endDate })

  const purchaseQ = useQuery({
    queryKey: ['report-purchase', applied],
    queryFn: () => getPurchaseStatsApi(applied),
    enabled: tab === 'purchase',
  })
  const saleQ = useQuery({
    queryKey: ['report-sale', applied],
    queryFn: () => getSaleStatsApi(applied),
    enabled: tab === 'sale',
  })
  const invQ = useQuery({
    queryKey: ['report-inv', applied],
    queryFn: () => getInventoryStatsApi(applied),
    enabled: tab === 'inventory',
  })

  // 采购价格趋势：只在商品已选且位于采购 tab 时请求
  const priceTrendQ = useQuery({
    queryKey: ['report-price-trend', priceProduct?.id, applied],
    queryFn: () => getPurchasePriceTrendApi({ productId: priceProduct!.id, ...applied }),
    enabled: tab === 'purchase' && priceProduct != null,
  })

  const activeQ = tab === 'purchase' ? purchaseQ : tab === 'sale' ? saleQ : invQ

  return (
    <div className="space-y-5">
      <PageHeader
        title="报表中心"
        description="集中进入待办处理、往来对账、利润分析与作业绩效报表；先处理待办，再看核对与分析。"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => openPage('/reports/role-workbench', '岗位工作台')}>
              今日待办
            </Button>
            <Button variant="outline" onClick={() => openPage('/reports/reconciliation/payable', '供应商对账')}>
              供应商对账
            </Button>
            <Button variant="outline" onClick={() => openPage('/reports/reconciliation/receivable', '客户对账')}>
              客户对账
            </Button>
          </div>
        }
      />

      <section className="rounded-lg border border-border bg-card p-5 space-y-4">
        <div className="space-y-1">
          <h2 className="text-card-title">每日待办</h2>
          <p className="text-muted-body">先处理今天必须推进的事项，再进入核对、分析和绩效页面。</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {hubGroups.primaryFlow.map(card => (
            <HubEntryCard key={card.path} card={card} onOpen={openPage} />
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-5 space-y-4">
        <div className="space-y-1">
          <h2 className="text-card-title">对账与分析</h2>
          <p className="text-muted-body">对账、利润 / 库存分析是日常核对与管理依赖的常用入口。</p>
        </div>
        <div className="grid gap-4 xl:grid-cols-3">
          {hubGroups.management.map(card => (
            <HubEntryCard key={card.path} card={card} onOpen={openPage} />
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-5 space-y-4">
        <div className="space-y-1">
          <h2 className="text-card-title">作业绩效</h2>
          <p className="text-muted-body">三张作业绩效页保持统一的筛选和空态展示，建议先看全局，再看波次和 PDA 细项。</p>
        </div>
        <div className="grid gap-4 xl:grid-cols-3">
          {hubGroups.performance.map(card => (
            <HubEntryCard key={card.path} card={card} onOpen={openPage} />
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-card-title">经营总览</h2>
            <p className="text-muted-body">保持采购、销售、库存三类基础统计，作为核对和分析前的总览入口。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-body">日期范围：</span>
            <DatePicker
              value={startDate}
              onChange={setStartDate}
              max={endDate || undefined}
              className="w-40"
            />
            <span className="text-muted-body">至</span>
            <DatePicker
              value={endDate}
              onChange={setEndDate}
              min={startDate || undefined}
              className="w-40"
            />
            <Button onClick={apply}>查询</Button>
            <Button
              variant="outline"
              onClick={() => {
                setStartDate('')
                setEndDate('')
                setApplied({ startDate: '', endDate: '' })
              }}
            >
              重置
            </Button>
          </div>
        </div>

        <div className="flex gap-1 border-b">
          {summaryTabs.map(item => (
            <button
              key={item.key}
              onClick={() => setTab(item.key)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                tab === item.key
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
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

        {tab === 'purchase' && !activeQ.isError && (
          <div className="space-y-6">
            {purchaseQ.isLoading && <p className="py-12 text-center text-muted-foreground">加载中…</p>}
            {purchaseQ.data && (
              <>
                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="rounded-lg border border-border bg-card p-5">
                    <h3 className="mb-4 text-card-title">按月趋势</h3>
                    {!purchaseQ.data.byMonth.length && <p className="py-6 text-center text-muted-body">暂无数据</p>}
                    {purchaseQ.data.byMonth.map(row => (
                      <div key={row.month} className="mb-2">
                        <div className="mb-1 flex justify-between text-sm">
                          <span>{row.month}</span>
                          <span className="text-muted-foreground">{row.orderCount} 单</span>
                        </div>
                        <AmountBar
                          value={row.totalAmount}
                          max={Math.max(...purchaseQ.data!.byMonth.map(item => item.totalAmount))}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="rounded-lg border border-border bg-card p-5">
                    <h3 className="mb-4 text-card-title">供应商排名 Top 10</h3>
                    <DataTable
                      columns={[
                        rankColumn(),
                        { key: 'supplierName', title: '供应商', width: 180 },
                        { key: 'orderCount', title: '单数', width: 90 },
                        { key: 'totalAmount', title: '金额', width: 120, render: v => <span className="font-medium">¥{Number(v).toFixed(2)}</span> },
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
                      { key: 'productName', title: '商品', width: 180 },
                      { key: 'totalQty', title: '数量', width: 90 },
                      { key: 'totalAmount', title: '金额', width: 120, render: v => <span className="font-medium">¥{Number(v).toFixed(2)}</span> },
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
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={priceTrendQ.data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="month" tick={axisTick} />
                          <YAxis tick={axisTick} width={64} tickFormatter={(v) => money(Number(v))} domain={['auto', 'auto']} />
                          <Tooltip
                            formatter={(v) => [money(Number(v ?? 0)), '均价']}
                            contentStyle={chartTooltip}
                            cursor={{ stroke: 'hsl(var(--border))' }}
                          />
                          <Line type="monotone" dataKey="avgPrice" name="均价" stroke="hsl(var(--warning))" strokeWidth={2} dot={{ r: 3 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <p className="py-8 text-center text-muted-body">该区间内没有已收齐的采购记录</p>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {tab === 'sale' && !activeQ.isError && (
          <div className="space-y-6">
            {saleQ.isLoading && <p className="py-12 text-center text-muted-foreground">加载中…</p>}
            {saleQ.data && (
              <>
                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="rounded-lg border border-border bg-card p-5">
                    <h3 className="mb-4 text-card-title">按月销售趋势</h3>
                    {!saleQ.data.byMonth.length && <p className="py-6 text-center text-muted-body">暂无数据</p>}
                    {saleQ.data.byMonth.map(row => (
                      <div key={row.month} className="mb-2">
                        <div className="mb-1 flex justify-between text-sm">
                          <span>{row.month}</span>
                          <span className="text-muted-foreground">{row.orderCount} 单</span>
                        </div>
                        <AmountBar
                          value={row.totalAmount}
                          max={Math.max(...saleQ.data!.byMonth.map(item => item.totalAmount))}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="rounded-lg border border-border bg-card p-5">
                    <h3 className="mb-4 text-card-title">客户销售排名 Top 10</h3>
                    <DataTable
                      columns={[
                        rankColumn(),
                        { key: 'customerName', title: '客户', width: 180 },
                        { key: 'orderCount', title: '单数', width: 90 },
                        { key: 'totalAmount', title: '金额', width: 120, render: v => <span className="font-medium">¥{Number(v).toFixed(2)}</span> },
                      ]}
                      data={withRank(saleQ.data.byCustomer)}
                      rowKey="rank"
                      emptyText="暂无数据"
                    />
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-card p-5">
                  <h3 className="mb-4 text-card-title">热销商品 Top 20</h3>
                  <DataTable
                    columns={[
                      rankColumn(),
                      { key: 'productName', title: '商品', width: 180 },
                      { key: 'totalQty', title: '销售量', width: 90 },
                      { key: 'totalAmount', title: '销售额', width: 120, render: v => <span className="font-medium">¥{Number(v).toFixed(2)}</span> },
                    ]}
                    data={withRank(saleQ.data.byProduct)}
                    rowKey="rank"
                    emptyText="暂无数据"
                  />
                </div>
              </>
            )}
          </div>
        )}

        {tab === 'inventory' && !activeQ.isError && (
          <div className="space-y-6">
            {invQ.isLoading && <p className="py-12 text-center text-muted-foreground">加载中…</p>}
            {invQ.data && (
              <>
                <div className="grid gap-4 lg:grid-cols-3">
                  {invQ.data.byWarehouse.map(item => (
                    <div key={item.warehouseName} className="rounded-lg border border-border bg-card p-4">
                      <p className="text-sm text-muted-foreground">{item.warehouseName}</p>
                      <p className="mt-1 text-2xl font-bold">{item.totalQty.toFixed(0)}</p>
                      <p className="mt-1 text-helper">总件数 · 价值 ¥{(item.totalValue / 10000).toFixed(2)}万</p>
                    </div>
                  ))}
                  {!invQ.data.byWarehouse.length && (
                    <p className="col-span-3 py-6 text-center text-muted-body">暂无数据</p>
                  )}
                </div>
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
                    「平均库存」为 0 或仅 1 条流水、以及未选完整日期区间时，周转天数显示 —。
                  </p>
                </div>
              </>
            )}
          </div>
        )}
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
