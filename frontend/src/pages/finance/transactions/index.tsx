import { useVisibleQuery } from '@/hooks/useVisibleQuery'
import { SummaryStrip } from '@/components/shared/SummaryStrip'
import { money } from '@/lib/format'
import { useState, useEffect, useRef, useSyncExternalStore, useId } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import ListSummary from '@/components/shared/ListSummary'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { QueryChips, type QueryChip } from '@/components/shared/QueryChips'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DatePicker } from '@/components/shared/DatePicker'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { toast } from '@/lib/toast'
import { downloadExport } from '@/lib/exportDownload'
import { formatDisplayDate, todayYmd } from '@/lib/dateTime'
import { getAccountTransactionsApi, getActiveAccountsApi, type AccountTransaction } from '@/api/finance'
import { usePermission } from '@/hooks/usePermission'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import { PERMISSIONS as P } from '@/lib/permission-codes'
import { captureDisposalOwner, disposalOwnerCurrent, disposalConfig, disposalEpoch, subscribeDisposalRecovery } from '@/lib/disposalRecovery'
import { getSupplierRefundTraceApi } from '@/api/finance'
import type { TableColumn } from '@/types'


/** 与后端 finance-accounts.service 的 BIZ_TYPE 对齐 */
const BIZ_TYPE_OPTIONS = [
  ['1', '收款'], ['2', '付款'], ['3', '费用报销'], ['4', '余额调整'], ['5', '退货退款'], ['6', '供应商退款'],
] as const
const BIZ_TYPE_NAME: Record<string, string> = Object.fromEntries(BIZ_TYPE_OPTIONS.map(([v, l]) => [v, l]))
const DIRECTION_NAME: Record<string, string> = { '1': '收入', '2': '支出' }

interface TxQuery {
  accountId: string; bizType: string; direction: string
  startDate: string; endDate: string; keyword: string
}
const EMPTY_TX_QUERY: TxQuery = {
  accountId: '', bizType: '', direction: '',
  startDate: todayYmd(), endDate: todayYmd(), keyword: '',
}

