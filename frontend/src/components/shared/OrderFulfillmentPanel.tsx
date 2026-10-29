/** 采购到货安排及收货、调拨事项跟进。 */
import { explainFulfillmentAction, fulfillmentDocumentPath } from '@/lib/fulfillmentAction'
import { usePermission } from '@/hooks/usePermission'
import { useRef, useState } from 'react'
import { DatePicker } from './DatePicker'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getFulfillment, runFulfillmentCommand, type FulfillmentType, type FulfillmentCommand, type FulfillmentIssue } from '@/api/fulfillment'
import { createRequestKey } from '@/lib/requestKey'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { toast } from '@/lib/toast'
import { SectionCard } from './SectionCard'
import { SoftStatusLabel } from './StatusBadge'
import DataTable from './DataTable'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const control = 'h-9 rounded-md border border-input bg-background px-3 text-sm'
const statusNames = { open: '待处理', processing: '处理中', resolved: '已处理' }
export function OrderFulfillmentPanel({ type, id }: {
  type: Exclude<FulfillmentType, 'sale'>; id: number
}) {
  const active = useActiveWorkspaceTab()
  const { can } = usePermission()
  const panel = useRef<HTMLDivElement>(null)
  const [locationNote, setLocationNote] = useState('')
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: ['fulfillment', type, id],
    queryFn: ({ signal }) => getFulfillment(type, id, signal),
    enabled: active, staleTime: 0, refetchOnMount: 'always', refetchInterval: active ? 30_000 : false,
  })
  const request = useRef({ signature: '', key: '' })
  const [editing, setEditing] = useState<FulfillmentIssue | null>(null)
  const [operation, setOperation] = useState<'assign' | 'progress' | 'resolve' | 'reopen'>('progress')
  const [owner, setOwner] = useState('')
  const [due, setDue] = useState('')
  const [result, setResult] = useState('')
  const [newIssue, setNewIssue] = useState(false)
  const [title, setTitle] = useState('')
  const [dateEditor, setDateEditor] = useState(false)
  const [date, setDate] = useState('')
  const [reason, setReason] = useState('')
  const [showResolved, setShowResolved] = useState(false)
  const mutation = useMutation({
    mutationFn: async (command: FulfillmentCommand) => {
      const signature = JSON.stringify({ type, id, command })
      if (signature !== request.current.signature) request.current = { signature, key: createRequestKey('fulfillment') }
      const response = await runFulfillmentCommand(type, id, command, request.current.key)
      return response
    },
    onSuccess: () => {
      request.current = { signature: '', key: '' }
      setEditing(null); setNewIssue(false); setDateEditor(false)
      for (const key of ['fulfillment', 'fulfillment-issues', 'document-activity', 'role-workbench', 'sale', 'purchase']) void qc.invalidateQueries({ queryKey: [key] })
      toast.success('已保存')
    },
    onError: (error: Error) => toast.error(error.message),
  })
  if (query.isPending) return <p role="status" className="p-4 text-sm text-muted-foreground">正在加载订单进度和待处理问题…</p>
  if (query.isError) return <div role="alert" className="p-4 text-sm"><p>{query.error.message}</p><p className="mt-1 text-muted-foreground">已填写的进展和日期保留；重新读取后继续。</p><Button variant="outline" onClick={() => query.refetch()}>重新加载订单进度</Button></div>
  const data = query.data
  const head = data.commitments.find(c => c.itemId === 0)
  const issues = data.issues.filter(i => showResolved || i.status !== 'resolved')
  function openDate() {
    setDate(data.expectedDate || ''); setReason(''); setDateEditor(true)
  }
  function openIssue(issue: FulfillmentIssue) {
    setEditing(issue); setResult(''); setDue(issue.due_at ? formatDisplayDateTime(issue.due_at).slice(0, 10) : '')
    setOwner(issue.owner_id == null ? '' : String(issue.owner_id)); setOperation(issue.status === 'resolved' ? 'reopen' : 'progress')
  }
  async function locateIssue(issue: FulfillmentIssue) {
    const latest = await query.refetch()
    if (latest.isError || !latest.data) return
    const current = latest.data.issues.find(row => row.id === issue.id)
    if (!current || current.status === 'resolved') { setLocationNote('已重新读取，原事项已不再待处理。请查看最新安排。'); return }
    panel.current?.scrollIntoView?.({ block: 'start' })
    setLocationNote('已重新读取当前事项，请核对最新结果。')
  }
  return <div ref={panel} className="space-y-3" id="order-fulfillment">
    {locationNote && <p role="status" className="text-sm text-muted-foreground">{locationNote}</p>}
    {type === 'purchase' && <SectionCard title="采购到货时间与相关销售订单" compact actions={data.canManage && <Button size="sm" variant="outline" onClick={openDate}>修改到货日期</Button>}>
      <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <span>预计到货日期：<strong>{data.expectedDate || '待确认'}</strong></span>
        {head?.originalDate && <span>首次记录日期：{head.originalDate}</span>}
      </div>
      {dateEditor && <form className="mt-4 space-y-3 border-t pt-3" onSubmit={e => { e.preventDefault(); mutation.mutate({ action: 'dates', itemId: 0, date: date || null, processingDays: null, reason }) }}>
        <p className="text-sm font-medium">修改采购到货日期</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-sm"><span className="block">预计到货日期</span><DatePicker value={date} onChange={setDate} /></label>
          <label className="min-w-64 flex-1 space-y-1 text-sm"><span className="block">变更原因</span><Input required maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label>
        </div>
        <div className="flex gap-2"><Button type="submit" disabled={mutation.isPending}>保存</Button><Button variant="ghost" type="button" onClick={() => setDateEditor(false)}>取消</Button></div>
      </form>}
      {type === 'purchase' && <div className="mt-4"><p className="mb-2 text-sm font-medium">正在等待这批采购的销售订单</p>
        {data.impacts.length ? <DataTable columns={[
          { key: 'orderNo', title: '销售单号', render: (_, r) => <a className="text-primary underline" href={`#/sale/${r.saleId}`}>{r.orderNo}</a> },
          { key: 'productCode', title: '商品编码' }, { key: 'productName', title: '商品名称' }, { key: 'quantity', title: '等待到货数量' }, { key: 'unit', title: '单位' },
        ]} data={data.impacts.map((r, i) => ({ ...r, id: i }))} rowKey="id" /> : <p className="text-sm text-muted-foreground">当前没有你可查看的销售订单关联这批采购。</p>}
      </div>}
    </SectionCard>}
    <SectionCard title="卡点与待办" compact actions={<div className="flex gap-2">{(showResolved || data.issues.some(issue => issue.status === 'resolved')) && <Button size="sm" variant="ghost" onClick={() => setShowResolved(v => !v)}>{showResolved ? '只看未处理' : '显示已处理'}</Button>}{data.canManage && <><Button size="sm" variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate({ action: 'sync' })}>重新检测</Button><Button size="sm" variant="outline" onClick={() => { setNewIssue(true); setTitle(''); setResult(''); setDue(''); setOwner('') }}>添加卡点</Button></>}</div>}>
      {!issues.length && <p className="text-sm text-muted-foreground">{data.detectedCount > 0 ? `检测到 ${data.detectedCount} 条卡点，点「重新检测」写入。` : showResolved ? '暂无记录' : '当前没有卡点'}</p>}
      <div className="divide-y">{issues.map(issue => <div key={issue.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
        <div className="min-w-64 flex-1"><div className="flex flex-wrap items-center gap-2"><strong>{issue.title}</strong><SoftStatusLabel label={statusNames[issue.status]} tone={issue.status === 'resolved' ? 'success' : issue.status === 'processing' ? 'active' : 'warning'} />{(issue.overdue || issue.dueSoon) && <span className={issue.overdue ? 'text-xs font-medium text-destructive-ink' : 'text-xs font-medium text-warning-ink'}>{issue.overdue ? '已超时' : '即将到期'}</span>}</div>
          <p className="mt-1 whitespace-pre-wrap">{issue.reason}</p><p className="mt-1 text-xs text-muted-foreground">负责人：{issue.ownerName || '待认领'} · 期限：{issue.due_at ? formatDisplayDateTime(issue.due_at) : '未设置'} · {issue.source === 'auto' ? '系统检测' : '人工登记'}</p>
          {issue.result && <p className="mt-1">处理结果：{issue.result}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">{(() => {
          if (issue.document_type !== type || issue.document_id !== id) return null
          const action = explainFulfillmentAction(issue, can)
          return <div>{action.path === fulfillmentDocumentPath(issue)
            ? <Button size="sm" variant="outline" disabled={query.isFetching || query.isPaused} onClick={() => void locateIssue(issue)}>{action.label}</Button>
            : action.path && (query.isFetching || query.isPaused
              ? <span role="status" className="text-muted-foreground">{action.label}：{query.isPaused ? '网络已暂停，等待恢复后重新读取事项。' : '正在重新读取事项，稍后再交接。'}</span>
              : <a className="text-primary underline" href={`#${action.path}`}>{action.label}</a>)}
            {action.note && <p className="mt-1 text-xs text-muted-foreground">{action.note}</p>}</div>
        })()}{data.canManage && <>{!issue.owner_id && issue.status !== 'resolved' && <Button size="sm" variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate({ action: 'issue', issueId: issue.id, version: issue.version, operation: 'claim' })}>认领</Button>}<Button size="sm" variant="outline" onClick={() => openIssue(issue)}>{issue.status === 'resolved' ? '重新跟进' : '处理'}</Button></>}</div>
      </div>)}</div>
      {(newIssue || editing) && <form className="mt-3 space-y-3 border-t pt-3" onSubmit={e => { e.preventDefault();
        if (newIssue) mutation.mutate({ action: 'create', title, reason: result, ownerId: owner ? Number(owner) : undefined, dueDate: due || null })
        else if (editing) mutation.mutate({ action: 'issue', issueId: editing.id, version: editing.version, operation, ownerId: owner ? Number(owner) : null, result, dueDate: due || null })
      }}>
        <p className="text-sm font-medium">{newIssue ? '添加问题' : editing?.title}</p>
        {newIssue ? <label className="block text-sm">问题名称<Input required maxLength={100} value={title} onChange={e => setTitle(e.target.value)} /></label> : <label className="block text-sm">如何处理 <select aria-label="如何处理" className={control} value={operation} onChange={e => setOperation(e.target.value as typeof operation)}>
          {editing?.status === 'resolved' ? <option value="reopen">重新跟进</option> : <><option value="progress">记录进展 / 修改期限</option><option value="assign">更换负责人</option><option value="resolve" disabled={editing?.conditionActive}>标记为已处理{editing?.conditionActive ? '（问题仍存在，暂不能结束）' : ''}</option></>}
        </select></label>}
        <div className="flex flex-wrap gap-3">{(newIssue || operation === 'assign') && <label className="text-sm">负责人 <select aria-label="负责人" className={control} value={owner} onChange={e => setOwner(e.target.value)}><option value="">{newIssue ? '默认交给订单负责人' : '待认领'}</option>{data.owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>}
          <label className="text-sm">处理截止日期<DatePicker value={due} onChange={setDue} /></label></div>
        <label className="block text-sm">{newIssue ? '遇到了什么问题' : '处理进展 / 结果'}<textarea required maxLength={500} className="mt-1 block min-h-20 w-full rounded-md border border-input bg-background p-2" value={result} onChange={e => setResult(e.target.value)} /></label>
        <div className="flex gap-2"><Button type="submit" disabled={mutation.isPending}>保存</Button><Button type="button" variant="ghost" onClick={() => { setNewIssue(false); setEditing(null) }}>取消</Button></div>
      </form>}
    </SectionCard>
  </div>
}
