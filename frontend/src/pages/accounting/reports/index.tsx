/**
 * 会计报表（文档 10 · Phase 2 简版）：利润表 / 资产负债表 / 现金流量表。
 * 简版口径：利润表=主营收入−成本−费用；资产负债表=资产 vs 负债+权益+未分配利润；
 * 现金流量表从资金流水归集。数字与勾稽一律以接口为准，前端只渲染。
 */
import { useState } from 'react'
import { CheckCircle2, AlertTriangle } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import PageHeader from '@/components/shared/PageHeader'
import { cn } from '@/lib/utils'
import { useIncomeStatement, useBalanceSheet, useCashFlow } from '@/hooks/useLedger'
import type { ReportRow, BalanceSheetItem } from '@/types/accounting'

type Tab = 'income' | 'balance' | 'cashflow'
const currentPeriod = () => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}` }
const m = (n: number) => (Number(n) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'income', label: '利润表' },
  { key: 'balance', label: '资产负债表' },
  { key: 'cashflow', label: '现金流量表' },
]

function SimpleReport({ rows, loading }: { rows: ReportRow[]; loading: boolean }) {
  if (loading) return <div className="py-12 text-center text-sm text-muted-foreground">加载中...</div>
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className={cn('border-b border-border/40', r.bold && 'bg-muted/20 font-semibold')}>
            <td className="px-4 py-2.5">{r.name}</td>
            <td className="px-4 py-2.5 text-right tabular-nums">{m(r.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function IncomeView({ period }: { period: string }) {
  const { data, isLoading } = useIncomeStatement(period)
  return <div className="card-base overflow-hidden p-0"><SimpleReport rows={data?.rows ?? []} loading={isLoading} /></div>
}

function CashFlowView({ period }: { period: string }) {
  const { data, isLoading } = useCashFlow(period)
  return <div className="card-base overflow-hidden p-0"><SimpleReport rows={data?.rows ?? []} loading={isLoading} /></div>
}

function BalanceSheetView({ period }: { period: string }) {
  const { data, isLoading } = useBalanceSheet(period)
  if (isLoading || !data) return <div className="card-base p-12 text-center text-sm text-muted-foreground">加载中...</div>
  const side = (title: string, items: BalanceSheetItem[], total: number, totalLabel: string) => (
    <div className="card-base overflow-hidden p-0">
      <div className="border-b border-border bg-muted/40 px-4 py-2 text-sm font-medium">{title}</div>
      <table className="w-full text-sm">
        <tbody>
          {items.length === 0 ? (
            <tr><td className="px-4 py-3 text-muted-foreground">无</td></tr>
          ) : items.map((it, i) => (
            <tr key={i} className="border-b border-border/40">
              <td className="px-4 py-2.5">{it.code !== '——' && <span className="mr-1 font-mono text-doc-code-muted">{it.code}</span>}{it.name}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{m(it.amount)}</td>
            </tr>
          ))}
          <tr className="bg-muted/20 font-semibold"><td className="px-4 py-2.5">{totalLabel}</td><td className="px-4 py-2.5 text-right tabular-nums">{m(total)}</td></tr>
        </tbody>
      </table>
    </div>
  )
  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-sm">
        {data.balanced
          ? <><CheckCircle2 className="h-4 w-4 text-success" /><span>资产 {m(data.assetTotal)} = 负债+所有者权益 {m(data.liabEquityTotal)}，会计等式成立</span></>
          : <><AlertTriangle className="h-4 w-4 text-warning" /><span className="text-warning">资产 {m(data.assetTotal)} ≠ 负债+权益 {m(data.liabEquityTotal)}</span></>}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {side('资产', data.assets, data.assetTotal, '资产合计')}
        <div className="space-y-4">
          {side('负债', data.liabilities, data.liabTotal, '负债合计')}
          {side('所有者权益', data.equity, data.equityTotal, '所有者权益合计')}
        </div>
      </div>
    </div>
  )
}

export default function ReportsPage() {
  const [period, setPeriod] = useState(currentPeriod())
  const [tab, setTab] = useState<Tab>('income')
  return (
    <div>
      <PageHeader title="会计报表" description="利润表 / 资产负债表 / 现金流量表（简版，取数以凭证与资金流水为准）" />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-border/70 bg-card p-0.5">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={cn('rounded-md px-3 py-1.5 text-sm transition-colors', tab === t.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
              {t.label}
            </button>
          ))}
        </div>
        <span className="ml-2 text-sm text-muted-foreground">会计期间</span>
        <Input value={period} onChange={e => setPeriod(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="YYYYMM" className="h-9 w-36 font-mono" />
        {tab === 'balance' && <Button variant="ghost" size="sm" disabled className="text-xs text-muted-foreground">期末时点</Button>}
      </div>

      {tab === 'income' && <IncomeView period={period} />}
      {tab === 'balance' && <BalanceSheetView period={period} />}
      {tab === 'cashflow' && <CashFlowView period={period} />}
    </div>
  )
}
