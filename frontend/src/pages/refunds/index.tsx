import { useState } from 'react'
import { X } from 'lucide-react'
import { toast } from '@/lib/toast'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import type { StatusTone } from '@/lib/statusTone'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useRefundList, useCreateRefund } from '@/hooks/useRefund'
import { getActiveAccountsApi } from '@/api/finance'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { formatDisplayDateTime } from '@/lib/dateTime'
import type { RefundOrder } from '@/types/refund'
import type { TableColumn } from '@/types'
import { useQuery } from '@tanstack/react-query'
import RefundDetailDialog from './components/RefundDetailDialog'
import RefundQueryDialog, { type RefundQueryValues } from './RefundQueryDialog'

const STATUS_TONE: Record<number, StatusTone> = {
  1: 'draft',    // 草稿
  2: 'active',   // 已确认
  3: 'success',  // 已完成
  4: 'danger',   // 已取消
}

const m = (n: number) => (Number(n) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function RefundsPage() {
  const STATUS_NAME: Record<number, string> = { 1: '草稿', 2: '已确认', 3: '已完成', 4: '已取消' }
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [queryOpen, setQueryOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [detailId, setDetailId] = useState<number | null>(null)
  const { can } = usePermission()
  const canCreate = can(PERMISSIONS.REFUND_ORDER_CREATE)

  const { data, isLoading } = useRefundList({
    pageSize: 99999,
    keyword,
    status: statusFilter || undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
  })

  // ── 查询弹窗筛选值 ──
  const initialQuery: RefundQueryValues = { keyword, status: statusFilter, startDate, endDate }
  function applyQuery(v: RefundQueryValues) {
    setKeyword(v.keyword)
    setStatusFilter(v.status)
    setStartDate(v.startDate)
    setEndDate(v.endDate)
    setQueryOpen(false)
  }
  function clearAll() { setKeyword(''); setStatusFilter(''); setStartDate(''); setEndDate('') }

  const chips = [
    keyword && { key: 'keyword', label: `关键字：${keyword}`, onRemove: () => setKeyword('') },
    statusFilter && { key: 'status', label: `状态：${STATUS_NAME[Number(statusFilter)] ?? statusFilter}`, onRemove: () => setStatusFilter('') },
    (startDate || endDate) && { key: 'date', label: `日期：${startDate || '…'} ~ ${endDate || '…'}`, onRemove: () => { setStartDate(''); setEndDate('') } },
  ].filter(Boolean) as { key: string; label: string; onRemove: () => void }[]

  const columns: TableColumn<RefundOrder>[] = [
    { key: 'refundNo', title: '退款单号', width: 170, render: (v) => <span className="text-doc-code">{String(v)}</span> },
    { key: 'saleOrderNo', title: '销售单', width: 150, render: (v) => <span className="text-doc-code-muted">{String(v)}</span> },
    { key: 'customerName', title: '客户', width: 120 },
    {
      key: 'amount', title: '退款金额', width: 120,
      render: (v) => <span className="text-right tabular-nums">¥{m(Number(v))}</span>,
    },
    {
      key: 'status', title: '状态', width: 90,
      render: (v, row) => <SoftStatusLabel label={(row as RefundOrder).statusName} tone={STATUS_TONE[v as number] ?? 'draft'} />,
    },
    {
      key: 'createdAt', title: '创建时间', width: 160,
      render: (v) => formatDisplayDateTime(v),
    },
    {
      key: 'id', title: '操作', width: 100,
      render: (_, row) => (
        <Button size="sm" variant="outline" onClick={() => setDetailId((row as RefundOrder).id)}>查看/处理</Button>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="退货退款单"
        description="已收款的销售退货需先完成退款，否则无法继续退货；退款从资金账户出账并冲减已收金额"
        actions={
          <>
            <Button variant="outline" onClick={() => setQueryOpen(true)}>查询</Button>
            {canCreate ? <Button onClick={() => setCreateOpen(true)}>+ 新建退款单</Button> : undefined}
          </>
        }
      />

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map(c => (
            <span key={c.key} className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
              {c.label}
              <button type="button" onClick={c.onRemove} className="text-muted-foreground/70 hover:text-foreground" aria-label={`移除筛选 ${c.label}`}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <Button size="sm" variant="ghost" onClick={clearAll}>清空</Button>
        </div>
      )}

      <DataTable columns={columns} data={data?.list || []} loading={isLoading} />

      <CreateRefundDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      <RefundDetailDialog open={!!detailId} onClose={() => setDetailId(null)} id={detailId} />
      <RefundQueryDialog
        open={queryOpen}
        initial={initialQuery}
        onClose={() => setQueryOpen(false)}
        onApply={applyQuery}
      />
    </div>
  )
}

/** 新建退款单弹窗：销售单号 → 金额 → 退款账户 → 日期 */
function CreateRefundDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: accounts } = useQuery({ queryKey: ['finance-accounts-active'], queryFn: getActiveAccountsApi })
  const create = useCreateRefund()
  const [saleOrderNo, setSaleOrderNo] = useState('')
  const [amount, setAmount] = useState('')
  const [accountId, setAccountId] = useState('')
  const [refundDate, setRefundDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [remark, setRemark] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function reset() {
    setSaleOrderNo(''); setAmount(''); setAccountId(''); setRefundDate(new Date().toISOString().slice(0, 10)); setRemark('')
  }

  async function handleCreate() {
    if (!saleOrderNo.trim()) { toast.warning('请输入销售单号'); return }
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt <= 0) { toast.warning('退款金额必须大于 0'); return }
    if (submitting || create.isPending) return
    try {
      setSubmitting(true)
      await create.mutateAsync({
        saleOrderNo: saleOrderNo.trim(),
        amount: amt,
        accountId: accountId ? Number(accountId) : null,
        refundDate: refundDate || undefined,
        remark: remark || undefined,
      })
      toast.success('退款单已创建为草稿，请在列表中确认并执行')
      reset()
      onClose()
    } catch {
      // 全局拦截器已提示（如 REFUND_EXCEED_PAID）
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) { reset(); onClose() } }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>新建退款单</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label>销售单号 *</Label>
            <Input value={saleOrderNo} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSaleOrderNo(e.target.value)} placeholder="输入销售单号" className="font-mono" />
            <p className="text-xs text-muted-foreground">系统按单号反查该销售单已收金额，退款不能超过已收金额</p>
          </div>
          <div className="space-y-1">
            <Label>退款金额 *</Label>
            <Input type="number" min="0" step="0.01" value={amount} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAmount(e.target.value)} className="text-right tabular-nums" />
          </div>
          <div className="space-y-1">
            <Label>退款账户</Label>
            <Select value={accountId || '__none__'} onValueChange={(v) => setAccountId(v === '__none__' ? '' : v)}>
              <SelectTrigger className="h-10 w-full"><SelectValue placeholder="请选择（不选则不记资金账户）" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">请选择</SelectItem>
                {(accounts || []).map(a => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>退款日期</Label>
            <Input type="date" value={refundDate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRefundDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>备注</Label>
            <Input value={remark} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRemark(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => { reset(); onClose() }} disabled={submitting}>取消</Button>
          <Button onClick={handleCreate} disabled={submitting || create.isPending}>{submitting || create.isPending ? '创建中…' : '创建退款单'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
