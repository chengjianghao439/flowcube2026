import { useState, useContext, useId } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { TabPathContext } from '@/components/layout/TabPathContext'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { SummaryStrip } from '@/components/shared/SummaryStrip'
import { FilterCard } from '@/components/shared/FilterCard'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { DatePicker } from '@/components/shared/DatePicker'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { getPartyLedger, type PartyLedgerRow, type PartyLedgerResult } from '@/api/party-ledger'
import { getReceiptDetailApi, getEntriesApi } from '@/api/payments'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import type { TableColumn } from '@/types'

// 四位小数与账款存储精度一致，常规金额仅显示两位。
const money = (v: number) => v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
function exportLedger(data: PartyLedgerResult) {
  const rows: (string | number)[][] = [
    ['往来单位', data.party.name, '编码', data.party.code],
    ['记账启用时间', data.historyStartedAt, '历史说明', '启用前以净余额结转，不代表原始业务发生额'],
    ['期初余额', data.summary.openingBalance, '本期增加', data.summary.increase, '本期减少', data.summary.decrease, '期末余额', data.summary.closingBalance],
    ['记账时间', '业务日期', '业务类型', '关联单号', '增加', '减少', '结余'],
    ...data.list.map(r => [r.occurredAt, r.businessDate || '', r.eventName, r.documentNo, r.increase, r.decrease, r.balanceAfter]),
  ]
  const csv = rows.map(row => row.map(value => {
    let text = String(value)
    if (typeof value === 'string' && /^[\s]*[=+\-@]/.test(text)) text = `'${text}`
    return `"${text.replace(/"/g, '""')}"`
  }).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url; a.download = `${data.party.code}-往来明细.csv`; a.click()
  URL.revokeObjectURL(url)
}
function SourceDetails({ row, onClose }: { row: PartyLedgerRow; onClose: () => void }) {
  const query = useQuery({
    queryKey: ['party-ledger-source', row.receiptId, row.recordId],
    queryFn: async () => row.receiptId
      ? { receipt: await getReceiptDetailApi(row.receiptId), entries: null }
      : { receipt: null, entries: await getEntriesApi(row.recordId!) },
  })
  return <Dialog open onOpenChange={v => !v && onClose()}><DialogContent className="max-w-4xl">
    <DialogHeader><DialogTitle>收付款明细 · {row.documentNo}</DialogTitle></DialogHeader>
    {query.isError ? <QueryErrorState error={query.error} onRetry={() => void query.refetch()} compact /> : query.isPending ? <p>正在加载明细…</p> : <div className="max-h-[65vh] space-y-4 overflow-auto">
      {query.data.receipt && <>
        <p>{query.data.receipt.partyName} · 汇款 {money(query.data.receipt.amount)} · 已核销 {money(query.data.receipt.settledAmount)} · 未核销 {money(query.data.receipt.balance)}</p>
        <DataTable columns={[
          { key: 'orderNo', title: '核销单号', width: 180 },
          { key: 'amount', title: '核销金额', width: 120, align: 'right', render: v => money(Number(v)) },
        ]} data={query.data.receipt.settlements} rowKey="entryId" emptyText="尚未核销，款项保留为预收或预付。" />
      </>}
      {query.data.entries && <DataTable columns={[
        { key: 'paymentDate', title: '收付款日期', width: 120 },
        { key: 'amount', title: '登记金额', width: 120, align: 'right', render: v => money(Number(v)) },
        { key: 'remark', title: '备注', width: 240 },
      ]} data={query.data.entries} emptyText="该账款尚无收付款记录。" />}
    </div>}
  </DialogContent></Dialog>
}
export default function PartyLedgerPage() {
  const tabPath = useContext(TabPathContext)
  const dateControlId = useId()
  // 工作区按 pathname 区分单位；查询字符串不参与 ID 解析。
  const [, , , side, id] = tabPath.split('?')[0].split('/')
  const type = side === 'customer' ? 2 : 1
  const partyId = Number(id)
  const [draft, setDraft] = useState({ startDate: '', endDate: '' })
  const [range, setRange] = useState(draft)
  const [source, setSource] = useState<PartyLedgerRow | null>(null)
  const navigate = useNavigate()
  const addTab = useWorkspaceStore(s => s.addTab)
  const active = useWorkspaceStore(s => s.activeKey === tabPath.split('?')[0])
  const { can } = usePermission()
  const query = useQuery({
    queryKey: ['party-ledger', type, partyId, range],
    queryFn: ({ signal }) => getPartyLedger({ type, partyId, ...range }, signal),
    staleTime: 0,
    enabled: active,
  })
  const data = query.data
  const columns: TableColumn<PartyLedgerRow>[] = [
    { key: 'occurredAt', title: '记账时间', width: 175 },
    { key: 'businessDate', title: '业务日期', width: 120, render: v => String(v || '—') },
    { key: 'eventName', title: '业务类型', width: 165 },
    { key: 'documentNo', title: '关联单号', width: 180 },
    { key: 'increase', title: type === 2 ? '增加应收' : '增加应付', width: 120, align: 'right', render: v => Number(v) ? money(Number(v)) : '—' },
    { key: 'decrease', title: type === 2 ? '减少应收' : '减少应付', width: 120, align: 'right', render: v => Number(v) ? money(Number(v)) : '—' },
    { key: 'balanceAfter', title: '结余', width: 130, align: 'right', render: v => <span className="font-medium tabular-nums">{money(Number(v))}</span> },
    { key: 'id', title: '操作', width: 180, render: (_, row) => <div className="flex gap-2">
      {row.orderId && can(type === 2 ? PERMISSIONS.SALE_ORDER_VIEW : PERMISSIONS.PURCHASE_ORDER_VIEW) && <Button size="sm" variant="outline" onClick={() => {
        const path = `/${type === 2 ? 'sale' : 'purchase'}/${row.orderId}`
        addTab({ key: path, path, title: row.documentNo }); navigate(path)
      }}>原单</Button>}
      {(row.receiptId || row.recordId) && <Button size="sm" variant="ghost" onClick={() => setSource(row)}>收付款</Button>}
    </div> },
  ]
  return <div className="space-y-4">
    <PageHeader title={`${type === 2 ? '客户' : '供应商'}往来明细${data ? ` · ${data.party.name}` : ''}`} description="覆盖全部结算方式，按记账时间查看往来余额的每次变化。核销不重复计入收付款。" actions={<>
      <Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>刷新</Button>
      <Button variant="outline" disabled={!data || query.isFetching || query.isError} onClick={() => data && exportLedger(data)}>导出 CSV</Button>
    </>} />
    <FilterCard>
      <Label htmlFor={`${dateControlId}-start`}>记账日期</Label>
      <DatePicker id={`${dateControlId}-start`} value={draft.startDate} onChange={startDate => setDraft(v => ({ ...v, startDate }))} max={draft.endDate || undefined} />
      <Label htmlFor={`${dateControlId}-end`}>至</Label>
      <DatePicker id={`${dateControlId}-end`} value={draft.endDate} onChange={endDate => setDraft(v => ({ ...v, endDate }))} min={draft.startDate || undefined} />
      <Button variant="outline" onClick={() => setRange({ ...draft })}>查询</Button>
      <Button variant="ghost" onClick={() => { setDraft({ startDate: '', endDate: '' }); setRange({ startDate: '', endDate: '' }) }}>全部日期</Button>
    </FilterCard>
    {query.isError ? <QueryErrorState error={query.error} onRetry={() => void query.refetch()} /> : <>
      {data && <>
        <SummaryStrip items={[
          { label: '期初余额', value: money(data.summary.openingBalance) },
          { label: '本期增加', value: money(data.summary.increase) },
          { label: '本期减少', value: money(data.summary.decrease) },
          { label: '期末余额', value: money(data.summary.closingBalance) },
        ]} />
        <div className="space-y-1 text-sm leading-6 text-muted-foreground">
          <p>正数为{type === 2 ? '客户欠款' : '待付供应商款项'}，负数为{type === 2 ? '预收或应退客户款项' : '预付或待供应商退回款项'}。金额单位：元。</p>
          <p>完整记账始于 {data.historyStartedAt}。此前账款以当时净余额结转，业务日期仅供追溯，不能据此还原更早的逐笔余额。</p>
          {data.historyIncomplete && <p className="text-warning" role="status">查询起日早于记账启用时间，期初及发生额仅包含已有记录，不能作为该历史期间的完整对账依据。</p>}
          {data.unassignedCount > 0 && <p className="text-warning">系统另有 {data.unassignedCount} 条{type === 2 ? '应收' : '应付'}记录尚无明确单位归属，未分配到本明细，请在原账款中核查。</p>}
        </div>
      </>}
      <DataTable columns={columns} data={data?.list ?? []} loading={query.isPending} emptyText="所选期间暂无往来记录，可切换全部日期查看。" />
      {data && <p className="text-sm text-muted-foreground">共 {data.list.length} 笔 · 现结与月结合并展示</p>}
    </>}
    {source && active && <SourceDetails row={source} onClose={() => setSource(null)} />}
  </div>
}
