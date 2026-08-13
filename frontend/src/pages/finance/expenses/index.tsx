import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import Pagination from '@/components/shared/Pagination'
import TableActionsMenu from '@/components/shared/TableActionsMenu'
import { QueryChips, type QueryChip } from '@/components/shared/QueryChips'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DatePicker } from '@/components/shared/DatePicker'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import type { StatusTone } from '@/lib/statusTone'
import { toast } from '@/lib/toast'
import { confirmAction } from '@/lib/confirm'
import { formatDisplayDate } from '@/lib/dateTime'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { getActiveAccountsApi } from '@/api/finance'
import {
  getExpenseClaimsApi, getExpenseClaimApi, createExpenseClaimApi, updateExpenseClaimApi,
  submitExpenseClaimApi, withdrawExpenseClaimApi, cancelExpenseClaimApi,
  approveExpenseClaimApi, rejectExpenseClaimApi, payExpenseClaimApi,
  getExpenseCategoriesApi, type ExpenseClaim, type ExpenseClaimItem,
} from '@/api/finance'
import type { TableColumn } from '@/types'

const money = (n: number) => `¥${Number(n).toFixed(2)}`
const STATUS_OPTIONS = [
  ['1', '草稿'], ['2', '待审批'], ['3', '已批准'], ['4', '已付款'], ['5', '已驳回'], ['6', '已取消'],
] as const
const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
type DraftItem = { categoryId: string; amount: string; happenedAt: string; description: string }
const emptyItem = (): DraftItem => ({ categoryId: '', amount: '', happenedAt: todayStr(), description: '' })

interface ExpQuery { keyword: string; status: string; startDate: string; endDate: string; minAmount: string; maxAmount: string }
const EMPTY_EXP_QUERY: ExpQuery = { keyword: '', status: '', startDate: '', endDate: '', minAmount: '', maxAmount: '' }
const STATUS_NAME: Record<string, string> = Object.fromEntries(STATUS_OPTIONS.map(([v, l]) => [v, l]))

