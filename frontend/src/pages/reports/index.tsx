import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { getPurchaseStatsApi, getSaleStatsApi, getInventoryStatsApi } from '@/api/reports'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useWorkspaceStore } from '@/store/workspaceStore'

type Tab = 'purchase' | 'sale' | 'inventory'

function AmountBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-100 rounded h-3 overflow-hidden">
        <div className="h-full bg-blue-400 rounded" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-right w-24 shrink-0">¥{value.toFixed(0)}</span>
    </div>
  )
}

export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>('purchase')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [applied, setApplied] = useState<{ startDate: string; endDate: string }>({ startDate: '', endDate: '' })
  const addTab = useWorkspaceStore(s => s.addTab)
  const navigate = useNavigate()

  const purchaseQ = useQuery({ queryKey: ['report-purchase', applied], queryFn: () => getPurchaseStatsApi(applied).then(r => r.data.data!), enabled: tab === 'purchase' })
  const saleQ     = useQuery({ queryKey: ['report-sale', applied],     queryFn: () => getSaleStatsApi(applied).then(r => r.data.data!),     enabled: tab === 'sale' })
  const invQ      = useQuery({ queryKey: ['report-inv', applied],      queryFn: () => getInventoryStatsApi(applied).then(r => r.data.data!), enabled: tab === 'inventory' })

  const apply = () => setApplied({ startDate, endDate })

  const tabs: { key: Tab; label: string }[] = [{ key: 'purchase', label: '采购统计' }, { key: 'sale', label: '销售统计' }, { key: 'inventory', label: '库存周转' }]

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">报表中心</h1>
        <p className="text-sm text-muted-foreground mt-1">采购、销售、库存多维度统计分析</p>
        <button
          onClick={() => { addTab({ key: '/reports/exception-workbench', title: '异常工作台', path: '/reports/exception-workbench' }); navigate('/reports/exception-workbench') }}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100 transition-colors"
        >
          🩺 异常工作台
        </button>
        <button
          onClick={() => { addTab({ key: '/reports/pda-anomaly', title: 'PDA 异常分析', path: '/reports/pda-anomaly' }); navigate('/reports/pda-anomaly') }}
          className="mt-2 ml-2 inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 transition-colors"
        >
          ⚠️ PDA 异常分析
        </button>
        <button
          onClick={() => { addTab({ key: '/reports/warehouse-ops', title: '仓库运营看板', path: '/reports/warehouse-ops' }); navigate('/reports/warehouse-ops') }}
          className="mt-2 ml-2 inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 transition-colors"
        >
          📊 仓库运营看板
        </button>
      </div>

      {/* 过滤器 */}
      <div className="flex gap-2 items-center flex-wrap">
        <span className="text-sm text-muted-foreground">日期范围：</span>
        <Input type="date" value={startDate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setStartDate(e.target.value)} className="w-40" />
        <span className="text-sm text-muted-foreground">至</span>
        <Input type="date" value={endDate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEndDate(e.target.value)} className="w-40" />
        <Button onClick={apply}>查询</Button>
        <Button variant="outline" onClick={() => { setStartDate(''); setEndDate(''); setApplied({ startDate: '', endDate: '' }) }}>重置</Button>
      </div>

      {/* Tab */}
      <div className="flex gap-1 border-b">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${tab === t.key ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* 采购统计 */}
      {tab === 'purchase' && (
        <div className="space-y-6">
          {purchaseQ.isLoading && <p className="text-center py-12 text-muted-foreground">加载中...</p>}
          {purchaseQ.data && (<>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white rounded-xl border p-5">
                <h3 className="font-semibold mb-4">按月趋势</h3>
                {!purchaseQ.data.byMonth.length && <p className="text-sm text-muted-foreground text-center py-6">暂无数据</p>}
                {purchaseQ.data.byMonth.map(r => (
                  <div key={r.month} className="mb-2">
                    <div className="flex justify-between text-sm mb-1"><span>{r.month}</span><span className="text-muted-foreground">{r.orderCount}单</span></div>
                    <AmountBar value={r.totalAmount} max={Math.max(...purchaseQ.data!.byMonth.map(x => x.totalAmount))} />
                  </div>
                ))}
              </div>
              <div className="bg-white rounded-xl border p-5">
                <h3 className="font-semibold mb-4">供应商排名 Top 10</h3>
                {!purchaseQ.data.bySupplier.length && <p className="text-sm text-muted-foreground text-center py-6">暂无数据</p>}
                <table className="w-full text-sm"><thead><tr className="text-muted-foreground text-xs"><th className="text-left pb-2">供应商</th><th className="text-right pb-2">单数</th><th className="text-right pb-2">金额</th></tr></thead>
                  <tbody>{purchaseQ.data.bySupplier.map((r, i) => <tr key={r.supplierName} className="border-t"><td className="py-1.5"><span className="text-muted-foreground mr-2">#{i+1}</span>{r.supplierName}</td><td className="text-right">{r.orderCount}</td><td className="text-right font-medium">¥{r.totalAmount.toFixed(2)}</td></tr>)}</tbody>
                </table>
              </div>
            </div>
            <div className="bg-white rounded-xl border p-5">
              <h3 className="font-semibold mb-4">商品采购量 Top 20</h3>
              {!purchaseQ.data.byProduct.length && <p className="text-sm text-muted-foreground text-center py-6">暂无数据</p>}
              <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-muted-foreground text-xs border-b"><th className="text-left pb-2">商品</th><th className="text-right pb-2">数量</th><th className="text-right pb-2">金额</th></tr></thead>
                <tbody>{purchaseQ.data.byProduct.map((r, i) => <tr key={r.productName} className="border-b last:border-0"><td className="py-1.5"><span className="text-muted-foreground mr-2">#{i+1}</span>{r.productName}</td><td className="text-right">{r.totalQty}</td><td className="text-right font-medium">¥{r.totalAmount.toFixed(2)}</td></tr>)}</tbody>
              </table></div>
            </div>
          </>)}
        </div>
      )}

      {/* 销售统计 */}
      {tab === 'sale' && (
        <div className="space-y-6">
          {saleQ.isLoading && <p className="text-center py-12 text-muted-foreground">加载中...</p>}
          {saleQ.data && (<>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white rounded-xl border p-5">
                <h3 className="font-semibold mb-4">按月销售趋势</h3>
                {!saleQ.data.byMonth.length && <p className="text-sm text-muted-foreground text-center py-6">暂无数据</p>}
                {saleQ.data.byMonth.map(r => (
                  <div key={r.month} className="mb-2">
                    <div className="flex justify-between text-sm mb-1"><span>{r.month}</span><span className="text-muted-foreground">{r.orderCount}单</span></div>
                    <AmountBar value={r.totalAmount} max={Math.max(...saleQ.data!.byMonth.map(x => x.totalAmount))} />
                  </div>
                ))}
              </div>
              <div className="bg-white rounded-xl border p-5">
                <h3 className="font-semibold mb-4">客户销售排名 Top 10</h3>
                {!saleQ.data.byCustomer.length && <p className="text-sm text-muted-foreground text-center py-6">暂无数据</p>}
                <table className="w-full text-sm"><thead><tr className="text-muted-foreground text-xs"><th className="text-left pb-2">客户</th><th className="text-right pb-2">单数</th><th className="text-right pb-2">金额</th></tr></thead>
                  <tbody>{saleQ.data.byCustomer.map((r, i) => <tr key={r.customerName} className="border-t"><td className="py-1.5"><span className="text-muted-foreground mr-2">#{i+1}</span>{r.customerName}</td><td className="text-right">{r.orderCount}</td><td className="text-right font-medium">¥{r.totalAmount.toFixed(2)}</td></tr>)}</tbody>
                </table>
              </div>
            </div>
            <div className="bg-white rounded-xl border p-5">
              <h3 className="font-semibold mb-4">热销商品 Top 20</h3>
              <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-muted-foreground text-xs border-b"><th className="text-left pb-2">商品</th><th className="text-right pb-2">销售量</th><th className="text-right pb-2">销售额</th></tr></thead>
                <tbody>{saleQ.data.byProduct.map((r,i)=><tr key={r.productName} className="border-b last:border-0"><td className="py-1.5"><span className="text-muted-foreground mr-2">#{i+1}</span>{r.productName}</td><td className="text-right">{r.totalQty}</td><td className="text-right font-medium">¥{r.totalAmount.toFixed(2)}</td></tr>)}</tbody>
              </table></div>
            </div>
          </>)}
        </div>
      )}

      {/* 库存周转 */}
      {tab === 'inventory' && (
        <div className="space-y-6">
          {invQ.isLoading && <p className="text-center py-12 text-muted-foreground">加载中...</p>}
          {invQ.data && (<>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {invQ.data.byWarehouse.map(w => (
                <div key={w.warehouseName} className="bg-white rounded-xl border p-4">
                  <p className="text-muted-foreground text-sm">{w.warehouseName}</p>
                  <p className="text-2xl font-bold mt-1">{w.totalQty.toFixed(0)}</p>
                  <p className="text-xs text-muted-foreground mt-1">总件数 · 价值 ¥{(w.totalValue / 10000).toFixed(2)}万</p>
                </div>
              ))}
              {!invQ.data.byWarehouse.length && <p className="col-span-3 text-sm text-muted-foreground text-center py-6">暂无数据</p>}
            </div>
            <div className="bg-white rounded-xl border p-5">
              <h3 className="font-semibold mb-4">商品出入库量 Top 30</h3>
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="text-muted-foreground text-xs border-b"><th className="text-left pb-2">编码</th><th className="text-left pb-2">名称</th><th className="text-right pb-2">单位</th><th className="text-right pb-2">入库量</th><th className="text-right pb-2">出库量</th><th className="text-right pb-2">当前库存</th></tr></thead>
                <tbody>{invQ.data.turnover.map(r=>(
                  <tr key={r.code} className="border-b last:border-0">
                    <td className="py-1.5 text-muted-foreground">{r.code}</td>
                    <td className="py-1.5 font-medium">{r.name}</td>
                    <td className="text-right">{r.unit}</td>
                    <td className="text-right text-green-600">+{r.inboundQty}</td>
                    <td className="text-right text-red-500">-{r.outboundQty}</td>
                    <td className="text-right font-semibold">{r.currentQty}</td>
                  </tr>
                ))}</tbody>
              </table></div>
              {!invQ.data.turnover.length && <p className="text-sm text-muted-foreground text-center py-6">暂无数据</p>}
            </div>
          </>)}
        </div>
      )}
    </div>
  )
}
