import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getFulfillment, runFulfillmentCommand, type FulfillmentType, type FulfillmentCommand, type FulfillmentIssue, type DeliveryItem } from '@/api/fulfillment'
import { createRequestKey } from '@/lib/requestKey'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { toast } from '@/lib/toast'
import { SectionCard } from './SectionCard'
import { SoftStatusLabel } from './StatusBadge'
import DataTable from './DataTable'
import { productIdentityColumns } from './productIdentityColumns'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { TableColumn } from '@/types'

const control = 'h-9 rounded-md border border-input bg-background px-3 text-sm'
const statusNames = { open: '待处理', processing: '处理中', resolved: '已处理' }
const docNames = { sale: '销售', purchase: '采购', inbound: '收货', transfer: '调拨' }
export function OrderFulfillmentPanel({ type, id }: { type: FulfillmentType; id: number }) {
  const active = useActiveWorkspaceTab()
  const qc = useQueryClient()
  const query = useQuery({ queryKey: ['fulfillment', type, id], queryFn: ({ signal }) => getFulfillment(type, id, signal), enabled: active, refetchInterval: active ? 30_000 : false })
  const request = useRef({ signature: '', key: '' })
  const [editing, setEditing] = useState<FulfillmentIssue | null>(null)
  const [operation, setOperation] = useState<'assign' | 'progress' | 'resolve' | 'reopen'>('progress')
  const [owner, setOwner] = useState('')
  const [due, setDue] = useState('')
  const [result, setResult] = useState('')
  const [newIssue, setNewIssue] = useState(false)
  const [title, setTitle] = useState('')
  const [dateEditor, setDateEditor] = useState(false)
  const [itemId, setItemId] = useState(0)
  const [date, setDate] = useState('')
  const [days, setDays] = useState('')
  const [reason, setReason] = useState('')
  const [showResolved, setShowResolved] = useState(false)
  const mutation = useMutation({
    mutationFn: (command: FulfillmentCommand) => {
      const signature = JSON.stringify({ type, id, command })
      if (signature !== request.current.signature) request.current = { signature, key: createRequestKey('fulfillment') }
      return runFulfillmentCommand(type, id, command, request.current.key)
    },
    onSuccess: () => {
      request.current = { signature: '', key: '' }
      setEditing(null); setNewIssue(false); setDateEditor(false)
      for (const key of ['fulfillment', 'fulfillment-issues', 'document-activity', 'role-workbench', 'sale', 'purchase']) void qc.invalidateQueries({ queryKey: [key] })
      toast.success('已保存')
    },
    onError: (error: Error) => toast.error(error.message),
  })
  if (query.isPending) return <p role="status" className="p-4 text-sm text-muted-foreground">正在读取交期与异常事项…</p>
  if (query.isError) return <div role="alert" className="p-4 text-sm"><p>{query.error.message}</p><Button variant="outline" onClick={() => query.refetch()}>重新加载履约信息</Button></div>
  const data = query.data
  const head = data.commitments.find(c => c.itemId === 0)
  const issues = data.issues.filter(i => showResolved || i.status !== 'resolved')
  function openDate(nextId = 0) {
    const current = data.commitments.find(c => c.itemId === nextId)
    setItemId(nextId); setDate(type === 'purchase' ? data.expectedDate || '' : current?.promisedDate || '')
    setDays(current?.processingDays == null ? '' : String(current.processingDays)); setReason(''); setDateEditor(true)
  }
  function openIssue(issue: FulfillmentIssue) {
    setEditing(issue); setResult(''); setDue(issue.due_at ? formatDisplayDateTime(issue.due_at).slice(0, 10) : '')
    setOwner(issue.owner_id == null ? '' : String(issue.owner_id)); setOperation(issue.status === 'resolved' ? 'reopen' : 'progress')
  }
  const columns: TableColumn<DeliveryItem>[] = [
    ...productIdentityColumns(), { key: 'unit', title: '单位', width: 70 }, { key: 'warehouseName', title: '仓库', width: 110 },
    { key: 'remaining', title: '未发数量', width: 100 }, { key: 'physical', title: '本单现货可安排', width: 130 },
    { key: 'boundQty', title: '已绑定采购', width: 110 }, { key: 'shortage', title: '未覆盖缺口', width: 110 },
    { key: 'actualShipDate', title: '最近实际出库日', width: 140 }, { key: 'deliveryOutcome', title: '已发交期结果', width: 150 },
    { key: 'state', title: '供货状态', width: 150 },
    { key: 'promisedDate', title: '承诺发货日', width: 135, render: (_, item) => <span>{item.promisedDate || '未设置'}{data.canManage && <Button variant="ghost" size="sm" onClick={() => openDate(item.id)}>调整</Button>}</span> },
    { key: 'firstDate', title: '预计本批可发', width: 130, render: v => v ? String(v) : '待确认' },
    { key: 'allDate', title: '预计剩余全部可发', width: 160, render: (_, item) => <span className={item.delayed ? 'text-destructive' : ''}>{item.allDate || '待确认'}{item.delayed ? ' · 交期风险' : ''}</span> },
    { key: 'sources', title: '供应来源', width: 260, render: (_, item) => item.sources.length ? <details><summary className="cursor-pointer text-primary">查看 {item.sources.length} 项供应依据</summary><ul className="mt-2 space-y-2">{item.sources.map((s, index) => <li key={index}>
      {s.orderId ? <a className="text-primary underline" href={`#/purchase/${s.orderId}?focus=fulfillment`}>{s.orderNo}</a> : s.orderNo}：{s.quantity} {item.unit}<br />{s.stage} · {s.date || '交期待确认'}
    </li>)}</ul></details> : '无采购依赖' },
  ]
  return <div className="space-y-3" id="order-fulfillment">
    {(type === 'sale' || type === 'purchase') && <SectionCard title={type === 'sale' ? '发货承诺与供货安排' : '采购交期与销售影响'} compact actions={data.canManage && <Button size="sm" variant="outline" onClick={() => openDate()}>更新交期</Button>}>
      <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <span>{type === 'sale' ? '整单承诺发货日' : '当前预计到货日'}：<strong>{type === 'sale' ? head?.promisedDate || '未设置' : data.expectedDate || '待确认'}</strong></span>
        {head?.originalDate && <span>首次记录日期：{head.originalDate}</span>}
        {data.delivery && <><span>预计最早一批可发：{data.delivery.firstDate || '待确认'}</span><span>预计剩余全部可发：{data.delivery.allDate || '待确认'}</span></>}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">以实际出库判断销售交期。仓库处理时效未确认、采购已过期或供应未落实时，预计可发日为待确认；现货安排仍需通过原占库及出库校验。</p>
      {dateEditor && <form className="mt-4 space-y-3 border-t pt-3" onSubmit={e => { e.preventDefault(); mutation.mutate({ action: 'dates', itemId, date: date || null, processingDays: days === '' ? null : Number(days), reason }) }}>
        <p className="text-sm font-medium">{itemId ? `调整商品明细 #${itemId}（留空继承整单）` : `调整${docNames[type]}整单交期`}</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-sm"><span className="block">{type === 'sale' ? '承诺发货日期' : '预计到货日期'}</span><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
          {type === 'sale' && <label className="space-y-1 text-sm"><span className="block">仓库处理天数（空＝待确认）</span><Input type="number" min={0} max={365} step={1} value={days} onChange={e => setDays(e.target.value)} /></label>}
          <label className="min-w-64 flex-1 space-y-1 text-sm"><span className="block">变更原因</span><Input required maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label>
        </div>
        <div className="flex gap-2"><Button type="submit" disabled={mutation.isPending}>保存交期</Button><Button variant="ghost" type="button" onClick={() => setDateEditor(false)}>取消</Button></div>
      </form>}
      {data.delivery && <div className="mt-4"><DataTable columns={columns} data={data.delivery.items} rowKey="id" /></div>}
      {type === 'purchase' && <div className="mt-4"><p className="mb-2 text-sm font-medium">直接依赖本采购的销售需求</p>
        {data.impacts.length ? <DataTable columns={[
          { key: 'orderNo', title: '销售单号', render: (_, r) => <a className="text-primary underline" href={`#/sale/${r.saleId}?focus=fulfillment`}>{r.orderNo}</a> },
          { key: 'productCode', title: '商品编码' }, { key: 'productName', title: '商品名称' }, { key: 'quantity', title: '依赖数量' }, { key: 'unit', title: '单位' },
          { key: 'promisedDate', title: '承诺发货日', render: v => v ? String(v) : '未设置' },
        ]} data={data.impacts.map((r, i) => ({ ...r, id: i }))} rowKey="id" /> : <p className="text-sm text-muted-foreground">暂无当前权限下可见的直接绑定销售需求。</p>}
      </div>}
    </SectionCard>}
    <SectionCard title="当前阻塞与处理事项" compact actions={<div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => setShowResolved(v => !v)}>{showResolved ? '仅看未处理' : '包含已处理'}</Button>{data.canManage && <><Button size="sm" variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate({ action: 'sync' })}>检查当前阻塞</Button><Button size="sm" variant="outline" onClick={() => { setNewIssue(true); setTitle(''); setResult(''); setDue(''); setOwner('') }}>登记异常</Button></>}</div>}>
      {!issues.length && <p className="text-sm text-muted-foreground">暂无已登记事项。{data.detectedCount > 0 ? '已检测到新的待处理条件，可点击“检查当前阻塞”同步。' : '自动事项由系统定期检测。'}</p>}
      <div className="divide-y">{issues.map(issue => <div key={issue.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
        <div className="min-w-64 flex-1"><div className="flex flex-wrap items-center gap-2"><strong>{issue.title}</strong><SoftStatusLabel label={issue.overdue ? '已超时' : issue.dueSoon ? '即将到期' : statusNames[issue.status]} tone={issue.overdue ? 'danger' : issue.status === 'resolved' ? 'success' : 'warning'} /></div>
          <p className="mt-1 whitespace-pre-wrap">{issue.reason}</p><p className="mt-1 text-xs text-muted-foreground">负责人：{issue.ownerName || '待认领'} · 期限：{issue.due_at ? formatDisplayDateTime(issue.due_at) : '未设置'} · {issue.source === 'auto' ? '系统检测' : '人工登记'}</p>
          {issue.result && <p className="mt-1">处理结果：{issue.result}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2"><a className="text-primary underline" href={`#${issue.action_path}`}>处理入口</a>{data.canManage && <>{!issue.owner_id && issue.status !== 'resolved' && <Button size="sm" variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate({ action: 'issue', issueId: issue.id, version: issue.version, operation: 'claim' })}>认领</Button>}<Button size="sm" variant="outline" onClick={() => openIssue(issue)}>{issue.status === 'resolved' ? '重新打开' : '跟进 / 转派'}</Button></>}</div>
      </div>)}</div>
      {(newIssue || editing) && <form className="mt-3 space-y-3 border-t pt-3" onSubmit={e => { e.preventDefault();
        if (newIssue) mutation.mutate({ action: 'create', title, reason: result, ownerId: owner ? Number(owner) : undefined, dueDate: due || null })
        else if (editing) mutation.mutate({ action: 'issue', issueId: editing.id, version: editing.version, operation, ownerId: owner ? Number(owner) : null, result, dueDate: due || null })
      }}>
        <p className="text-sm font-medium">{newIssue ? '登记异常' : editing?.title}</p>
        {newIssue ? <label className="block text-sm">事项标题<Input required maxLength={100} value={title} onChange={e => setTitle(e.target.value)} /></label> : <label className="block text-sm">处理动作 <select aria-label="处理动作" className={control} value={operation} onChange={e => setOperation(e.target.value as typeof operation)}>
          {editing?.status === 'resolved' ? <option value="reopen">重新打开</option> : <><option value="progress">记录进展 / 调整期限</option><option value="assign">转派负责人</option><option value="resolve" disabled={editing?.conditionActive}>处理完成{editing?.conditionActive ? '（阻塞仍存在）' : ''}</option></>}
        </select></label>}
        <div className="flex flex-wrap gap-3">{(newIssue || operation === 'assign') && <label className="text-sm">负责人 <select aria-label="负责人" className={control} value={owner} onChange={e => setOwner(e.target.value)}><option value="">{newIssue ? '按单据来源默认分配' : '待认领'}</option>{data.owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>}
          <label className="text-sm">处理截止日期<Input type="date" value={due} onChange={e => setDue(e.target.value)} /></label></div>
        <label className="block text-sm">{newIssue ? '阻塞原因' : '处理进展 / 结果'}<textarea required maxLength={500} className="mt-1 block min-h-20 w-full rounded-md border border-input bg-background p-2" value={result} onChange={e => setResult(e.target.value)} /></label>
        <div className="flex gap-2"><Button type="submit" disabled={mutation.isPending}>保存</Button><Button type="button" variant="ghost" onClick={() => { setNewIssue(false); setEditing(null) }}>取消</Button></div>
      </form>}
    </SectionCard>
  </div>
}
