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
const statusNames = { open: '待处理', processing: '处理中', resolved: '已解决' }
const supplyNames: Record<string, string> = {
  '已结束': '无需继续发货', '供应未覆盖': '还有商品没安排货源', '依赖采购': '需等采购到货或上架',
  '现货可安排': '现货可供本单', '有货待占库': '有现货，需先预留', '候选供应待确认': '采购安排还需确认',
}
const sourceNames: Record<string, string> = {
  '已收待上架（含该采购其他需求）': '采购已有收货，等待上架（不一定全部用于本单）',
  '采购待审批': '采购还在审批', '待到货': '等待到货',
  '候选供货，待占库确认': '可考虑这笔采购，尚未分配给本单',
}
const issueNames: Record<string, string> = {
  '销售供应未覆盖': '还有商品没安排货源', '承诺发货日期有风险': '可能无法按约定日期发货',
  '关联采购已延期': '等待的采购已经延期', '改单等待仓库确认': '修改订单后，等待仓库确认',
  '取消等待实物归还': '取消订单后，等待仓库退回商品', '授信申请待审批': '超额放行申请还在审批',
}
function estimatedDateText(item: DeliveryItem, date: string | null) {
  if (item.remaining <= 0) return '无需继续发货'
  if (date) return date
  if (item.processingDays == null) return '请填写仓库备货天数'
  if (item.shortage > 0) return '请先安排缺少的货源'
  return '请确认采购安排和到货日期'
}
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
  if (query.isPending) return <p role="status" className="p-4 text-sm text-muted-foreground">正在读取订单进度和待处理问题…</p>
  if (query.isError) return <div role="alert" className="p-4 text-sm"><p>{query.error.message}</p><Button variant="outline" onClick={() => query.refetch()}>重新加载订单进度</Button></div>
  const data = query.data
  const head = data.commitments.find(c => c.itemId === 0)
  const pendingItems = data.delivery?.items.filter(item => item.remaining > 0) || []
  const noRemaining = !!data.delivery?.items.length && pendingItems.length === 0
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
    ...productIdentityColumns().map(column => ({ ...column, width: column.key === 'productName' ? 160 : column.key === 'color' ? 80 : 120 })),
    { key: 'unit', title: '单位', width: 55 }, { key: 'warehouseName', title: '仓库', width: 95 },
    { key: 'remaining', title: '还需发货', width: 90 }, { key: 'physical', title: '现货可供本单', width: 120 },
    { key: 'boundQty', title: '已安排采购', width: 100 }, { key: 'shortage', title: '还缺货源', width: 95 },
    { key: 'details', title: '详情', width: 160, render: (_, item) => <details>
      <summary className="cursor-pointer text-primary">{item.delayed ? <span className="text-destructive">可能延期 · 查看</span> : '查看'}</summary>
      <div className="mt-2 space-y-2 text-sm">
        <p>{supplyNames[item.state] || item.state}</p>
        <p>约定发货：{item.promisedDate || '未填写'}</p>
        {item.remaining > 0 && <>{item.firstDate && <p>最早可发：{item.firstDate}</p>}<p>{item.allDate ? `预计发完：${item.allDate}` : estimatedDateText(item, null)}</p></>}
        {data.canManage && <Button variant="ghost" size="sm" onClick={() => openDate(item.id)}>修改日期</Button>}
        {item.sources.length > 0 && <ul className="space-y-2">{item.sources.map((source, index) => <li key={index}>
          {source.orderId ? <a className="text-primary underline" href={`#/purchase/${source.orderId}?focus=fulfillment`}>{source.orderNo}</a> : source.orderNo}：{source.quantity} {item.unit}<br />
          {sourceNames[source.stage] || source.stage} · {source.date || '到货日期未确认'}
        </li>)}</ul>}
      </div>
    </details> },
  ]
  return <div className="space-y-3" id="order-fulfillment">
    {(type === 'sale' || type === 'purchase') && <SectionCard title={type === 'sale' ? '备货情况' : '采购到货时间与相关销售订单'} compact actions={data.canManage && <Button size="sm" variant="outline" onClick={() => openDate()}>{type === 'sale' ? '修改安排' : '修改到货日期'}</Button>}>
      <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <span>{type === 'sale' ? '约定发货' : '预计到货日期'}：<strong>{type === 'sale' ? head?.promisedDate || '未填写' : data.expectedDate || '待确认'}</strong></span>
        {type !== 'sale' && head?.originalDate && <span>首次记录日期：{head.originalDate}</span>}
        {data.delivery && pendingItems.length > 0 && <span>预计发完：{data.delivery.allDate || '待确认'}</span>}
      </div>
      {type === 'purchase' && <p className="mt-2 text-sm text-muted-foreground">查看等待这批货的销售订单。</p>}
      {noRemaining && <p className="mt-3 text-sm text-muted-foreground">无需继续发货</p>}
      {dateEditor && <form className="mt-4 space-y-3 border-t pt-3" onSubmit={e => { e.preventDefault(); mutation.mutate({ action: 'dates', itemId, date: date || null, processingDays: days === '' ? null : Number(days), reason }) }}>
        <p className="text-sm font-medium">{itemId ? `修改商品 ${data.delivery?.items.find(item => item.id === itemId)?.productCode || itemId} 的发货安排` : type === 'sale' ? '修改整单发货安排' : '修改采购到货日期'}</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-sm"><span className="block">{type === 'sale' ? '约定发货日期' : '预计到货日期'}</span><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
          {type === 'sale' && <label className="space-y-1 text-sm"><span className="block">仓库备货天数</span><Input type="number" min={0} max={365} step={1} placeholder="如：1" value={days} onChange={e => setDays(e.target.value)} /></label>}
          <label className="min-w-64 flex-1 space-y-1 text-sm"><span className="block">变更原因</span><Input required maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label>
        </div>
        {type === 'sale' && <p className="text-sm leading-6 text-muted-foreground">备货天数从货物可用当天起算，0 表示当天发出；留空不估算。约定日期指发出日。</p>}
        {itemId > 0 && <p className="text-sm text-muted-foreground">日期留空沿用整单约定。</p>}
        <div className="flex gap-2"><Button type="submit" disabled={mutation.isPending}>保存</Button><Button variant="ghost" type="button" onClick={() => setDateEditor(false)}>取消</Button></div>
      </form>}
      {data.delivery && <div className="mt-4">
        {noRemaining ? <details><summary className="cursor-pointer text-sm font-medium text-primary">查看商品明细（{data.delivery.items.length} 项）</summary><div className="mt-3"><DataTable columns={columns} data={data.delivery.items} rowKey="id" /></div></details>
          : data.delivery.items.length ? <DataTable columns={columns} data={data.delivery.items} rowKey="id" />
            : <p className="text-sm text-muted-foreground">暂无商品明细</p>}
      </div>}
      {type === 'purchase' && <div className="mt-4"><p className="mb-2 text-sm font-medium">正在等待这批采购的销售订单</p>
        {data.impacts.length ? <DataTable columns={[
          { key: 'orderNo', title: '销售单号', render: (_, r) => <a className="text-primary underline" href={`#/sale/${r.saleId}?focus=fulfillment`}>{r.orderNo}</a> },
          { key: 'productCode', title: '商品编码' }, { key: 'productName', title: '商品名称' }, { key: 'quantity', title: '等待到货数量' }, { key: 'unit', title: '单位' },
          { key: 'promisedDate', title: '约定发货日期', render: v => v ? String(v) : '未设置' },
        ]} data={data.impacts.map((r, i) => ({ ...r, id: i }))} rowKey="id" /> : <p className="text-sm text-muted-foreground">当前没有你可查看的销售订单关联这批采购。</p>}
      </div>}
    </SectionCard>}
    {type === 'sale' && !data.issues.length && !data.detectedCount ? <p className="px-1 py-2 text-sm text-muted-foreground">暂无待处理问题</p> : <SectionCard title="待处理问题" compact actions={<div className="flex gap-2">{(showResolved || data.issues.some(issue => issue.status === 'resolved')) && <Button size="sm" variant="ghost" onClick={() => setShowResolved(v => !v)}>{showResolved ? '只看未解决' : '显示已解决'}</Button>}{data.canManage && <>{(type !== 'sale' || data.detectedCount > 0 || data.issues.some(issue => issue.status !== 'resolved')) && <Button size="sm" variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate({ action: 'sync' })}>更新问题</Button>}{type !== 'sale' && <Button size="sm" variant="outline" onClick={() => { setNewIssue(true); setTitle(''); setResult(''); setDue(''); setOwner('') }}>添加问题</Button>}</>}</div>}>
      {!issues.length && <p className="text-sm text-muted-foreground">{data.detectedCount > 0 ? '发现订单问题，等待更新。' : showResolved ? '暂无问题记录' : '暂无待处理问题'}</p>}
      <div className="divide-y">{issues.map(issue => <div key={issue.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
        <div className="min-w-64 flex-1"><div className="flex flex-wrap items-center gap-2"><strong>{issue.source === 'auto' ? issueNames[issue.title] || issue.title : issue.title}</strong><SoftStatusLabel label={issue.overdue ? '已超时' : issue.dueSoon ? '即将到期' : statusNames[issue.status]} tone={issue.overdue ? 'danger' : issue.status === 'resolved' ? 'success' : 'warning'} /></div>
          <p className="mt-1 whitespace-pre-wrap">{issue.reason}</p><p className="mt-1 text-xs text-muted-foreground">负责人：{issue.ownerName || '待认领'} · 期限：{issue.due_at ? formatDisplayDateTime(issue.due_at) : '未设置'} · {issue.source === 'auto' ? '系统检测' : '人工登记'}</p>
          {issue.result && <p className="mt-1">处理结果：{issue.result}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2"><a className="text-primary underline" href={`#${issue.action_path}`}>前往处理</a>{data.canManage && <>{!issue.owner_id && issue.status !== 'resolved' && <Button size="sm" variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate({ action: 'issue', issueId: issue.id, version: issue.version, operation: 'claim' })}>认领</Button>}<Button size="sm" variant="outline" onClick={() => openIssue(issue)}>{issue.status === 'resolved' ? '重新跟进' : '处理'}</Button></>}</div>
      </div>)}</div>
      {(newIssue || editing) && <form className="mt-3 space-y-3 border-t pt-3" onSubmit={e => { e.preventDefault();
        if (newIssue) mutation.mutate({ action: 'create', title, reason: result, ownerId: owner ? Number(owner) : undefined, dueDate: due || null })
        else if (editing) mutation.mutate({ action: 'issue', issueId: editing.id, version: editing.version, operation, ownerId: owner ? Number(owner) : null, result, dueDate: due || null })
      }}>
        <p className="text-sm font-medium">{newIssue ? '添加问题' : editing?.source === 'auto' ? issueNames[editing.title] || editing.title : editing?.title}</p>
        {newIssue ? <label className="block text-sm">问题名称<Input required maxLength={100} value={title} onChange={e => setTitle(e.target.value)} /></label> : <label className="block text-sm">如何处理 <select aria-label="如何处理" className={control} value={operation} onChange={e => setOperation(e.target.value as typeof operation)}>
          {editing?.status === 'resolved' ? <option value="reopen">重新跟进</option> : <><option value="progress">记录进展 / 修改期限</option><option value="assign">更换负责人</option><option value="resolve" disabled={editing?.conditionActive}>标记为已解决{editing?.conditionActive ? '（问题仍存在，暂不能结束）' : ''}</option></>}
        </select></label>}
        <div className="flex flex-wrap gap-3">{(newIssue || operation === 'assign') && <label className="text-sm">负责人 <select aria-label="负责人" className={control} value={owner} onChange={e => setOwner(e.target.value)}><option value="">{newIssue ? '默认交给订单负责人' : '待认领'}</option>{data.owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>}
          <label className="text-sm">处理截止日期<Input type="date" value={due} onChange={e => setDue(e.target.value)} /></label></div>
        <label className="block text-sm">{newIssue ? '遇到了什么问题' : '处理进展 / 结果'}<textarea required maxLength={500} className="mt-1 block min-h-20 w-full rounded-md border border-input bg-background p-2" value={result} onChange={e => setResult(e.target.value)} /></label>
        <div className="flex gap-2"><Button type="submit" disabled={mutation.isPending}>保存</Button><Button type="button" variant="ghost" onClick={() => { setNewIssue(false); setEditing(null) }}>取消</Button></div>
      </form>}
    </SectionCard>}
  </div>
}
