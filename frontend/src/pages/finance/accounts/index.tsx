import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import TableActionsMenu from '@/components/shared/TableActionsMenu'
import { QueryChips, type QueryChip } from '@/components/shared/QueryChips'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { activeTone } from '@/lib/statusTone'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { toast } from '@/lib/toast'
import { formatDisplayDate } from '@/lib/dateTime'
import { downloadExport } from '@/lib/exportDownload'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import {
  getAccountsApi, createAccountApi, updateAccountApi, deleteAccountApi,
  adjustAccountApi, getAccountTransactionsApi, type FinanceAccount,
} from '@/api/finance'
import type { TableColumn } from '@/types'

const money = (n: number) => `¥${Number(n).toFixed(2)}`
const TYPE_OPTIONS = [
  ['1', '银行账户'], ['2', '现金'], ['3', '支付宝'], ['4', '微信'], ['5', '其他'],
] as const

const EMPTY_FORM = {
  name: '', type: '1', accountNo: '', bankName: '', holder: '',
  openingBalance: '0', sortOrder: '0', remark: '', isActive: true,
}

interface AcctQuery { keyword: string; type: string; isActive: string }
const EMPTY_ACCT_QUERY: AcctQuery = { keyword: '', type: '', isActive: '' }
const TYPE_NAME: Record<string, string> = Object.fromEntries(TYPE_OPTIONS.map(([v, l]) => [v, l]))

