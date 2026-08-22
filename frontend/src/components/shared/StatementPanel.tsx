import { useEffect, useMemo, useState, forwardRef, useImperativeHandle } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import DataTable from '@/components/shared/DataTable'
import TableActionsMenu, { type TableActionItem } from '@/components/shared/TableActionsMenu'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DatePicker } from '@/components/shared/DatePicker'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import type { StatusTone } from '@/lib/statusTone'
import { toast } from '@/lib/toast'
import { formatDisplayDate } from '@/lib/dateTime'
import { downloadExport } from '@/lib/exportDownload'
import {
  getStatementsApi, getStatementDetailApi, getStatementCandidatesApi,
  createStatementApi, confirmStatementApi, unlockStatementApi, removeStatementItemApi,
  type ReconciliationStatement, type StatementItem,
} from '@/api/payments'
import { getRelativeDateRange } from '@/lib/dateRange'
import { PaymentQueryDialog, PaymentQueryBar, EMPTY_PAYMENT_QUERY, type PaymentQueryValues } from '@/components/shared/PaymentQueryDialog'
import type { TableColumn } from '@/types'

/** 1草稿 = 还能改 · 2已确认 = 锁定可发对方 · 3已核销 = 收完款 */
const ST_TONE: Record<number, StatusTone> = { 1: 'draft', 2: 'active', 3: 'success' }
const money = (n: number) => `¥${Number(n).toFixed(2)}`

interface Props {
  /** 1=供应商对账（应付）2=客户对账（应收） */
  type: 1 | 2
  /** 隐藏面板自带工具条按钮，交由父级 PageHeader 渲染（与「全部账款」tab 对齐）；筛选标签仍留在面板内 */
  hideToolbar?: boolean
}

/** 父级（PageHeader）驱动面板动作的句柄 */
export interface StatementPanelHandle {
  openQuery: () => void
  openCreate: () => void
  exportExcel: () => void
}

/**
 * 汇总对账：把一段期间的多笔月结账款汇总成一张对账单，确认锁定后发对方核对，
 * 对方汇款后在「收款核销」里冲抵这张单。
 *
 * 已确认的单可以解锁回草稿继续改，但**已核销过的不允许解锁**——服务端也会拦，
 * 否则改完明细后已收的钱对不上任何账款。
 */