/** 资金流水查询弹窗：账户 + 业务类型 + 收支方向 + 发生日期区间 + 关键字 */
function TransactionsQueryDialog({ open, initial, accounts, onClose, onApply }: {
  open: boolean
  initial: TxQuery
  accounts: Array<{ id: number; name: string }>
  onClose: () => void
  onApply: (q: TxQuery) => void
}) {
  const inputId = useId()
  const [v, setV] = useState<TxQuery>(initial)
  useEffect(() => { if (open) setV(initial) }, [open, initial])
  const set = (patch: Partial<TxQuery>) => setV(p => ({ ...p, ...patch }))
  return (
    <Dialog open={open} onOpenChange={x => !x && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>查询资金流水</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor={`${inputId}-accountId`}>资金账户</Label>
              <Select value={v.accountId || '__all__'} onValueChange={x => set({ accountId: x === '__all__' ? '' : x })}>
                <SelectTrigger id={`${inputId}-accountId`} className="h-9"><SelectValue placeholder="全部账户" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">全部账户</SelectItem>
                  {accounts.map(a => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${inputId}-keyword`}>关键字</Label>
              <Input id={`${inputId}-keyword`} className="h-9" placeholder="关联单号 / 往来单位" value={v.keyword}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => set({ keyword: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor={`${inputId}-bizType`}>业务类型</Label>
              <Select value={v.bizType || '__all__'} onValueChange={x => set({ bizType: x === '__all__' ? '' : x })}>
                <SelectTrigger id={`${inputId}-bizType`} className="h-9"><SelectValue placeholder="全部" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">全部</SelectItem>
                  {BIZ_TYPE_OPTIONS.map(([val, l]) => <SelectItem key={val} value={val}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${inputId}-direction`}>收支方向</Label>
              <Select value={v.direction || '__all__'} onValueChange={x => set({ direction: x === '__all__' ? '' : x })}>
                <SelectTrigger id={`${inputId}-direction`} className="h-9"><SelectValue placeholder="全部" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">全部</SelectItem>
                  <SelectItem value="1">收入</SelectItem>
                  <SelectItem value="2">支出</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-sm font-medium">发生日期</div>
            <div className="flex items-center gap-2">
              <Label htmlFor={`${inputId}-startDate`} className="sr-only">发生日期（起）</Label>
              <DatePicker id={`${inputId}-startDate`} value={v.startDate} onChange={x => set({ startDate: x })} max={v.endDate || undefined} className="h-9 flex-1" />
              <span className="text-muted-foreground">至</span>
              <Label htmlFor={`${inputId}-endDate`} className="sr-only">发生日期（止）</Label>
              <DatePicker id={`${inputId}-endDate`} value={v.endDate} onChange={x => set({ endDate: x })} min={v.startDate || undefined} className="h-9 flex-1" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setV({ ...EMPTY_TX_QUERY, startDate: '', endDate: '' })}>清空</Button>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={() => { onApply(v); onClose() }}>查询</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * 资金流水：所有资金账户的收支明细。
 *
 * 与账户管理页的单账户流水弹窗同一数据源（GET /finance/accounts/transactions），
 * 区别是这里可跨账户查、带筛选。流水是账户余额的唯一事实源，只读不可改——
 * 要调整余额走账户管理页的「余额调整」（补一笔差额流水留痕）。
 */
export default function FinanceTransactionsPage() {
  const active = useActiveWorkspaceTab(), { can } = usePermission()
  const readEpoch=useSyncExternalStore(subscribeDisposalRecovery, disposalEpoch)
  const activity=useRef({active,generation:0})
  if(activity.current.active!==active){activity.current={active,generation:activity.current.generation+1}}
  const readOwner=captureDisposalOwner(),readActivity=activity.current.generation
  const [trace,setTrace]=useState<{ id:number; owner:ReturnType<typeof captureDisposalOwner>; activity:number; refundNo:string; fundId:number; amount4:string } | null>(null)
  const mayTrace=can(P.SUPPLIER_REFUND_VIEW)&&can(P.PURCHASE_ORDER_VIEW)&&can(P.RETURN_ORDER_VIEW)&&can(P.PAYMENT_VIEW)
  const traceCurrent=!!trace&&active&&mayTrace&&trace.activity===activity.current.generation&&disposalOwnerCurrent(trace.owner)
  const traceQuery=useVisibleQuery({
    queryKey:['supplier-refund-trace',trace?.id,trace?.owner.epoch,trace?.activity],
    queryFn:({signal})=>getSupplierRefundTraceApi(trace!.id,{...disposalConfig(trace!.owner),signal}),
    enabled:traceCurrent, staleTime:0,
  })
  const [query, setQuery] = useState<TxQuery>(EMPTY_TX_QUERY)
  const [queryOpen, setQueryOpen] = useState(false)

  const PAGE_SIZE = 50
  const params = {
    page: 1,
    pageSize: PAGE_SIZE,
    accountId: query.accountId ? Number(query.accountId) : undefined,
    bizType: query.bizType || undefined,
    direction: query.direction || undefined,
    startDate: query.startDate || undefined,
    endDate: query.endDate || undefined,
    keyword: query.keyword || undefined,
  }
  const { data, isLoading, isError, error, refetch } = useVisibleQuery({
    queryKey: ['finance-account-transactions', 'page', query, readEpoch],
    queryFn: ({signal}) => getAccountTransactionsApi(params,{...disposalConfig(readOwner),signal}),
    enabled:can(P.FINANCE_ACCOUNT_VIEW),
  })
  const { data: accounts } = useVisibleQuery({
    queryKey: ['finance-accounts', 'active', readEpoch],
    queryFn: ({signal}) => getActiveAccountsApi({...disposalConfig(readOwner),signal}),
    enabled:can(P.FINANCE_ACCOUNT_VIEW),
  })

  const traceData=traceCurrent&&traceQuery.data&&traceQuery.data.id===trace?.id&&traceQuery.data.refund_no===trace.refundNo&&traceQuery.data.fund_transaction_id===trace.fundId&&traceQuery.data.amount===trace.amount4?traceQuery.data:null
  const total = data?.pagination?.total ?? 0

  const queryChips: QueryChip[] = []
  const dropQ = (...ks: (keyof TxQuery)[]) => () => {
    setQuery(q => ks.reduce((a, k) => ({ ...a, [k]: '' }), { ...q }));
  }
  const accountName = accounts?.find(a => String(a.id) === query.accountId)?.name
  if (query.accountId) queryChips.push({ key: 'acc', text: `账户：${accountName ?? query.accountId}`, onClear: dropQ('accountId') })
  if (query.bizType) queryChips.push({ key: 'biz', text: `类型：${BIZ_TYPE_NAME[query.bizType] ?? query.bizType}`, onClear: dropQ('bizType') })
  if (query.direction) queryChips.push({ key: 'dir', text: `方向：${DIRECTION_NAME[query.direction] ?? query.direction}`, onClear: dropQ('direction') })
  if (query.startDate || query.endDate) queryChips.push({ key: 'date', text: `发生日期：${query.startDate || '…'} ~ ${query.endDate || '…'}`, onClear: dropQ('startDate', 'endDate') })
  if (query.keyword) queryChips.push({ key: 'kw', text: `搜索：${query.keyword}`, onClear: dropQ('keyword') })

  const columns: TableColumn<AccountTransaction>[] = [
    { key: 'happenedAt', title: '日期', width: 110, render: v => formatDisplayDate(String(v)) },
    { key: 'accountName', title: '账户', width: 150, render: v => (v as string) || <span className="text-muted-foreground">—</span> },
    { key: 'bizType', title: '类型', width: 100, render: (_, row) => {
      const t = row as AccountTransaction
      // 余额调整是人工对平账目的动作，与常规收付款区分开
      return <SoftStatusLabel label={t.bizTypeName} tone={t.bizType === 4 ? 'warning' : 'info'} />
    }},
    { key: 'bizNo', title: '关联单号', width: 160, render: (v,row) => (row as AccountTransaction).bizType===6 && mayTrace && Number.isSafeInteger((row as AccountTransaction).bizId) && Number((row as AccountTransaction).bizId)>0
      ? <Button size="sm" variant="link" onClick={()=>{if(activity.current.active&&readActivity===activity.current.generation&&disposalOwnerCurrent(readOwner)&&mayTrace)setTrace({id:Number((row as AccountTransaction).bizId),owner:readOwner,activity:readActivity,refundNo:String(v),fundId:Number((row as AccountTransaction).id),amount4:Number((row as AccountTransaction).amount).toFixed(4)})}}>{String(v)}</Button>
      : v ? <span className="text-doc-code-muted">{String(v)}</span>
      : <span className="text-muted-foreground">—</span> },
    { key: 'partyName', title: '往来单位', width: 150, render: v => (v as string) || <span className="text-muted-foreground">—</span> },
    { key: 'amount', title: '收入', width: 120, align: 'right', render: (_, row) => {
      const t = row as AccountTransaction
      return t.direction === 1 ? <span className="tabular-nums font-medium text-success-ink">{t.bizType===6?Number(t.amount).toFixed(4):money(t.amount)}</span> : <span className="text-muted-foreground">—</span>
    }},
    { key: 'direction', title: '支出', width: 120, align: 'right', render: (_, row) => {
      const t = row as AccountTransaction
      return t.direction === 2 ? <span className="tabular-nums font-medium text-destructive-ink">{money(t.amount)}</span> : <span className="text-muted-foreground">—</span>
    }},
    { key: 'balanceAfter', title: '账户余额', width: 130, align: 'right', render: v => (
      <span className={`tabular-nums ${Number(v) < 0 ? 'text-destructive-ink' : 'text-foreground'}`}>{money(v as number)}</span>
    )},
    { key: 'operatorName', title: '操作人', width: 100, render: v => (v as string) || <span className="text-muted-foreground">—</span> },
    { key: 'remark', title: '备注', expandableText: true, width: 200, render: v => (v as string) || <span className="text-muted-foreground">—</span> },
  ]

  const summary = data?.summary
  const netAmount = summary ? summary.inAmount - summary.outAmount : 0

  return (
    <div className="space-y-4">
      <PageHeader
        title="资金流水"
        description="所有资金账户的收支明细。账户余额以流水为准；如需对平账实差异，请到账户管理页做「余额调整」。"
        actions={(
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => downloadExport('/export/finance-transactions', {
              ...(query.accountId ? { accountId: query.accountId } : {}),
              ...(query.bizType ? { bizType: query.bizType } : {}),
              ...(query.direction ? { direction: query.direction } : {}),
              ...(query.startDate ? { startDate: query.startDate } : {}),
              ...(query.endDate ? { endDate: query.endDate } : {}),
              ...(query.keyword ? { keyword: query.keyword } : {}),
            }).catch(e => toast.error((e as Error).message))}>导出</Button>
            <Button variant="outline" onClick={() => setQueryOpen(true)}>查询</Button>
          </div>
        )}
      />

      {summary && !isError && <SummaryStrip items={[{ label: '期间收入', value: money(summary.inAmount), tone: 'text-success-ink' }, { label: '期间支出', value: money(summary.outAmount), tone: 'text-destructive-ink' }, { label: '净额', value: money(netAmount), tone: netAmount < 0 ? 'text-destructive-ink' : 'text-foreground' }]} />}

      <QueryChips chips={queryChips} onClearAll={() => { setQuery({ ...EMPTY_TX_QUERY, startDate: '', endDate: '' }); }} />

      {isError ? <QueryErrorState error={error} onRetry={() => void refetch()} /> : <DataTable columns={columns} data={data?.list || []} loading={isLoading} rowKey="id" />}

      {!isError && !isLoading && data && <ListSummary total={total} unit="笔" />}

      <Dialog open={traceCurrent} onOpenChange={open=>{if(!open&&traceCurrent)setTrace(null)}}>
        <DialogContent aria-describedby={undefined}><DialogHeader><DialogTitle>供应商退款</DialogTitle></DialogHeader>
          {traceQuery.isError ? <QueryErrorState compact error={traceQuery.error} onRetry={() => void traceQuery.refetch()} /> : <>
          {traceQuery.isLoading && <p>正在加载原退款单…</p>}
          {traceCurrent && traceQuery.data && !traceData && <p>原退款单与这笔流水不符，请人工核对。</p>}
          {traceCurrent && traceData && <div className="space-y-2 text-sm">
            <p>{traceData!.refund_no} / {formatDisplayDate(traceData!.refund_date)}</p>
            <p className="tabular-nums">回款 {traceData!.amount}</p>
            <p>{traceData!.voucher_generate_error || (typeof traceData!.voucher_id==='number'&&Number.isSafeInteger(traceData!.voucher_id)&&traceData!.voucher_id>0?'凭证已生成':'凭证待核对')}</p>
          </div>}
          </>}
        </DialogContent>
      </Dialog>
      <TransactionsQueryDialog
        open={queryOpen}
        initial={query}
        accounts={accounts ?? []}
        onClose={() => setQueryOpen(false)}
        onApply={q => { setQuery(q); }}
      />
    </div>
  )
}
