/**
 * 来料质检合格率报表（文档07 Phase3）
 * 按供应商汇总质检量/合格量/拒收量/合格率 + 拒收品处置去向（退供应商/报废）。只读。
 * 路由：/reports/qa-quality（权限 REPORT_VIEW）
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { FilterCard } from '@/components/shared/FilterCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { getQaSupplierReportApi, type QaSupplierReportRow } from '@/api/inbound-tasks'
import type { TableColumn } from '@/types'

const fmtQty = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? (Number.isInteger(n) ? n.toLocaleString() : n.toFixed(2)) : '—' }
const rateTone = (r: number): 'success' | 'warning' | 'danger' => (r >= 98 ? 'success' : r >= 90 ? 'warning' : 'danger')

function StatCard({ label, value, tone }: { label: string; value: string; tone?: 'success' | 'danger' | 'warning' }) {
  const color = tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-destructive' : tone === 'warning' ? 'text-warning' : 'text-foreground'
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-helper">{label}</p>
      <p className={`text-2xl font-semibold tabular-nums ${color}`}>{value}</p>
    </div>
  )
}

export default function QaQualityReportPage() {
  const today = new Date().toISOString().slice(0, 10)
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  const [startDate, setStartDate] = useState(monthAgo)
  const [endDate, setEndDate] = useState(today)
  const [range, setRange] = useState({ startDate: monthAgo, endDate: today })

  const q = useQuery({
    queryKey: ['qa-supplier-report', range],
    queryFn: () => getQaSupplierReportApi(range),
  })
  const list = q.data?.list ?? []
  const summary = q.data?.summary

  const cols: TableColumn<QaSupplierReportRow>[] = [
    { key: 'supplierName', title: '供应商', render: v => <span className="font-medium">{String(v)}</span> },
    { key: 'taskCount', title: '质检批次', width: 90, align: 'right', render: v => <span className="tabular-nums text-muted-foreground">{fmtQty(v)}</span> },
    { key: 'checkedQty', title: '质检量', width: 90, align: 'right', render: v => <span className="tabular-nums">{fmtQty(v)}</span> },
    { key: 'passedQty', title: '合格量', width: 90, align: 'right', render: v => <span className="tabular-nums text-success">{fmtQty(v)}</span> },
    { key: 'concessionQty', title: '让步接收', width: 90, align: 'right', render: v => Number(v) > 0 ? <span className="tabular-nums text-warning">{fmtQty(v)}</span> : <span className="text-muted-foreground">—</span> },
    { key: 'rejectedQty', title: '拒收量', width: 90, align: 'right', render: v => <span className={`tabular-nums ${Number(v) > 0 ? 'font-medium text-destructive' : 'text-muted-foreground'}`}>{fmtQty(v)}</span> },
    { key: 'passRate', title: '合格率', width: 100, align: 'right', render: v => <SoftStatusLabel label={`${Number(v).toFixed(2)}%`} tone={rateTone(Number(v))} /> },
    { key: 'strictPassRate', title: '严格合格率', width: 110, align: 'right', render: (v, row) => Number(row.concessionQty) > 0 ? <SoftStatusLabel label={`${Number(v).toFixed(2)}%`} tone={rateTone(Number(v))} /> : <span className="text-muted-foreground">—</span> },
    { key: 'returnQty', title: '退供应商', width: 90, align: 'right', render: v => Number(v) > 0 ? <span className="tabular-nums text-warning">{fmtQty(v)}</span> : <span className="text-muted-foreground">—</span> },
    { key: 'scrapQty', title: '报废', width: 80, align: 'right', render: v => Number(v) > 0 ? <span className="tabular-nums text-destructive">{fmtQty(v)}</span> : <span className="text-muted-foreground">—</span> },
  ]

  return (
    <div className="space-y-4">
      <PageHeader title="来料质检合格率" description="按供应商汇总质检量、合格量（含让步接收）、拒收量与合格率，并区分严格合格率（扣除让步接收）；展示拒收品处置去向（退供应商/报废）。仅统计已开启来料质检并完成质检的收货明细。" />
      <FilterCard>
        <div className="flex flex-wrap items-end gap-3">
          <div><label className="text-helper block mb-1">起始日期</label><Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-40" /></div>
          <div><label className="text-helper block mb-1">结束日期</label><Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-40" /></div>
          <Button onClick={() => setRange({ startDate, endDate })}>查询</Button>
        </div>
      </FilterCard>

      {summary && summary.checkedQty > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <StatCard label="质检总量" value={fmtQty(summary.checkedQty)} />
          <StatCard label="合格量（含让步）" value={fmtQty(summary.passedQty)} tone="success" />
          <StatCard label="让步接收量" value={fmtQty(summary.concessionQty)} tone={summary.concessionQty > 0 ? 'warning' : undefined} />
          <StatCard label="拒收量" value={fmtQty(summary.rejectedQty)} tone="danger" />
          <StatCard label="合格率（含让步）" value={`${summary.passRate.toFixed(2)}%`} tone={rateTone(summary.passRate)} />
          <StatCard label="严格合格率（扣让步）" value={`${summary.strictPassRate.toFixed(2)}%`} tone={rateTone(summary.strictPassRate)} />
        </div>
      )}

      <DataTable columns={cols} data={list} loading={q.isLoading} rowKey="supplierName" emptyText="所选区间无来料质检数据（需商品/供应商开启来料质检并完成质检后才有统计）" />
    </div>
  )
}
