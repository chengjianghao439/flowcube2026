import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { useCompanyStore } from '@/store/companyStore'
import {
  listCompaniesApi, getConsolidatedBalanceSheetApi, getConsolidatedIncomeApi,
  type AcctCompany,
} from '@/api/accounting'
import { toast } from '@/lib/toast'
import type { TableColumn } from '@/types'

const money = (n: number) => `¥${Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function LedgerTable({ title, rows, total, accent }: { title: string; rows: Array<{ code: string; name: string; amount: number }>; total: number; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-border">
      <div className="border-b border-border bg-muted/40 px-4 py-2 text-sm font-medium">{title} <span className="ml-1 text-muted-foreground font-normal">{money(total)}</span></div>
      <table className="w-full text-sm">
        <tbody>
          {rows.map(r => (
            <tr key={r.code} className="border-t border-border/60">
              <td className="px-4 py-1.5 text-doc-code text-xs w-20">{r.code}</td>
              <td className="px-4 py-1.5">{r.name}</td>
              <td className={`px-4 py-1.5 text-right tabular-nums ${accent ? 'font-medium' : 'text-muted-foreground'}`}>{money(r.amount)}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={3} className="px-4 py-4 text-center text-muted-foreground">无数据</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

export default function ConsolidationPage() {
  const { companyId, setCompany } = useCompanyStore()
  const [period, setPeriod] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [createOpen, setCreateOpen] = useState(false)
  const [newCode, setNewCode] = useState('')
  const [newName, setNewName] = useState('')

  const { data: companies } = useQuery({
    queryKey: ['acct-companies'],
    queryFn: () => listCompaniesApi({ pageSize: 50 }),
  })
  const companyList = companies?.list ?? []
  const group = companyList.find(c => c.id === companyId)

  const { data: bs } = useQuery({
    queryKey: ['consol-bs', companyId, period],
    queryFn: () => getConsolidatedBalanceSheetApi(companyId, period),
    enabled: companyId > 0 && !!period,
  })
  const { data: inc } = useQuery({
    queryKey: ['consol-inc', companyId, period],
    queryFn: () => getConsolidatedIncomeApi(companyId, period),
    enabled: companyId > 0 && !!period,
  })

  const createCompany = async () => {
    if (!newCode.trim() || !newName.trim()) return toast.warning('请填写账套编码和名称')
    try {
      const { createCompanyApi } = await import('@/api/accounting')
      const r = await createCompanyApi({ code: newCode.trim(), name: newName.trim(), isGroup: false })
      toast.success(`已创建账套 ${r.code}`)
      setCreateOpen(false); setNewCode(''); setNewName('')
      // 重新拉取账套列表
      window.location.reload()
    } catch (e) { toast.error((e as { message?: string })?.message || '创建失败') }
  }

  const companyColumns: TableColumn<AcctCompany>[] = [
    { key: 'code', title: '编码', width: 100, render: v => <span className="text-doc-code">{String(v)}</span> },
    { key: 'name', title: '名称' },
    { key: 'isGroup', title: '类型', width: 90, render: (_, r) => <SoftStatusLabel label={r.isGroup ? '集团' : '公司'} tone={r.isGroup ? 'warning' : 'info'} /> },
    { key: 'isActive', title: '状态', width: 80, render: (_, r) => <SoftStatusLabel label={r.isActive ? '启用' : '停用'} tone={r.isActive ? 'success' : 'danger'} /> },
    {
      key: 'id',
      title: '操作',
      width: 140,
      render: (_, r) => (
        <Button size="sm" variant={companyId === r.id ? 'default' : 'outline'} onClick={() => setCompany(r.id, r.name)}>
          {companyId === r.id ? '当前账套' : '切换'}
        </Button>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="合并报表 / 账套"
        description="多账套管理：选择集团账套查看合并资产负债表与利润表（Σ子账套）。切换账套后会计各页随之过滤。"
        actions={<Button onClick={() => setCreateOpen(true)}>新建账套</Button>}
      />

      {/* 账套列表 */}
      <DataTable columns={companyColumns} data={companyList} rowKey="id" loading={!companies} emptyText="暂无账套" />

      {/* 合并报表 */}
      <div className="flex items-center gap-2">
        <div className="text-sm font-medium">合并期间</div>
        <Input value={period} onChange={e => setPeriod(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="YYYYMM" className="w-32 text-center" />
        <div className="text-sm text-muted-foreground">
          {group ? `合并根：${group.name}` : '选择集团账套（isGroup=true）查看合并报表'}
        </div>
      </div>

      {companyId > 0 && (group?.isGroup || companyId === 1) && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <LedgerTable title="资产" rows={bs?.assets ?? []} total={bs?.assetTotal ?? 0} accent />
            <LedgerTable title="负债" rows={bs?.liabilities ?? []} total={bs?.liabTotal ?? 0} />
            <LedgerTable title="权益" rows={bs?.equity ?? []} total={bs?.equityTotal ?? 0} />
            <div className="rounded-lg border border-border bg-muted/30 px-4 py-2 text-sm">
              资产合计 <span className="font-semibold">{money(bs?.assetTotal ?? 0)}</span>
              <span className="mx-2 text-muted-foreground">=</span>
              负债+权益 <span className="font-semibold">{money(bs?.liabEquityTotal ?? 0)}</span>
              <SoftStatusLabel label={bs?.balanced ? '平衡' : '不平！'} tone={bs?.balanced ? 'success' : 'danger'} />
            </div>
          </div>
          <div className="space-y-2">
            <LedgerTable title="收入" rows={inc?.revenue ?? []} total={inc?.revenueTotal ?? 0} />
            <LedgerTable title="费用/成本" rows={inc?.expenses ?? []} total={inc?.expenseTotal ?? 0} />
            <div className="rounded-lg border border-border bg-muted/30 px-4 py-2 text-sm">
              净利润 <span className="font-semibold">{money(inc?.netProfit ?? 0)}</span>
              <span className="ml-2 text-xs text-muted-foreground">（{inc?.companies.map(c => c.name).join(' + ') ?? '—'}）</span>
            </div>
          </div>
        </div>
      )}

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setCreateOpen(false)}>
          <div className="w-96 rounded-lg bg-background p-5 shadow-lg" onClick={e => e.stopPropagation()}>
            <h3 className="mb-3 text-base font-semibold">新建账套</h3>
            <div className="space-y-2">
              <Input placeholder="账套编码，如 SUB5" value={newCode} onChange={e => setNewCode(e.target.value)} />
              <Input placeholder="账套名称" value={newName} onChange={e => setNewName(e.target.value)} />
              <p className="text-xs text-muted-foreground">新账套会自动复制主账套的预置会计科目；后续可在会计科目页维护其独立科目。</p>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
              <Button onClick={createCompany}>创建</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
