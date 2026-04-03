import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { FilterCard } from '@/components/shared/FilterCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getPaymentsApi, payApi, getEntriesApi } from '@/api/payments'
import type { PaymentRecord, PaymentEntry } from '@/api/payments'
import type { TableColumn } from '@/types'

const ST_COLOR: Record<number,'default'|'secondary'|'outline'> = { 1:'secondary', 2:'default', 3:'outline' }

export default function PaymentsPage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<1|2>(1)
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('')
  const [payOpen, setPayOpen] = useState(false)
  const [selectedRecord, setSelectedRecord] = useState<PaymentRecord | null>(null)
  const [entriesOpen, setEntriesOpen] = useState(false)
  const [payAmount, setPayAmount] = useState('')
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10))
  const [payMethod, setPayMethod] = useState('转账')
  const [payRemark, setPayRemark] = useState('')

  const { data, isLoading } = useQuery({ queryKey: ['payments', { type: tab, page, status: statusFilter }], queryFn: () => getPaymentsApi({ type: tab, page, pageSize: 20, status: statusFilter || undefined }).then(r => r.data.data!) })
  const { data: entries } = useQuery({ queryKey: ['payment-entries', selectedRecord?.id], queryFn: () => getEntriesApi(selectedRecord!.id).then(r => r.data.data || []), enabled: !!selectedRecord && entriesOpen })
  const payMut = useMutation({ mutationFn: ({ id, d }: { id: number; d: object }) => payApi(id, d), onSuccess: () => { qc.invalidateQueries({ queryKey: ['payments'] }); setPayOpen(false); setPayAmount(''); setPayRemark('') } })

  const handlePay = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedRecord || !payAmount) return
    await payMut.mutateAsync({ id: selectedRecord.id, d: { amount: +payAmount, paymentDate: payDate, method: payMethod, remark: payRemark || undefined } })
  }

  const summary = (data as { summary?: { totalAmount:number; paidAmount:number; balance:number } })?.summary

  const columns: TableColumn<PaymentRecord>[] = [
    { key: 'orderNo', title: '关联单号', width: 160, render: (v) => <span className="text-doc-code">{String(v)}</span> },
    { key: 'partyName', title: tab === 1 ? '供应商' : '客户' },
    { key: 'totalAmount', title: '总金额', width: 100, render: (v) => `¥${Number(v).toFixed(2)}` },
    { key: 'paidAmount', title: '已付金额', width: 100, render: (v) => <span className="tabular-nums text-success">¥{Number(v).toFixed(2)}</span> },
    { key: 'balance', title: '余额', width: 100, render: (v) => <span className={`tabular-nums ${Number(v) > 0 ? 'font-medium text-destructive' : 'text-muted-foreground'}`}>¥{Number(v).toFixed(2)}</span> },
    { key: 'status', title: '状态', width: 90, render: (v, row) => <Badge variant={ST_COLOR[v as number]}>{(row as PaymentRecord).statusName}</Badge> },
    { key: 'dueDate', title: '到期日', width: 100, render: (v, row) => {
      const d = v ? String(v).slice(0, 10) : null
      const r = row as PaymentRecord
      const overdue = d && r.status !== 3 && new Date(d) < new Date()
      return d ? <span className={overdue ? 'font-bold text-destructive' : ''}>{d}{overdue ? ' 逾期' : ''}</span> : <span className="text-muted-foreground">-</span>
    }},
    { key: 'id', title: '操作', width: 160, render: (_, row) => {
      const r = row as PaymentRecord
      return (
        <div className="flex gap-1">
          {r.status !== 3 && <Button size="sm" variant="outline" onClick={() => { setSelectedRecord(r); setPayOpen(true) }}>登记付款</Button>}
          <Button size="sm" variant="outline" onClick={() => { setSelectedRecord(r); setEntriesOpen(true) }}>流水</Button>
        </div>
      )
    }}
  ]

  return (
    <div className="space-y-4">
      <PageHeader title="应付/应收账款" description="跟踪采购应付款与销售应收款" />

      {/* 汇总卡片 */}
      {summary && (
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm"><p className="text-sm text-muted-foreground">总金额</p><p className="tabular-nums text-2xl font-bold text-foreground">¥{summary.totalAmount.toFixed(2)}</p></div>
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm"><p className="text-sm text-muted-foreground">已付/已收</p><p className="tabular-nums text-2xl font-bold text-success">¥{summary.paidAmount.toFixed(2)}</p></div>
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm"><p className="text-sm text-muted-foreground">待付/待收余额</p><p className="tabular-nums text-2xl font-bold text-destructive">¥{summary.balance.toFixed(2)}</p></div>
        </div>
      )}

      {/* Tab */}
      <div className="flex gap-1 border-b">
        {([1, 2] as const).map(t => (
          <button key={t} onClick={() => { setTab(t); setPage(1) }} className={`px-4 py-2 text-sm font-medium transition-colors ${tab === t ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
            {t === 1 ? '应付账款（采购）' : '应收账款（销售）'}
          </button>
        ))}
      </div>

      <FilterCard>
        <Select value={statusFilter || '__all__'} onValueChange={v => { setStatusFilter(v === '__all__' ? '' : v); setPage(1) }}>
          <SelectTrigger className="h-9 w-36">
            <SelectValue placeholder="全部状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">全部状态</SelectItem>
            <SelectItem value="1">未付</SelectItem>
            <SelectItem value="2">部分付</SelectItem>
            <SelectItem value="3">已付清</SelectItem>
          </SelectContent>
        </Select>
        {statusFilter && <Button size="sm" variant="ghost" onClick={() => { setStatusFilter(''); setPage(1) }}>重置</Button>}
      </FilterCard>

      <DataTable columns={columns} data={data?.list || []} loading={isLoading} pagination={data?.pagination as Parameters<typeof DataTable>[0]['pagination']} onPageChange={setPage} />

      {/* 登记付款弹窗 */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>登记{tab === 1 ? '付款' : '收款'}</DialogTitle></DialogHeader>
          {selectedRecord && (
            <div className="text-sm text-muted-foreground mb-2 space-y-1">
              <p>关联单号：<span className="text-doc-code-strong">{selectedRecord.orderNo}</span> &nbsp;·&nbsp; {tab === 1 ? '供应商' : '客户'}：{selectedRecord.partyName}</p>
              <p>余额：<span className="font-medium text-destructive">¥{selectedRecord.balance.toFixed(2)}</span></p>
            </div>
          )}
          <form onSubmit={handlePay} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1"><Label>金额 *</Label><Input type="number" min="0.01" step="0.01" value={payAmount} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPayAmount(e.target.value)} required /></div>
              <div className="space-y-1"><Label>日期 *</Label><Input type="date" value={payDate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPayDate(e.target.value)} required /></div>
              <div className="space-y-1"><Label>方式</Label>
                <Select value={payMethod} onValueChange={setPayMethod}>
                  <SelectTrigger className="h-10 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="转账">转账</SelectItem>
                    <SelectItem value="现金">现金</SelectItem>
                    <SelectItem value="支票">支票</SelectItem>
                    <SelectItem value="网银">网银</SelectItem>
                    <SelectItem value="其他">其他</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label>备注</Label><Input value={payRemark} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPayRemark(e.target.value)} /></div>
            </div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setPayOpen(false)}>取消</Button><Button type="submit" disabled={payMut.isPending}>确认登记</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 付款流水弹窗 */}
      <Dialog open={entriesOpen} onOpenChange={setEntriesOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>付款流水 — <span className="text-doc-code-strong">{selectedRecord?.orderNo}</span></DialogTitle></DialogHeader>
          {!entries?.length && <p className="text-sm text-muted-foreground text-center py-6">暂无流水记录</p>}
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {entries?.map((e: PaymentEntry) => (
              <div key={e.id} className="flex justify-between items-center border-b pb-2 text-sm">
                <div><p className="font-medium">¥{e.amount.toFixed(2)}</p><p className="text-xs text-muted-foreground">{e.paymentDate} · {e.method} · {e.operatorName}</p></div>
                {e.remark && <p className="text-xs text-muted-foreground max-w-32 text-right">{e.remark}</p>}
              </div>
            ))}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setEntriesOpen(false)}>关闭</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
