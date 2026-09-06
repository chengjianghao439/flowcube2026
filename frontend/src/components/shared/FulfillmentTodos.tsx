import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getFulfillmentIssues, type FulfillmentIssue } from '@/api/fulfillment'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { SectionCard } from './SectionCard'
import { SoftStatusLabel } from './StatusBadge'
import DataTable from './DataTable'
import { Button } from '@/components/ui/button'
import type { TableColumn } from '@/types'

const names = { sale: '销售订单', purchase: '采购订单', inbound: '收货订单', transfer: '调拨订单' }
const paths = { sale: '/sale', purchase: '/purchase', inbound: '/inbound-tasks', transfer: '/transfer' }
export function FulfillmentTodos({ summary = false }: { summary?: boolean }) {
  const [filter, setFilter] = useState('open')
  const active = useActiveWorkspaceTab()
  const query = useQuery({ queryKey: ['fulfillment-issues', summary ? 'summary' : filter], queryFn: ({ signal }) => getFulfillmentIssues(filter, summary, signal), enabled: active, refetchInterval: active ? 30_000 : false })
  if (query.isError) return <div role="alert" className="p-3 text-sm">履约待办读取失败：{query.error.message}<Button size="sm" variant="ghost" onClick={() => query.refetch()}>重试</Button></div>
  if (summary) return <a href="#/reports/role-workbench" className="mb-3 block rounded-md border border-border px-3 py-2 text-sm text-primary">
    {query.isPending ? '读取履约待办…' : `履约事项：我负责 ${query.data.summary.mine} · 待认领 ${query.data.summary.unassigned} · 超时 ${query.data.summary.overdue}`}
  </a>
  const columns: TableColumn<FulfillmentIssue>[] = [
    { key: 'title', title: '事项', width: 180 },
    { key: 'document_id', title: '关联单据', width: 180, render: (_, r) => <a href={`#${paths[r.document_type]}/${r.document_id}?focus=fulfillment`} className="text-primary underline">{names[r.document_type]} #{r.document_id}</a> },
    { key: 'reason', title: '阻塞原因', width: 340 }, { key: 'ownerName', title: '负责人', width: 110, render: v => v ? String(v) : '待认领' },
    { key: 'due_at', title: '处理期限', width: 170, render: v => v ? formatDisplayDateTime(String(v)) : '未设置' },
    { key: 'status', title: '状态', width: 120, render: (_, r) => <SoftStatusLabel label={r.overdue ? '已超时' : r.dueSoon ? '即将到期' : r.status === 'resolved' ? '已处理' : r.status === 'processing' ? '处理中' : '待处理'} tone={r.overdue ? 'danger' : r.status === 'resolved' ? 'success' : 'warning'} /> },
    { key: 'result', title: '处理结果', width: 260 },
    { key: 'action', title: '操作', width: 100, render: (_, r) => <a href={`#${paths[r.document_type]}/${r.document_id}?focus=fulfillment`} className="text-primary underline">跟进处理</a> },
  ]
  return <SectionCard title="订单履约待办" compact actions={<Button variant="outline" size="sm" onClick={() => query.refetch()} disabled={query.isFetching}>刷新事项</Button>}>
    <div className="mb-3 flex flex-wrap gap-2">{[['open', '全部未处理'], ['mine', '我负责'], ['unassigned', '待认领'], ['overdue', '已超时'], ['resolved', '已处理']].map(([value, label]) => <Button key={value} size="sm" variant={filter === value ? 'default' : 'outline'} onClick={() => setFilter(value)}>{label}</Button>)}</div>
    <DataTable columns={columns} data={query.data?.list || []} rowKey="id" loading={query.isPending} />
    <p className="mt-2 text-xs text-muted-foreground">共 {query.data?.pagination.total || 0} 项。事项按原单查看权限及仓库范围显示；自动阻塞解除后保留处理结果和操作记录。</p>
  </SectionCard>
}