/** 资金账户查询弹窗：关键字 + 账户类型 + 启用状态。条件收在弹窗里，页面右上角只留「查询」入口。 */
function AccountsQueryDialog({ open, initial, onClose, onApply }: {
  open: boolean; initial: AcctQuery; onClose: () => void; onApply: (q: AcctQuery) => void
}) {
  const [v, setV] = useState<AcctQuery>(initial)
  useEffect(() => { if (open) setV(initial) }, [open, initial])
  return (
    <Dialog open={open} onOpenChange={x => !x && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>查询资金账户</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>关键字</Label>
            <Input className="h-9" placeholder="编码 / 名称 / 账号" value={v.keyword}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setV(p => ({ ...p, keyword: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>账户类型</Label>
              <Select value={v.type || '__all__'} onValueChange={x => setV(p => ({ ...p, type: x === '__all__' ? '' : x }))}>
                <SelectTrigger className="h-9"><SelectValue placeholder="全部" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">全部</SelectItem>
                  {TYPE_OPTIONS.map(([val, l]) => <SelectItem key={val} value={val}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>状态</Label>
              <Select value={v.isActive || '__all__'} onValueChange={x => setV(p => ({ ...p, isActive: x === '__all__' ? '' : x }))}>
                <SelectTrigger className="h-9"><SelectValue placeholder="全部" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">全部</SelectItem>
                  <SelectItem value="1">启用</SelectItem>
                  <SelectItem value="0">停用</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setV(EMPTY_ACCT_QUERY)}>清空</Button>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={() => { onApply(v); onClose() }}>查询</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function FinanceAccountsPage() {
  const qc = useQueryClient()
  const { can } = usePermission()
  const canUpdate = can(PERMISSIONS.FINANCE_ACCOUNT_UPDATE)
  const canAdjust = can(PERMISSIONS.FINANCE_ACCOUNT_ADJUST)

  const [query, setQuery] = useState<AcctQuery>(EMPTY_ACCT_QUERY)
  const [queryOpen, setQueryOpen] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<FinanceAccount | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [txAccount, setTxAccount] = useState<FinanceAccount | null>(null)
  const [adjustTarget, setAdjustTarget] = useState<FinanceAccount | null>(null)
  const [adjustBalance, setAdjustBalance] = useState('')
  const [adjustRemark, setAdjustRemark] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<FinanceAccount | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['finance-accounts', query],
    queryFn: () => getAccountsApi({
      keyword: query.keyword || undefined,
      type: query.type || undefined,
      isActive: query.isActive || undefined,
    }),
  })

  const queryChips: QueryChip[] = []
  const dropQ = (k: keyof AcctQuery) => () => setQuery(q => ({ ...q, [k]: '' }))
  if (query.keyword) queryChips.push({ key: 'kw', text: `搜索：${query.keyword}`, onClear: dropQ('keyword') })
  if (query.type) queryChips.push({ key: 'type', text: `类型：${TYPE_NAME[query.type] ?? query.type}`, onClear: dropQ('type') })
  if (query.isActive) queryChips.push({ key: 'act', text: `状态：${query.isActive === '1' ? '启用' : '停用'}`, onClear: dropQ('isActive') })
  const { data: transactions } = useQuery({
    queryKey: ['finance-account-transactions', txAccount?.id],
    queryFn: () => getAccountTransactionsApi({ accountId: txAccount!.id, pageSize: 200 }),
    enabled: !!txAccount,
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['finance-accounts'] })
    qc.invalidateQueries({ queryKey: ['finance-account-transactions'] })
    // 账户余额变化会改变看板的余额分布与收支，看板缓存一并失效
    qc.invalidateQueries({ queryKey: ['finance-dashboard'] })
  }

  const saveMut = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name.trim(),
        type: Number(form.type),
        accountNo: form.accountNo || undefined,
        bankName: form.bankName || undefined,
        holder: form.holder || undefined,
        openingBalance: Number(form.openingBalance) || 0,
        sortOrder: Number(form.sortOrder) || 0,
        remark: form.remark || undefined,
      }
      return editing
        ? updateAccountApi(editing.id, { ...payload, isActive: form.isActive })
        : createAccountApi(payload)
    },
    onSuccess: () => { invalidate(); setFormOpen(false); toast.success(editing ? '账户已保存' : '账户已创建') },
  })
  const adjustMut = useMutation({
    mutationFn: () => adjustAccountApi(adjustTarget!.id, {
      targetBalance: Number(adjustBalance),
      remark: adjustRemark || undefined,
    }),
    onSuccess: (res) => {
      invalidate(); setAdjustTarget(null)
      toast.success(`余额已调整为 ${money(res.balance)}（差额 ${money(Math.abs(res.diff))}）`)
    },
  })
  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteAccountApi(id),
    onSuccess: () => { invalidate(); setDeleteTarget(null); toast.success('账户已删除') },
  })

  function openCreate() { setEditing(null); setForm(EMPTY_FORM); setFormOpen(true) }
  function openEdit(a: FinanceAccount) {
    setEditing(a)
    setForm({
      name: a.name, type: String(a.type), accountNo: a.accountNo ?? '', bankName: a.bankName ?? '',
      holder: a.holder ?? '', openingBalance: String(a.openingBalance), sortOrder: String(a.sortOrder),
      remark: a.remark ?? '', isActive: a.isActive,
    })
    setFormOpen(true)
  }

  const columns: TableColumn<FinanceAccount>[] = [
    { key: 'code', title: '编码', width: 110, render: v => <span className="text-doc-code">{String(v)}</span> },
    { key: 'name', title: '账户名称', width: 180 },
    { key: 'type', title: '类型', width: 100, render: (_, row) => <SoftStatusLabel label={(row as FinanceAccount).typeName} tone="info" /> },
    { key: 'accountNo', title: '账号', width: 180, render: (v, row) => {
      const r = row as FinanceAccount
      return v ? <span className="text-doc-code-muted">{String(v)}{r.bankName ? ` · ${r.bankName}` : ''}</span> : <span className="text-muted-foreground">—</span>
    }},
    { key: 'openingBalance', title: '期初余额', width: 120, render: v => <span className="tabular-nums text-muted-foreground">{money(v as number)}</span> },
    { key: 'currentBalance', title: '当前余额', width: 130, render: v => (
      <span className={`tabular-nums font-semibold ${Number(v) < 0 ? 'text-destructive' : 'text-foreground'}`}>{money(v as number)}</span>
    )},
    { key: 'isActive', title: '状态', width: 80, render: (_, row) => {
      const r = row as FinanceAccount
      return <SoftStatusLabel label={r.isActive ? '启用' : '停用'} tone={activeTone(r.isActive)} />
    }},
    { key: 'id', title: '操作', width: 140, render: (_, row) => {
      const a = row as FinanceAccount
      return (
        <TableActionsMenu
          primaryLabel="流水"
          primaryVariant="outline"
          onPrimaryClick={() => setTxAccount(a)}
          items={[
            ...(canUpdate ? [{ label: '编辑', onClick: () => openEdit(a) }] : []),
            ...(canAdjust ? [{ label: '余额调整', onClick: () => { setAdjustTarget(a); setAdjustBalance(String(a.currentBalance)); setAdjustRemark('') } }] : []),
            { label: '删除', onClick: () => setDeleteTarget(a) },
          ]}
        />
      )
    }},
  ]

  const summary = data?.summary

  return (
    <div className="space-y-4">
      <PageHeader
        title="账户管理"
        description="管理银行、现金等收付款账户；余额由流水实时汇总，不可直接修改。"
        actions={(
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => downloadExport('/export/finance-accounts').catch(e => toast.error((e as Error).message))}>导出</Button>
            <Button variant="outline" onClick={() => setQueryOpen(true)}>查询</Button>
            <Button onClick={openCreate}>新建账户</Button>
          </div>
        )}
      />

      {summary && (
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <span className="text-sm text-muted-foreground">资金合计（{summary.accountCount} 个账户）</span>
          <span className="ml-3 tabular-nums text-2xl font-bold text-foreground">{money(summary.totalBalance)}</span>
        </div>
      )}

      <QueryChips chips={queryChips} onClearAll={() => setQuery(EMPTY_ACCT_QUERY)} />

      <DataTable columns={columns} data={data?.list || []} loading={isLoading} rowKey="id" />

      <AccountsQueryDialog open={queryOpen} initial={query} onClose={() => setQueryOpen(false)} onApply={setQuery} />

      {/* 新建 / 编辑 */}
      <Dialog open={formOpen} onOpenChange={v => !v && setFormOpen(false)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{editing ? '编辑账户' : '新建账户'}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>账户名称 *</Label>
              <Input value={form.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, name: e.target.value }))} placeholder="如：工商银行基本户" />
            </div>
            <div className="space-y-1">
              <Label>类型 *</Label>
              <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>账号</Label>
              <Input value={form.accountNo} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, accountNo: e.target.value }))} placeholder="现金账户可留空" />
            </div>
            <div className="space-y-1">
              <Label>开户行</Label>
              <Input value={form.bankName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, bankName: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>户名</Label>
              <Input value={form.holder} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, holder: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>期初余额</Label>
              <Input type="number" step="0.01" value={form.openingBalance}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, openingBalance: e.target.value }))} />
              {editing && <p className="text-helper">已有流水后不可再改，需调整请用「余额调整」</p>}
            </div>
            <div className="space-y-1 col-span-2">
              <Label>备注</Label>
              <Input value={form.remark} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, remark: e.target.value }))} />
            </div>
            {editing && (
              <div className="col-span-2 flex items-center gap-2">
                <input type="checkbox" id="acc-active" className="accent-primary" checked={form.isActive}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, isActive: e.target.checked }))} />
                <Label htmlFor="acc-active" className="cursor-pointer">启用（停用后不可再选作收付款账户）</Label>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>取消</Button>
            <Button disabled={!form.name.trim() || saveMut.isPending} onClick={() => saveMut.mutate()}>
              {saveMut.isPending ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 账户流水 */}
      <Dialog open={!!txAccount} onOpenChange={v => !v && setTxAccount(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle>账户流水 — {txAccount?.name}</DialogTitle></DialogHeader>
          {txAccount && (
            <div className="text-sm text-muted-foreground">
              当前余额 <span className="font-semibold text-foreground">{money(txAccount.currentBalance)}</span>
              {transactions && <>
                {' '}· 期间收入 <span className="text-success">{money(transactions.summary.inAmount)}</span>
                {' '}· 支出 <span className="text-destructive">{money(transactions.summary.outAmount)}</span>
              </>}
            </div>
          )}
          <div className="max-h-96 overflow-y-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 text-left">日期</th>
                  <th className="px-2 py-1.5 text-left">类型</th>
                  <th className="px-2 py-1.5 text-left">关联单号</th>
                  <th className="px-2 py-1.5 text-left">往来方</th>
                  <th className="px-2 py-1.5 text-right">收入</th>
                  <th className="px-2 py-1.5 text-right">支出</th>
                  <th className="px-2 py-1.5 text-right">余额</th>
                </tr>
              </thead>
              <tbody>
                {transactions?.list.map(t => (
                  <tr key={t.id} className="border-t">
                    <td className="px-2 py-1.5">{formatDisplayDate(String(t.happenedAt))}</td>
                    <td className="px-2 py-1.5"><SoftStatusLabel label={t.bizTypeName} tone={t.bizType === 4 ? 'warning' : 'info'} /></td>
                    <td className="px-2 py-1.5 text-doc-code-muted">{t.bizNo || '—'}</td>
                    <td className="px-2 py-1.5">{t.partyName || '—'}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-success">{t.direction === 1 ? money(t.amount) : ''}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-destructive">{t.direction === 2 ? money(t.amount) : ''}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-medium">{money(t.balanceAfter)}</td>
                  </tr>
                ))}
                {transactions && !transactions.list.length && (
                  <tr><td colSpan={7} className="px-2 py-6 text-center text-muted-foreground">该账户还没有流水</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setTxAccount(null)}>关闭</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 余额调整：不直接改余额，补一笔差额流水留痕 */}
      <Dialog open={!!adjustTarget} onOpenChange={v => !v && setAdjustTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>余额调整 — {adjustTarget?.name}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            账实不符时用它对平。系统会按差额补一笔「余额调整」流水，不会直接改写余额，调整过程可追溯。
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>当前余额</Label>
              <Input value={adjustTarget ? money(adjustTarget.currentBalance) : ''} disabled className="bg-muted/50" />
            </div>
            <div className="space-y-1">
              <Label>调整后余额 *</Label>
              <Input type="number" step="0.01" value={adjustBalance}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAdjustBalance(e.target.value)} />
            </div>
            <div className="space-y-1 col-span-2">
              <Label>调整原因</Label>
              <Input value={adjustRemark} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAdjustRemark(e.target.value)} placeholder="如：与银行流水核对差异" />
            </div>
          </div>
          {adjustTarget && adjustBalance !== '' && (
            <p className="text-sm">
              将产生差额流水：
              <span className={`ml-1 font-semibold tabular-nums ${Number(adjustBalance) >= adjustTarget.currentBalance ? 'text-success' : 'text-destructive'}`}>
                {Number(adjustBalance) >= adjustTarget.currentBalance ? '+' : '-'}
                {money(Math.abs(Number(adjustBalance) - adjustTarget.currentBalance))}
              </span>
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustTarget(null)}>取消</Button>
            <Button disabled={adjustBalance === '' || adjustMut.isPending} onClick={() => adjustMut.mutate()}>
              {adjustMut.isPending ? '调整中…' : '确认调整'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        title="删除账户"
        description={`确定删除账户「${deleteTarget?.name}」？有流水的账户不能删除，请改为停用。`}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
      />
    </div>
  )
}
