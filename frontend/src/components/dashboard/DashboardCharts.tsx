import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

interface TrendPoint {
  date: string
  入库: number
  出库: number
}

interface TopPoint {
  name: string
  价值: number
}

interface TopStockRow {
  code: string
  name: string
  value: number
}

function SectionCard({ title, children }: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="card-base p-5">
      <div className="mb-4 flex items-center gap-2">
        <h2 className="text-section-title">{title}</h2>
      </div>
      {children}
    </div>
  )
}

export default function DashboardCharts({
  trendData,
  topData,
  topStock,
}: {
  trendData: TrendPoint[]
  topData: TopPoint[]
  topStock: TopStockRow[]
}) {
  return (
    <>
      <SectionCard title="近 7 天出入库趋势">
        {trendData.length === 0 ? (
          <p className="text-muted-body py-8 text-center">暂无数据</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trendData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} className="text-muted-foreground" />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip
                contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))', fontSize: 12 }}
              />
              <Legend />
              <Line type="monotone" dataKey="入库" stroke="hsl(var(--success))" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="出库" stroke="hsl(var(--destructive))" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </SectionCard>

      <SectionCard title="库存价值 Top 10">
        {topData.length === 0 ? (
          <p className="text-muted-body py-8 text-center">暂无数据</p>
        ) : (
          <div className="flex gap-6">
            <div className="flex-1">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={topData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickFormatter={v => v >= 10000 ? `${(v / 10000).toFixed(1)}万` : String(v)}
                  />
                  <Tooltip
                    formatter={(v) => [`¥${Number(v).toLocaleString()}`, '库存价值']}
                    contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))', fontSize: 12 }}
                  />
                  <Bar dataKey="价值" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="w-56 shrink-0 overflow-y-auto" style={{ maxHeight: 240 }}>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="pb-2 text-left font-medium">#</th>
                    <th className="pb-2 text-left font-medium">名称</th>
                    <th className="pb-2 text-right font-medium">价值</th>
                  </tr>
                </thead>
                <tbody>
                  {topStock.map((item, i) => (
                    <tr key={item.code} className="border-b last:border-0">
                      <td className="py-1.5 text-muted-foreground">{i + 1}</td>
                      <td className="max-w-20 truncate py-1.5">{item.name}</td>
                      <td className="py-1.5 text-right font-medium text-primary">
                        ¥{item.value.toFixed(0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </SectionCard>
    </>
  )
}