export const StatementPanel = forwardRef<StatementPanelHandle, Props>(function StatementPanel(
  { type, hideToolbar = false }, ref,
) {
  const qc = useQueryClient()
  const isPayable = type === 1
  const partyLabel = isPayable ? '供应商' : '客户'

  const [query, setQuery] = useState<PaymentQueryValues>(EMPTY_PAYMENT_QUERY)
  const [queryOpen, setQueryOpen] = useState(false)
  const queryLabels = {
    docLabel: '对账单号',
    partyLabel,
    statusText: (v: string) => ({ '1':'草稿', '2':'已确认', '3':'已核销' }[v] ?? v),
    dateLabel: '创建日期',
    amountLabel: '汇总金额',
  }
  const [createOpen, setCreateOpen] = useState(false)
  const [detailId, setDetailId] = useState<number | null>(null)

  const exportParams = {
    type: String(type),
    ...(query.docNo ? { statementNo: query.docNo } : {}),
    ...(query.partyName ? { partyName: query.partyName } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.startDate ? { startDate: query.startDate } : {}),
    ...(query.endDate ? { endDate: query.endDate } : {}),
    ...(query.minAmount ? { minAmount: query.minAmount } : {}),
    ...(query.maxAmount ? { maxAmount: query.maxAmount } : {}),
  }
  const { data, isLoading } = useQuery({
    queryKey: ['payment-statements', { type, query }],
    queryFn: () => getStatementsApi({ ...exportParams, pageSize: 500 }),
  })
  const { data: detail } = useQuery({
    queryKey: ['payment-statement-detail', detailId],
    queryFn: () => getStatementDetailApi(detailId!),
    enabled: detailId != null,
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['payment-statements'] })
    qc.invalidateQueries({ queryKey: ['payment-statement-detail'] })
    qc.invalidateQueries({ queryKey: ['reconciliation'] })
  }

  const handleExport = () => downloadExport('/export/statements', exportParams)
    .catch(e => toast.error((e as Error).message))
  // 工具条按钮被父级挪进 PageHeader 后，通过 ref 触发面板内部的查询/新建/导出
  useImperativeHandle(ref, () => ({
    openQuery: () => setQueryOpen(true),
    openCreate: () => setCreateOpen(true),
    exportExcel: handleExport,
  }))

  const confirmMut = useMutation({
    mutationFn: (id: number) => confirmStatementApi(id),
    onSuccess: () => { invalidate(); toast.success('对账单已确认，可导出发对方核对') },
  })
  const unlockMut = useMutation({
    mutationFn: (id: number) => unlockStatementApi(id),
    onSuccess: () => { invalidate(); toast.success('已解锁为草稿，可继续调整明细') },
  })
  const removeItemMut = useMutation({
    mutationFn: ({ id, recordId }: { id:number; recordId:number }) => removeStatementItemApi(id, recordId),
    onSuccess: () => { invalidate(); toast.success('已移出对账单') },
  })

  const columns: TableColumn<ReconciliationStatement>[] = [
    { key: 'statementNo', title: '对账单号', width: 150, render: v => <span className="text-doc-code">{String(v)}</span> },
    { key: 'partyName', title: partyLabel, width: 160 },
    { key: 'periodStart', title: '对账期间', width: 180, render: (_, row) => {
      const r = row as ReconciliationStatement
      return r.periodStart || r.periodEnd
        ? <span className="text-xs">{r.periodStart ? formatDisplayDate(r.periodStart) : '…'} ~ {r.periodEnd ? formatDisplayDate(r.periodEnd) : '…'}</span>
        : <span className="text-muted-foreground">—</span>
    }},
    { key: 'itemCount', title: '笔数', width: 70, render: v => `${v ?? 0} 笔` },
    { key: 'totalAmount', title: '汇总金额', width: 120, render: v => <span className="tabular-nums font-medium">{money(v as number)}</span> },
    { key: 'settledAmount', title: '已核销', width: 110, render: v => <span className="tabular-nums text-success">{money(v as number)}</span> },
    { key: 'balance', title: '未核销', width: 110, render: v => (
      <span className={`tabular-nums ${Number(v) > 0 ? 'font-semibold text-destructive' : 'text-muted-foreground'}`}>{money(v as number)}</span>
    )},
    { key: 'status', title: '状态', width: 90, render: (v, row) => (
      <SoftStatusLabel label={(row as ReconciliationStatement).statusName} tone={ST_TONE[v as number] ?? 'draft'} />
    )},
    { key: 'id', title: '操作', width: 130, render: (_, row) => {
      const r = row as ReconciliationStatement
      // 与「按单登记」tab 一致：主按钮 + 下拉次操作，随状态变化
      const items: TableActionItem[] = [{ label: '明细', onClick: () => setDetailId(r.id) }]
      if (r.status === 2 && r.settledAmount === 0) {
        items.push({ label: '解锁', onClick: () => unlockMut.mutate(r.id), disabled: unlockMut.isPending })
      }
      // 草稿：主操作=确认；已确认/已核销：主操作=导出对账单发对方
      return r.status === 1 ? (
        <TableActionsMenu primaryLabel="确认" onPrimaryClick={() => confirmMut.mutate(r.id)} primaryDisabled={confirmMut.isPending} items={items} />
      ) : (
        <TableActionsMenu
          primaryLabel="导出对账单"
          primaryVariant="outline"
          onPrimaryClick={() => downloadExport(`/export/statements/${r.id}`, {}).catch(e => toast.error((e as Error).message))}
          items={items}
        />
      )
    }},
  ]

  return (
    <div className="space-y-4">
      {hideToolbar ? (
        <PaymentQueryBar query={query} onChange={setQuery} labels={queryLabels} />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <PaymentQueryBar query={query} onChange={setQuery} labels={queryLabels} />
          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={() => setQueryOpen(true)}>查询</Button>
            <Button variant="outline" onClick={handleExport}>导出汇总</Button>
            <Button onClick={() => setCreateOpen(true)}>新建对账单</Button>
          </div>
        </div>
      )}

      <DataTable columns={columns} data={data?.list || []} loading={isLoading} rowKey="id" />

      <PaymentQueryDialog
        open={queryOpen}
        initial={query}
        onClose={() => setQueryOpen(false)}
        onApply={setQuery}
        labels={queryLabels}
        partyType={type}
        statusOptions={[['1','草稿'],['2','已确认'],['3','已核销']] as const}
      />

      <CreateStatementDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        type={type}
        onCreated={() => { invalidate(); setCreateOpen(false) }}
      />

      {/* 对账单明细 */}
      <Dialog open={detailId != null} onOpenChange={v => !v && setDetailId(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>对账单 — <span className="text-doc-code-strong">{detail?.statementNo}</span></DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>{detail.partyName}</span>
              <SoftStatusLabel label={detail.statusName} tone={ST_TONE[detail.status] ?? 'draft'} />
              <span>· 汇总 <span className="font-medium text-foreground">{money(detail.totalAmount)}</span></span>
              <span>· 已核销 <span className="text-success">{money(detail.settledAmount)}</span></span>
              {detail.balance > 0 && <span>· 未核销 <span className="font-medium text-destructive">{money(detail.balance)}</span></span>}
              {detail.confirmedByName && <span>· 确认人 {detail.confirmedByName}</span>}
            </div>
          )}
          <div className="max-h-96 overflow-y-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 text-left">关联单号</th>
                  <th className="px-2 py-1.5 text-right">金额</th>
                  <th className="px-2 py-1.5 text-right">已{isPayable ? '付' : '收'}</th>
                  <th className="px-2 py-1.5 text-right">余额</th>
                  <th className="px-2 py-1.5 text-left">到期日</th>
                  {detail?.status === 1 && <th className="px-2 py-1.5"></th>}
                </tr>
              </thead>
              <tbody>
                {detail?.items?.map(it => (
                  <tr key={it.recordId} className="border-t">
                    <td className="px-2 py-1.5 text-doc-code">{it.orderNo}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{money(it.totalAmount)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-success">{money(it.paidAmount)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {it.balance > 0 ? <span className="text-destructive">{money(it.balance)}</span> : <span className="text-success">已结清</span>}
                    </td>
                    <td className="px-2 py-1.5 text-xs text-muted-foreground">{it.dueDate ? formatDisplayDate(it.dueDate) : '—'}</td>
                    {detail.status === 1 && (
                      <td className="px-2 py-1.5 text-right">
                        <Button size="sm" variant="ghost"
                          onClick={() => removeItemMut.mutate({ id: detail.id, recordId: it.recordId })}>
                          移出
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <DialogFooter>
            {detail && detail.status !== 1 && (
              <Button variant="outline"
                onClick={() => downloadExport(`/export/statements/${detail.id}`, {}).catch(e => toast.error((e as Error).message))}>
                导出对账单（发对方核对）
              </Button>
            )}
            <Button variant="outline" onClick={() => setDetailId(null)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
})

/** 新建对账单：选往来方 + 期间 → 勾选待对账账款 */
function CreateStatementDialog({ open, onClose, type, onCreated }: {
  open: boolean; onClose: () => void; type: 1 | 2; onCreated: () => void
}) {
  const partyLabel = type === 1 ? '供应商' : '客户'
  const recent30d = getRelativeDateRange(30)
  const [partyName, setPartyName] = useState('')
  const [startDate, setStartDate] = useState(recent30d.startDate)
  const [endDate, setEndDate] = useState(recent30d.endDate)
  const [applied, setApplied] = useState<{ partyName:string; startDate:string; endDate:string } | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [remark, setRemark] = useState('')

  useEffect(() => {
    if (!open) return
    setPartyName(''); setStartDate(recent30d.startDate); setEndDate(recent30d.endDate)
    setApplied(null); setPicked(new Set()); setRemark('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const { data: candidates, isFetching } = useQuery({
    queryKey: ['statement-candidates', applied],
    queryFn: () => getStatementCandidatesApi({ type, partyName: applied!.partyName, startDate: applied!.startDate, endDate: applied!.endDate }),
    enabled: open && !!applied,
  })

  // 必须 useMemo：`candidates ?? []` 每次渲染都是新数组引用，会让下面依赖 list 的
  // useMemo 每次都重算（等于没缓存）
  const list = useMemo(() => (candidates ?? []) as StatementItem[], [candidates])
  const pickedTotal = useMemo(
    () => list.filter(x => picked.has(x.recordId)).reduce((s, x) => s + x.totalAmount, 0),
    [list, picked],
  )

  const mut = useMutation({
    mutationFn: () => createStatementApi({
      type, partyName: applied!.partyName, periodStart: applied!.startDate, periodEnd: applied!.endDate,
      recordIds: [...picked], remark: remark || undefined,
    }),
    onSuccess: (res) => { toast.success(`对账单 ${res.statementNo} 已生成`); onCreated() },
  })

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>新建对账单</DialogTitle></DialogHeader>

        <div className="grid grid-cols-4 items-end gap-3">
          <div className="space-y-1 col-span-2">
            <Label>{partyLabel} *</Label>
            <Input value={partyName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPartyName(e.target.value)} placeholder={`输入${partyLabel}名称`} />
          </div>
          <div className="space-y-1"><Label>期间起</Label><DatePicker value={startDate} onChange={setStartDate} max={endDate} /></div>
          <div className="space-y-1"><Label>期间止</Label><DatePicker value={endDate} onChange={setEndDate} min={startDate} /></div>
        </div>
        <Button
          size="sm"
          className="w-32"
          disabled={!partyName.trim()}
          onClick={() => { setPicked(new Set()); setApplied({ partyName: partyName.trim(), startDate, endDate }) }}
        >
          查待对账账款
        </Button>

        <div className="rounded-lg border border-border">
          <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2 text-sm">
            <span className="font-medium">待对账账款{applied ? `（${list.length} 笔）` : ''}</span>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-muted-foreground">已选 {picked.size} 笔 · 合计 <span className="tabular-nums font-medium text-foreground">{money(pickedTotal)}</span></span>
              <Button size="sm" variant="outline" disabled={!list.length}
                onClick={() => setPicked(picked.size === list.length ? new Set() : new Set(list.map(x => x.recordId)))}>
                {picked.size === list.length && list.length > 0 ? '取消全选' : '全选'}
              </Button>
            </div>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {!applied && <p className="px-3 py-6 text-center text-sm text-muted-foreground">填写{partyLabel}与期间后点「查待对账账款」</p>}
            {applied && isFetching && <p className="px-3 py-6 text-center text-sm text-muted-foreground">加载中…</p>}
            {applied && !isFetching && !list.length && (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">该期间内没有未对账的月结账款</p>
            )}
            {list.map(it => (
              <label key={it.recordId} className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 last:border-b-0 hover:bg-muted/30">
                <input
                  type="checkbox" className="accent-primary"
                  checked={picked.has(it.recordId)}
                  onChange={e => setPicked(prev => {
                    const next = new Set(prev)
                    if (e.target.checked) next.add(it.recordId); else next.delete(it.recordId)
                    return next
                  })}
                />
                <span className="text-doc-code flex-1">{it.orderNo}</span>
                <span className="text-xs text-muted-foreground">
                  {it.dueDate ? `到期 ${formatDisplayDate(it.dueDate)}` : ''}
                </span>
                <span className="tabular-nums text-sm font-medium">{money(it.totalAmount)}</span>
                {it.paidAmount > 0 && <span className="text-xs text-success">已{type === 1 ? '付' : '收'} {money(it.paidAmount)}</span>}
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <Label>备注</Label>
          <Input value={remark} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRemark(e.target.value)} placeholder="选填" />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button disabled={!picked.size || mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? '生成中…' : `生成对账单（${picked.size} 笔 / ${money(pickedTotal)}）`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
