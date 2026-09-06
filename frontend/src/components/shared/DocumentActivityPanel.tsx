import { OrderFulfillmentPanel } from './OrderFulfillmentPanel'
import type { FulfillmentType } from '@/api/fulfillment'
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { getDocumentActivityApi, type DocumentType, type ActivityView } from '@/api/document-activity'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { Button } from '@/components/ui/button'
import { SectionCard } from './SectionCard'

export function DocumentActivityPanel({ type, id, view, extra }: { type: DocumentType; id: number; view: ActivityView; extra?: ReactNode }) {
  const active = useActiveWorkspaceTab()
  const query = useQuery({ queryKey: ['document-activity', type, id], queryFn: ({ signal }) => getDocumentActivityApi(type, id, signal), enabled: id > 0 && active, staleTime: 0, refetchInterval: active ? 20_000 : false })
  if (query.isPending) return <p role="status" className="py-10 text-center text-sm text-muted-foreground">加载进度与记录…</p>
  if (query.isError) return <div role="alert" className="space-y-3 py-8 text-center"><p className="text-sm text-destructive">{query.error.message || '记录加载失败'}</p><Button variant="outline" onClick={() => query.refetch()}>重新加载</Button></div>
  const data = query.data
  const sections = data.sections.filter(s => s.group === view)
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="text-muted-foreground">当前状态：<span className="font-medium text-foreground">{data.status || '—'}</span></p>
      <Button size="sm" variant="outline" onClick={() => query.refetch()} disabled={query.isFetching}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />刷新</Button>
    </div>
    {view === 'progress' && ['purchase', 'inbound', 'transfer'].includes(type) && <OrderFulfillmentPanel type={type as FulfillmentType} id={id} />}
    {extra}
    {view === 'log' ? <SectionCard title="操作记录" compact>
      {data.events.length ? <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead><tr className="border-b text-left text-muted-foreground"><th className="px-3 py-2 font-medium">事项 / 说明</th><th className="w-44 px-3 py-2 font-medium">时间</th><th className="w-32 px-3 py-2 font-medium">操作人</th></tr></thead><tbody className="divide-y">{data.events.map(event => <tr key={event.id}><td className="px-3 py-3"><p className="font-medium">{event.title}</p>{event.description && <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">{event.description}</p>}<p className="mt-1 text-xs text-muted-foreground">{event.source}</p></td><td className="px-3 py-3 align-top text-muted-foreground">{formatDisplayDateTime(event.createdAt)}</td><td className="px-3 py-3 align-top text-muted-foreground">{event.createdByName || '未记录'}</td></tr>)}</tbody></table></div> : <p className="py-8 text-center text-sm text-muted-foreground">暂无操作记录</p>}
      <p className="mt-3 text-xs text-muted-foreground">{data.historyNote}</p>
    </SectionCard> : sections.length ? sections.map((s, index) => <SectionCard key={`${s.title}-${index}`} title={s.title} compact>
      {s.description && <p className="mb-3 text-xs text-muted-foreground">{s.description}</p>}
      {s.rows.length ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-muted-foreground">{s.columns.map(c => <th key={c.key} className="whitespace-nowrap px-3 py-2 font-medium">{c.label}</th>)}</tr></thead><tbody className="divide-y">{s.rows.map((row, index) => <tr key={`${row.id ?? 'row'}-${index}`}>{s.columns.map(c => <td key={c.key} className="min-w-24 px-3 py-3 align-top tabular-nums">{row[c.key] == null ? '—' : c.format === 'date' ? formatDisplayDateTime(String(row[c.key])) : String(row[c.key])}</td>)}</tr>)}</tbody></table></div> : <p className="py-8 text-center text-sm text-muted-foreground">暂无{s.title.includes('打印') ? '打印任务' : '作业明细'}</p>}
    </SectionCard>) : !extra && <p className="py-10 text-center text-sm text-muted-foreground">{view === 'print' ? '尚未生成打印任务' : view === 'containers' ? '尚未生成容器条码' : '尚无已记录的作业进度'}</p>}
  </div>
}
