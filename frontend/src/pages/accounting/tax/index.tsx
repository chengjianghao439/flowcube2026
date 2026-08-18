import { useState } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCompanyStore } from '@/store/companyStore'
import { toast } from '@/lib/toast'
import { downloadExport } from '@/lib/exportDownload'
import {
  useTaxVat,
  useTaxIncome,
  useTaxAdjustments,
  useCreateTaxAdjustment,
  useDeleteTaxAdjustment,
  type TaxAdjustment,
} from '@/hooks/useTax'
import type { TableColumn } from '@/types'

const money = (n: number) => `¥${Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function TaxFilingPage() {
  const { companyId } = useCompanyStore()
  const [period, setPeriod] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [tab, setTab] = useState<'vat' | 'income'>('vat')
  const [adjItem, setAdjItem] = useState('')
  const [adjAmount, setAdjAmount] = useState('')

  const taxType = tab === 'vat' ? 1 : 2
  const { data: vat } = useTaxVat(companyId, period, !!period)
  const { data: income } = useTaxIncome(companyId, period, !!period)
  const { data: adjustments } = useTaxAdjustments(companyId, period, taxType, !!period)

  const { mutate: addAdj, isPending } = useCreateTaxAdjustment(companyId, period, tab)
  const { mutate: removeAdj } = useDeleteTaxAdjustment(companyId, period, tab)

  const adjColumns: TableColumn<TaxAdjustment>[] = [
    { key: 'period', title: '期间', width: 100, render: v => <span className="text-doc-code">{String(v)}</span> },
    { key: 'adjustItem', title: '调整项' },
    { key: 'amount', title: '金额', width: 120, align: 'right', render: v => <span className={`tabular-nums ${Number(v) !== 0 ? 'text-amber-600 font-medium' : ''}`}>{money(Number(v))}</span> },
    { key: 'remark', title: '备注', render: v => String(v || '—') },
    { key: 'id', title: '操作', width: 80, render: (_, r) => <Button size="sm" variant="ghost" className="text-destructive" onClick={() => removeAdj(r.id)}>删除</Button> },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="报税数据"
        description="从会计科目发生额实时投影增值税/所得税申报表要素（税会差异，即税法与会计口径的差异，用调整项手工维护），供报税参考。"
        actions={<Button variant="outline" onClick={() => downloadExport('/export/tax-adjustments').catch(e => toast.error((e as Error).message))}>导出</Button>}
      />

      <div className="flex items-center gap-2">
        <div className="text-sm font-medium">申报期间</div>
        <Input value={period} onChange={e => setPeriod(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="YYYYMM" className="w-32 text-center" />
        <div className="flex gap-1">
          <Button size="sm" variant={tab === 'vat' ? 'default' : 'outline'} onClick={() => setTab('vat')}>增值税</Button>
          <Button size="sm" variant={tab === 'income' ? 'default' : 'outline'} onClick={() => setTab('income')}>所得税</Button>
        </div>
      </div>

      {tab === 'vat' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <div className="rounded-lg border border-border">
              <div className="border-b border-border bg-muted/40 px-4 py-2 text-sm font-medium">增值税申报要素</div>
              <div className="space-y-1.5 px-4 py-3 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">销项税额（222102 贷方）</span><span className="tabular-nums">{money(vat?.salesTaxAmount ?? 0)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">进项税额（222101 借方）</span><span className="tabular-nums">{money(vat?.inputTaxAmount ?? 0)}</span></div>
                <div className="flex justify-between border-t border-border pt-2"><span>应纳税额（销项−进项+调整）</span><span className="tabular-nums font-semibold text-primary">{money(vat?.taxDue ?? 0)}</span></div>
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <div className="rounded-lg border border-border">
              <div className="border-b border-border bg-muted/40 px-4 py-2 text-sm font-medium">税会差异调整（增值税）</div>
              <div className="flex gap-2 p-3">
                <Input placeholder="调整项，如：视同销售" value={adjItem} onChange={e => setAdjItem(e.target.value)} className="h-9" />
                <Input placeholder="金额" type="number" value={adjAmount} onChange={e => setAdjAmount(e.target.value)} className="h-9 w-28 text-right" />
                <Button size="sm" disabled={!adjItem.trim() || isPending} onClick={() => addAdj({ adjustItem: adjItem, amount: Number(adjAmount) }, {
                  onSuccess: () => { toast.success('调整项已保存'); setAdjItem(''); setAdjAmount('') },
                  onError: (e: Error) => toast.error(e.message),
                })}>添加</Button>
              </div>
            </div>
            <DataTable columns={adjColumns} data={adjustments ?? []} rowKey="id" emptyText="无调整项" />
          </div>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <div className="rounded-lg border border-border">
              <div className="border-b border-border bg-muted/40 px-4 py-2 text-sm font-medium">所得税申报要素</div>
              <div className="space-y-1.5 px-4 py-3 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">营业收入</span><span className="tabular-nums">{money(income?.revenue ?? 0)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">成本费用</span><span className="tabular-nums">{money(income?.expense ?? 0)}</span></div>
                <div className="flex justify-between border-t border-border pt-2"><span>利润总额</span><span className={`tabular-nums font-semibold ${(income?.profitTotal ?? 0) < 0 ? 'text-destructive' : ''}`}>{money(income?.profitTotal ?? 0)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">应纳税所得额（+调整，取非负）</span><span className="tabular-nums">{money(income?.taxableIncome ?? 0)}</span></div>
                <div className="flex justify-between"><span>应纳所得税额（{(income?.taxRate ?? 0.25) * 100}%）</span><span className="tabular-nums font-semibold text-primary">{money(income?.taxDue ?? 0)}</span></div>
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <div className="rounded-lg border border-border">
              <div className="border-b border-border bg-muted/40 px-4 py-2 text-sm font-medium">税会差异调整（所得税）</div>
              <div className="flex gap-2 p-3">
                <Input placeholder="调整项，如：业务招待费调增" value={adjItem} onChange={e => setAdjItem(e.target.value)} className="h-9" />
                <Input placeholder="金额" type="number" value={adjAmount} onChange={e => setAdjAmount(e.target.value)} className="h-9 w-28 text-right" />
                <Button size="sm" disabled={!adjItem.trim() || isPending} onClick={() => addAdj({ adjustItem: adjItem, amount: Number(adjAmount) }, {
                  onSuccess: () => { toast.success('调整项已保存'); setAdjItem(''); setAdjAmount('') },
                  onError: (e: Error) => toast.error(e.message),
                })}>添加</Button>
              </div>
            </div>
            <DataTable columns={adjColumns} data={adjustments ?? []} rowKey="id" emptyText="无调整项" />
          </div>
        </div>
      )}
    </div>
  )
}
