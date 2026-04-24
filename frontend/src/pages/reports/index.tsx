import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { getInventoryStatsApi, getPurchaseStatsApi, getSaleStatsApi } from '@/api/reports'
import PageHeader from '@/components/shared/PageHeader'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useWorkspaceStore } from '@/store/workspaceStore'

type SummaryTab = 'purchase' | 'sale' | 'inventory'

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
      <span className="w-24 shrink-0 text-right text-xs">¥{value.toFixed(0)}</span>
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
    <div className={`rounded-2xl border p-5 ${card.tone}`}>
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
  const [applied, setApplied] = useState({ startDate: '', endDate: '' })
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
        hint: '优先看今日处理顺序和最优先待办',
        path: '/reports/role-workbench',
        tabTitle: '岗位工作台',
        tone: 'border-emerald-200 bg-emerald-50',
      },
      {
        title: '异常工作台',
        description: '统一收口收货、出库、物流标签等异常闭环，适合排查打印失败、超时和跨页追踪问题。',
        hint: '优先处理收货异常闭环与物流标签闭环',
        path: '/reports/exception-workbench',
        tabTitle: '异常工作台',
        tone: 'border-amber-200 bg-amber-50',
      },
    ]

    const management: HubCard[] = [
      {
        title: '对账基础版',
        description: '默认优先展示未结清和逾期记录，适合作为客户 / 供应商对账与原单回跳的主入口。',
        hint: '适合先核对余额、状态，再回到原始单据',
        path: '/reports/reconciliation',
        tabTitle: '对账基础版',
        tone: 'border-cyan-200 bg-cyan-50',
      },
      {
        title: '利润 / 库存分析',
        description: '保留轻 BI 方式查看销售毛利、商品毛利、库存金额与滞销库存，并继续支持下钻原始业务。',
        hint: '默认按最近时间范围打开',
        path: '/reports/profit-analysis',
        tabTitle: '利润 / 库存分析',
        tone: 'border-violet-200 bg-violet-50',
      },
      {
        title: '审批与提醒',
        description: '聚合财务与系统级提醒，减少与岗位工作台重复，适合管理角色快速扫一轮风险事项。',
        hint: '顶部优先项只保留财务 / 系统提醒',
        path: '/reports/approvals',
        tabTitle: '审批与提醒',
        tone: 'border-slate-200 bg-slate-50',
      },
    ]

    const performance: HubCard[] = [
      {
        title: '仓库运营看板',
        description: '查看当日出入库、扫码和作业瓶颈，是三张作业绩效页里最适合先开的全局视角。',
        hint: '适合先看当日风险，再下钻任务',
        path: '/reports/warehouse-ops',
        tabTitle: '仓库运营看板',
        tone: 'border-blue-200 bg-blue-50',
      },
      {
        title: '波次效率报表',
        description: '查看波次完成率、耗时与作业效率，优先用于判断拣货与分拣推进卡点。',
        hint: '重点回跳波次详情和仓库任务',
        path: '/reports/wave-performance',
        tabTitle: '波次效率报表',
        tone: 'border-indigo-200 bg-indigo-50',
      },
      {
        title: 'PDA 异常分析',
        description: '追踪扫码错误、撤销与异常条码，适合作为现场扫码问题和培训复盘入口。',
        hint: '重点回跳异常工作台和条码记录',
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

  const activeQ = tab === 'purchase' ? purchaseQ : tab === 'sale' ? saleQ : invQ

  return (
    <div className="space-y-5">
      <PageHeader
        title="报表中心"
        description="按蓝图顺序收口主闭环入口、管理增强入口和作业绩效入口，先处理待办，再看核对与分析。"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => openPage('/reports/role-workbench', '岗位工作台')}>
              今日待办
            </Button>
            <Button variant="outline" onClick={() => openPage('/reports/reconciliation', '对账基础版')}>
              对账核对
            </Button>
            <Button variant="outline" onClick={() => openPage('/reports/exception-workbench', '异常工作台')}>
              异常闭环
            </Button>
          </div>
        }
      />

      <section className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <div className="space-y-1">
          <h2 className="text-card-title">主闭环入口</h2>
          <p className="text-muted-body">先处理今天必须推进的业务闭环，再进入核对、分析和绩效页面。</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {hubGroups.primaryFlow.map(card => (
            <HubEntryCard key={card.path} card={card} onOpen={openPage} />
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <div className="space-y-1">
          <h2 className="text-card-title">管理增强入口</h2>
          <p className="text-muted-body">Phase 2 先把对账、利润 / 库存分析、审批提醒做成日常可依赖的管理闭环。</p>
        </div>
        <div className="grid gap-4 xl:grid-cols-3">
          {hubGroups.management.map(card => (
            <HubEntryCard key={card.path} card={card} onOpen={openPage} />
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <div className="space-y-1">
          <h2 className="text-card-title">作业绩效入口</h2>
          <p className="text-muted-body">三张作业绩效页保持统一筛选、统一空态和统一回跳，建议先看全局，再看波次和 PDA 细项。</p>
        </div>
        <div className="grid gap-4 xl:grid-cols-3">
          {hubGroups.performance.map(card => (
            <HubEntryCard key={card.path} card={card} onOpen={openPage} />
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-card-title">经营总览</h2>
            <p className="text-muted-body">保持采购、销售、库存三类基础统计，作为核对和分析前的总览入口。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-body">日期范围：</span>
            <Input
              type="date"
              value={startDate}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setStartDate(e.target.value)}
              className="w-40"
            />
            <span className="text-muted-body">至</span>
            <Input
              type="date"
              value={endDate}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEndDate(e.target.value)}
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
            {purchaseQ.isLoading && <p className="py-12 text-center text-muted-foreground">加载中...</p>}
            {purchaseQ.data && (
              <>
                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="rounded-xl border border-border bg-card p-5">
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
                  <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="mb-4 text-card-title">供应商排名 Top 10</h3>
                    {!purchaseQ.data.bySupplier.length && <p className="py-6 text-center text-muted-body">暂无数据</p>}
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-table-head">
                          <th className="pb-2 text-left">供应商</th>
                          <th className="pb-2 text-right">单数</th>
                          <th className="pb-2 text-right">金额</th>
                        </tr>
                      </thead>
                      <tbody>
                        {purchaseQ.data.bySupplier.map((row, index) => (
                          <tr key={row.supplierName} className="border-t">
                            <td className="py-1.5">
                              <span className="mr-2 text-muted-foreground">#{index + 1}</span>
                              {row.supplierName}
                            </td>
                            <td className="text-right">{row.orderCount}</td>
                            <td className="text-right font-medium">¥{row.totalAmount.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-card p-5">
                  <h3 className="mb-4 text-card-title">商品采购量 Top 20</h3>
                  {!purchaseQ.data.byProduct.length && <p className="py-6 text-center text-muted-body">暂无数据</p>}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-table-head border-b">
                          <th className="pb-2 text-left">商品</th>
                          <th className="pb-2 text-right">数量</th>
                          <th className="pb-2 text-right">金额</th>
                        </tr>
                      </thead>
                      <tbody>
                        {purchaseQ.data.byProduct.map((row, index) => (
                          <tr key={row.productName} className="border-b last:border-0">
                            <td className="py-1.5">
                              <span className="mr-2 text-muted-foreground">#{index + 1}</span>
                              {row.productName}
                            </td>
                            <td className="text-right">{row.totalQty}</td>
                            <td className="text-right font-medium">¥{row.totalAmount.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {tab === 'sale' && !activeQ.isError && (
          <div className="space-y-6">
            {saleQ.isLoading && <p className="py-12 text-center text-muted-foreground">加载中...</p>}
            {saleQ.data && (
              <>
                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="rounded-xl border border-border bg-card p-5">
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
                  <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="mb-4 text-card-title">客户销售排名 Top 10</h3>
                    {!saleQ.data.byCustomer.length && <p className="py-6 text-center text-muted-body">暂无数据</p>}
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-table-head">
                          <th className="pb-2 text-left">客户</th>
                          <th className="pb-2 text-right">单数</th>
                          <th className="pb-2 text-right">金额</th>
                        </tr>
                      </thead>
                      <tbody>
                        {saleQ.data.byCustomer.map((row, index) => (
                          <tr key={row.customerName} className="border-t">
                            <td className="py-1.5">
                              <span className="mr-2 text-muted-foreground">#{index + 1}</span>
                              {row.customerName}
                            </td>
                            <td className="text-right">{row.orderCount}</td>
                            <td className="text-right font-medium">¥{row.totalAmount.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-card p-5">
                  <h3 className="mb-4 text-card-title">热销商品 Top 20</h3>
                  {!saleQ.data.byProduct.length && <p className="py-6 text-center text-muted-body">暂无数据</p>}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-table-head border-b">
                          <th className="pb-2 text-left">商品</th>
                          <th className="pb-2 text-right">销售量</th>
                          <th className="pb-2 text-right">销售额</th>
                        </tr>
                      </thead>
                      <tbody>
                        {saleQ.data.byProduct.map((row, index) => (
                          <tr key={row.productName} className="border-b last:border-0">
                            <td className="py-1.5">
                              <span className="mr-2 text-muted-foreground">#{index + 1}</span>
                              {row.productName}
                            </td>
                            <td className="text-right">{row.totalQty}</td>
                            <td className="text-right font-medium">¥{row.totalAmount.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {tab === 'inventory' && !activeQ.isError && (
          <div className="space-y-6">
            {invQ.isLoading && <p className="py-12 text-center text-muted-foreground">加载中...</p>}
            {invQ.data && (
              <>
                <div className="grid gap-4 lg:grid-cols-3">
                  {invQ.data.byWarehouse.map(item => (
                    <div key={item.warehouseName} className="rounded-xl border border-border bg-card p-4">
                      <p className="text-sm text-muted-foreground">{item.warehouseName}</p>
                      <p className="mt-1 text-2xl font-bold">{item.totalQty.toFixed(0)}</p>
                      <p className="mt-1 text-helper">总件数 · 价值 ¥{(item.totalValue / 10000).toFixed(2)}万</p>
                    </div>
                  ))}
                  {!invQ.data.byWarehouse.length && (
                    <p className="col-span-3 py-6 text-center text-muted-body">暂无数据</p>
                  )}
                </div>
                <div className="rounded-xl border border-border bg-card p-5">
                  <h3 className="mb-4 text-card-title">商品出入库量 Top 30</h3>
                  {!invQ.data.turnover.length && <p className="py-6 text-center text-muted-body">暂无数据</p>}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-table-head border-b">
                          <th className="pb-2 text-left">编码</th>
                          <th className="pb-2 text-left">名称</th>
                          <th className="pb-2 text-right">单位</th>
                          <th className="pb-2 text-right">入库量</th>
                          <th className="pb-2 text-right">出库量</th>
                          <th className="pb-2 text-right">当前库存</th>
                        </tr>
                      </thead>
                      <tbody>
                        {invQ.data.turnover.map(item => (
                          <tr key={item.code} className="border-b last:border-0">
                            <td className="py-1.5 text-muted-foreground">{item.code}</td>
                            <td className="py-1.5 font-medium">{item.name}</td>
                            <td className="text-right">{item.unit}</td>
                            <td className="text-right text-green-600">+{item.inboundQty}</td>
                            <td className="text-right text-red-500">-{item.outboundQty}</td>
                            <td className="text-right font-semibold">{item.currentQty}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