/** 费用报销查询弹窗：关键字 + 状态 + 创建日期区间 + 金额区间（比原来平铺的一格搜索框多了日期/金额） */
function ExpensesQueryDialog({ open, initial, onClose, onApply }: {
  open: boolean; initial: ExpQuery; onClose: () => void; onApply: (q: ExpQuery) => void
}) {
  const [v, setV] = useState<ExpQuery>(initial)
  useEffect(() => { if (open) setV(initial) }, [open, initial])
  const set = (patch: Partial<ExpQuery>) => setV(p => ({ ...p, ...patch }))
  return (
    <Dialog open={open} onOpenChange={x => !x && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>查询费用报销单</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>关键字</Label>
              <Input className="h-9" placeholder="单号 / 事由 / 申请人" value={v.keyword}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => set({ keyword: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>状态</Label>
              <Select value={v.status || '__all__'} onValueChange={x => set({ status: x === '__all__' ? '' : x })}>
                <SelectTrigger className="h-9"><SelectValue placeholder="全部" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">全部</SelectItem>
                  {STATUS_OPTIONS.map(([val, l]) => <SelectItem key={val} value={val}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>创建日期</Label>
            <div className="flex items-center gap-2">
              <DatePicker value={v.startDate} onChange={x => set({ startDate: x })} max={v.endDate || undefined} className="h-9 flex-1" />
              <span className="text-muted-foreground">至</span>
              <DatePicker value={v.endDate} onChange={x => set({ endDate: x })} min={v.startDate || undefined} className="h-9 flex-1" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>报销金额</Label>
            <div className="flex items-center gap-2">
              <Input type="number" min="0" step="0.01" placeholder="最小金额" className="h-9 flex-1"
                value={v.minAmount} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set({ minAmount: e.target.value })} />
              <span className="text-muted-foreground">至</span>
              <Input type="number" min="0" step="0.01" placeholder="最大金额" className="h-9 flex-1"
                value={v.maxAmount} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set({ maxAmount: e.target.value })} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setV(EMPTY_EXP_QUERY)}>清空</Button>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={() => { onApply(v); onClose() }}>查询</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function ExpenseClaimsPage() {
  const qc = useQueryClient()
  const { can } = usePermission()
  const canApprove = can(PERMISSIONS.FINANCE_EXPENSE_APPROVE)
  const canPay = can(PERMISSIONS.FINANCE_EXPENSE_PAY)

  const [query, setQuery] = useState<ExpQuery>(EMPTY_EXP_QUERY)
  const [queryOpen, setQueryOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [title, setTitle] = useState('')
  const [remark, setRemark] = useState('')
  const [items, setItems] = useState<DraftItem[]>([emptyItem()])
  const [detailId, setDetailId] = useState<number | null>(null)
  const [payTarget, setPayTarget] = useState<ExpenseClaim | null>(null)
  const [payAccount, setPayAccount] = useState('')
  const [rejectTarget, setRejectTarget] = useState<ExpenseClaim | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  const PAGE_SIZE = 20
  const { data, isLoading } = useQuery({
    queryKey: ['expense-claims', query, page],
    queryFn: () => getExpenseClaimsApi({
      page,
      pageSize: PAGE_SIZE,
      keyword: query.keyword || undefined,
      status: query.status || undefined,
      startDate: query.startDate || undefined,
      endDate: query.endDate || undefined,
      minAmount: query.minAmount || undefined,
      maxAmount: query.maxAmount || undefined,
    }),
  })
  const total = data?.pagination?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const queryChips: QueryChip[] = []
  const dropQ = (...ks: (keyof ExpQuery)[]) => () => { setQuery(q => ks.reduce((a, k) => ({ ...a, [k]: '' }), { ...q })); setPage(1) }
  if (query.keyword) queryChips.push({ key: 'kw', text: `搜索：${query.keyword}`, onClear: dropQ('keyword') })
  if (query.status) queryChips.push({ key: 'status', text: `状态：${STATUS_NAME[query.status] ?? query.status}`, onClear: dropQ('status') })
  if (query.startDate || query.endDate) queryChips.push({ key: 'date', text: `创建日期：${query.startDate || '…'} ~ ${query.endDate || '…'}`, onClear: dropQ('startDate', 'endDate') })
  if (query.minAmount || query.maxAmount) queryChips.push({ key: 'amt', text: `金额：${query.minAmount || '0'} ~ ${query.maxAmount || '不限'}`, onClear: dropQ('minAmount', 'maxAmount') })
  const { data: categories } = useQuery({
    queryKey: ['expense-categories', 'active'],
    queryFn: () => getExpenseCategoriesApi(true),
  })
  const { data: accounts } = useQuery({
    queryKey: ['finance-accounts', 'active'],
    queryFn: () => getActiveAccountsApi(),
    enabled: !!payTarget,
  })
  const { data: detail } = useQuery({
    queryKey: ['expense-claim', detailId],
    queryFn: () => getExpenseClaimApi(detailId!),
    enabled: detailId != null,
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['expense-claims'] })
    qc.invalidateQueries({ queryKey: ['expense-claim'] })
    qc.invalidateQueries({ queryKey: ['finance-accounts'] })
    // 报销付款从账户出账，改变看板收支与费用构成，看板缓存一并失效
    qc.invalidateQueries({ queryKey: ['finance-dashboard'] })
  }
  const act = (fn: () => Promise<unknown>, msg: string) =>
    fn().then(() => { invalidate(); toast.success(msg) }).catch(() => {})

  // 只计入将被真正保存的有效明细（有类别且金额>0），与提交 payload 的过滤口径一致——
  // 否则「填了金额但没选类别」的行会被算进合计、按钮可点，但后端只收有效行，显示与保存对不上。
  const totalAmount = items
    .filter(i => i.categoryId && Number(i.amount) > 0)
    .reduce((s, i) => s + Number(i.amount), 0)

  const saveMut = useMutation({
    mutationFn: () => {
      const payload = {
        title: title || undefined,
        remark: remark || undefined,
        items: items
          .filter(i => i.categoryId && Number(i.amount) > 0)
          .map<ExpenseClaimItem>(i => ({
            categoryId: Number(i.categoryId),
            amount: Number(i.amount),
            happenedAt: i.happenedAt,
            description: i.description || undefined,
          })),
      }
      return editingId ? updateExpenseClaimApi(editingId, payload) : createExpenseClaimApi(payload)
    },
    onSuccess: () => { invalidate(); setFormOpen(false); toast.success(editingId ? '报销单已保存' : '报销单已创建') },
  })
  const payMut = useMutation({
    mutationFn: () => payExpenseClaimApi(payTarget!.id, { accountId: Number(payAccount) }),
    onSuccess: () => { invalidate(); setPayTarget(null); toast.success('付款完成，已记入账户流水') },
  })
  const rejectMut = useMutation({
    mutationFn: () => rejectExpenseClaimApi(rejectTarget!.id, rejectReason.trim()),
    onSuccess: () => { invalidate(); setRejectTarget(null); toast.success('已驳回') },
  })

  function openCreate() {
    setEditingId(null); setTitle(''); setRemark(''); setItems([emptyItem()]); setFormOpen(true)
  }
  async function openEdit(c: ExpenseClaim) {
    const d = await getExpenseClaimApi(c.id)
    setEditingId(c.id); setTitle(d.title ?? ''); setRemark(d.remark ?? '')
    setItems(d.items.map(i => ({
      categoryId: String(i.categoryId), amount: String(i.amount),
      happenedAt: String(i.happenedAt).slice(0, 10), description: i.description ?? '',
    })))
    setFormOpen(true)
  }

  const columns: TableColumn<ExpenseClaim>[] = [
    { key: 'claimNo', title: '报销单号', width: 150, render: v => <span className="text-doc-code">{String(v)}</span> },
    { key: 'title', title: '事由', width: 180, render: v => (v as string) || <span className="text-muted-foreground">—</span> },
    { key: 'applicantName', title: '申请人', width: 110 },
    { key: 'itemCount', title: '笔数', width: 70, render: v => `${v ?? 0} 笔` },
    { key: 'totalAmount', title: '金额', width: 120, render: v => <span className="tabular-nums font-medium">{money(v as number)}</span> },
    { key: 'status', title: '状态', width: 100, render: (_, row) => {
      const c = row as ExpenseClaim
      return <SoftStatusLabel label={c.statusName} tone={c.statusTone as StatusTone} />
    }},
    { key: 'approvedByName', title: '审批人', width: 110, render: v => (v as string) || <span className="text-muted-foreground">—</span> },
    { key: 'paidAccountName', title: '付款账户', width: 140, render: v => (v as string) || <span className="text-muted-foreground">—</span> },
    { key: 'createdAt', title: '创建日期', width: 110, render: v => formatDisplayDate(String(v)) },
    { key: 'id', title: '操作', width: 150, render: (_, row) => {
      const c = row as ExpenseClaim
      const menu: Array<{ label: string; onClick: () => void }> = []
      if (c.status === 1) {
        menu.push({ label: '编辑', onClick: () => void openEdit(c) })
        menu.push({ label: '提交审批', onClick: () => void act(() => submitExpenseClaimApi(c.id), '已提交审批') })
      }
      if (c.status === 2) {
        menu.push({ label: '撤回', onClick: () => void act(() => withdrawExpenseClaimApi(c.id), '已撤回为草稿') })
        if (canApprove) {
          menu.push({ label: '批准', onClick: () => void act(() => approveExpenseClaimApi(c.id), '已批准，可付款') })
          menu.push({ label: '驳回', onClick: () => { setRejectTarget(c); setRejectReason('') } })
        }
      }
      if (c.status === 3 && canPay) {
        menu.push({ label: '付款', onClick: () => { setPayTarget(c); setPayAccount('') } })
      }
      if ([1, 2, 5].includes(c.status)) {
        menu.push({ label: '取消', onClick: () => void act(() => cancelExpenseClaimApi(c.id), '已取消') })
      }
      return (
        <TableActionsMenu
          primaryLabel="明细"
          primaryVariant="outline"
          onPrimaryClick={() => setDetailId(c.id)}
          items={menu}
        />
      )
    }},
  ]

  const summary = data?.summary

  return (
    <div className="space-y-4">
      <PageHeader
        title="费用报销"
        description="登记日常经营费用，审批通过后从资金账户付款。付款会自动记入账户流水。"
        actions={(
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setQueryOpen(true)}>查询</Button>
            <Button onClick={openCreate}>新建报销单</Button>
          </div>
        )}
      />

      {summary && (
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">报销总额</p>
            <p className="tabular-nums text-2xl font-bold text-foreground">{money(summary.totalAmount)}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">待审批</p>
            <p className="tabular-nums text-2xl font-bold text-warning">{money(summary.pendingAmount)}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">已付款</p>
            <p className="tabular-nums text-2xl font-bold text-success">{money(summary.paidAmount)}</p>
          </div>
        </div>
      )}

      <QueryChips chips={queryChips} onClearAll={() => { setQuery(EMPTY_EXP_QUERY); setPage(1) }} />

      <DataTable columns={columns} data={data?.list || []} loading={isLoading} rowKey="id" />

      {/* 分页 */}
      <Pagination page={page} totalPages={totalPages} total={total} unit="张"
        onPageChange={setPage} />

      <ExpensesQueryDialog open={queryOpen} initial={query} onClose={() => setQueryOpen(false)} onApply={(q) => { setQuery(q); setPage(1) }} />

      {/* 新建 / 编辑 */}
      <Dialog open={formOpen} onOpenChange={v => !v && setFormOpen(false)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>{editingId ? '编辑报销单' : '新建报销单'}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>事由</Label>
              <Input value={title} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)} placeholder="如：7月差旅与办公" />
            </div>
            <div className="space-y-1">
              <Label>备注</Label>
              <Input value={remark} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRemark(e.target.value)} />
            </div>
          </div>

          <div className="rounded-lg border border-border">
            <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2">
              <span className="text-sm font-medium">费用明细</span>
              <div className="flex items-center gap-3 text-xs">
                <span className="text-muted-foreground">合计 <span className="tabular-nums font-medium text-foreground">{money(totalAmount)}</span></span>
                <Button size="sm" variant="outline" onClick={() => setItems(p => [...p, emptyItem()])}>添加一行</Button>
              </div>
            </div>
            <div className="max-h-72 space-y-2 overflow-y-auto p-3">
              {items.map((it, idx) => (
                <div key={idx} className="grid grid-cols-12 items-center gap-2">
                  <Select value={it.categoryId} onValueChange={v => setItems(p => p.map((x, i) => i === idx ? { ...x, categoryId: v } : x))}>
                    <SelectTrigger className="col-span-3 h-9"><SelectValue placeholder="费用类别" /></SelectTrigger>
                    <SelectContent>
                      {(categories ?? []).map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number" min="0.01" step="0.01" placeholder="金额" className="col-span-2 h-9 text-right"
                    value={it.amount}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setItems(p => p.map((x, i) => i === idx ? { ...x, amount: e.target.value } : x))}
                  />
                  <div className="col-span-3">
                    <DatePicker value={it.happenedAt} className="h-9"
                      onChange={v => setItems(p => p.map((x, i) => i === idx ? { ...x, happenedAt: v } : x))} />
                  </div>
                  <Input
                    placeholder="说明" className="col-span-3 h-9"
                    value={it.description}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setItems(p => p.map((x, i) => i === idx ? { ...x, description: e.target.value } : x))}
                  />
                  <Button size="sm" variant="ghost" className="col-span-1"
                    disabled={items.length === 1}
                    onClick={() => setItems(p => p.filter((_, i) => i !== idx))}>
                    删除
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>取消</Button>
            <Button disabled={totalAmount <= 0 || saveMut.isPending} onClick={() => saveMut.mutate()}>
              {saveMut.isPending ? '保存中…' : `保存（${money(totalAmount)}）`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 明细 */}
      <Dialog open={detailId != null} onOpenChange={v => !v && setDetailId(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>报销单 — <span className="text-doc-code-strong">{detail?.claimNo}</span></DialogTitle></DialogHeader>
          {detail && (
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>{detail.applicantName}</span>
              <SoftStatusLabel label={detail.statusName} tone={detail.statusTone as StatusTone} />
              <span>· 合计 <span className="font-medium text-foreground">{money(detail.totalAmount)}</span></span>
              {detail.approvedByName && <span>· 审批 {detail.approvedByName}</span>}
              {detail.paidAccountName && <span>· 付款账户 {detail.paidAccountName}</span>}
            </div>
          )}
          {detail?.rejectReason && (
            <p className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              驳回原因：{detail.rejectReason}
            </p>
          )}
          <div className="max-h-80 overflow-y-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 text-left">类别</th>
                  <th className="px-2 py-1.5 text-left">发生日期</th>
                  <th className="px-2 py-1.5 text-left">说明</th>
                  <th className="px-2 py-1.5 text-right">金额</th>
                </tr>
              </thead>
              <tbody>
                {detail?.items?.map((i, idx) => (
                  <tr key={idx} className="border-t">
                    <td className="px-2 py-1.5">{i.categoryName}</td>
                    <td className="px-2 py-1.5">{formatDisplayDate(String(i.happenedAt))}</td>
                    <td className="px-2 py-1.5 text-muted-foreground">{i.description || '—'}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{money(i.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setDetailId(null)}>关闭</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 付款 */}
      <Dialog open={!!payTarget} onOpenChange={v => !v && setPayTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>报销付款 — {payTarget?.claimNo}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            将从所选账户支出 <span className="font-semibold text-foreground">{payTarget ? money(payTarget.totalAmount) : ''}</span>，
            并写入该账户流水。付款后单据不可再改。
          </p>
          <div className="space-y-1">
            <Label>付款账户 *</Label>
            <Select value={payAccount} onValueChange={setPayAccount}>
              <SelectTrigger className="h-10"><SelectValue placeholder="请选择账户" /></SelectTrigger>
              <SelectContent>
                {(accounts ?? []).map(a => (
                  <SelectItem key={a.id} value={String(a.id)}>{a.name}（余额 {money(a.currentBalance)}）</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayTarget(null)}>取消</Button>
            <Button disabled={!payAccount || payMut.isPending} onClick={() => {
              // 报销付款恒为账户支出，透支前二次确认（后端仍允许，属软性提示）
              const acc = (accounts ?? []).find(a => String(a.id) === payAccount)
              if (payTarget && acc && payTarget.totalAmount > acc.currentBalance + 1e-6) {
                confirmAction({
                  title: '账户余额不足',
                  description: `账户「${acc.name}」当前余额 ${money(acc.currentBalance)}，本次付款 ${money(payTarget.totalAmount)} 将形成负余额。确认继续？`,
                  variant: 'destructive',
                  confirmText: '仍然付款',
                  onConfirm: () => payMut.mutate(),
                })
                return
              }
              payMut.mutate()
            }}>
              {payMut.isPending ? '付款中…' : '确认付款'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 驳回 */}
      <Dialog open={!!rejectTarget} onOpenChange={v => !v && setRejectTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>驳回报销单 — {rejectTarget?.claimNo}</DialogTitle></DialogHeader>
          <div className="space-y-1">
            <Label>驳回原因 *</Label>
            <Input value={rejectReason} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRejectReason(e.target.value)}
              placeholder="如：缺少发票，请补充后重新提交" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>取消</Button>
            <Button disabled={!rejectReason.trim() || rejectMut.isPending} onClick={() => rejectMut.mutate()}>
              {rejectMut.isPending ? '提交中…' : '确认驳回'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
