/**
 * 入库任务管理页
 * 路由：/inbound-tasks
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from '@/lib/toast'
import PageHeader from '@/components/shared/PageHeader'
import { FilterCard } from '@/components/shared/FilterCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { getInboundTasksApi, getInboundTaskByIdApi, receiveInboundApi, putawayInboundApi, cancelInboundApi } from '@/api/inbound-tasks'
import { INBOUND_STATUS_LABEL, INBOUND_STATUS_VARIANT, type InboundTask, type InboundTaskStatus } from '@/types/inbound-tasks'
import DataTable from '@/components/shared/DataTable'
import type { TableColumn } from '@/types'

export default function InboundTasksPage() {
  const qc = useQueryClient()
  const [keyword, setKeyword]         = useState('')
  const [search, setSearch]           = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [page, setPage]               = useState(1)
  const [detailTask, setDetailTask]   = useState<InboundTask | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['inbound-tasks', keyword, statusFilter, page],
    queryFn: () => getInboundTasksApi({ keyword, status: statusFilter ? +statusFilter : undefined, page, pageSize: 20 })
      .then(r => r.data.data),
  })

  const { data: detail } = useQuery({
    queryKey: ['inbound-task-detail', detailTask?.id],
    queryFn: () => getInboundTaskByIdApi(detailTask!.id).then(r => r.data.data),
    enabled: !!detailTask,
  })

  function invalidate() { qc.invalidateQueries({ queryKey: ['inbound-tasks'] }) }

  const cancelMut = useMutation({
    mutationFn: (id: number) => cancelInboundApi(id),
    onSuccess: () => { toast.success('已取消'); invalidate(); setDetailTask(null) },
    onError: () => toast.error('取消失败'),
  })

  const columns: TableColumn<InboundTask>[] = [
    { key: 'taskNo',           title: '任务单号', width: 160,
      render: v => <span className="font-mono text-xs">{v as string}</span> },
    { key: 'purchaseOrderNo',  title: '采购单号', width: 160,
      render: v => v ? <span className="font-mono text-xs">{v as string}</span> : <span className="text-muted-foreground">—</span> },
    { key: 'supplierName',     title: '供应商',
      render: v => v ?? <span className="text-muted-foreground">—</span> },
    { key: 'warehouseName',    title: '仓库',
      render: v => v ?? <span className="text-muted-foreground">—</span> },
    { key: 'status',           title: '状态', width: 90,
      render: v => <Badge variant={INBOUND_STATUS_VARIANT[v as InboundTaskStatus]}>{INBOUND_STATUS_LABEL[v as InboundTaskStatus]}</Badge> },
    { key: 'operatorName',     title: '操作人',
      render: v => v ?? <span className="text-muted-foreground">—</span> },
    { key: 'createdAt',        title: '创建时间', width: 160,
      render: v => (v as string)?.slice(0, 16) },
    { key: 'id', title: '操作', width: 80,
      render: (_, row) => (
        <Button size="sm" variant="ghost" onClick={() => setDetailTask(row)}>详情</Button>
      ) },
  ]

  return (
    <div className="space-y-5">
      <PageHeader title="入库任务" description="管理采购入库任务的收货与上架" />

      <FilterCard>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[180px]">
            <Input placeholder="任务单号 / 采购单号 / 供应商" value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { setKeyword(search); setPage(1) } }}
            />
          </div>
          <Select value={statusFilter || '__all__'} onValueChange={v => { setStatusFilter(v === '__all__' ? '' : v); setPage(1) }}>
            <SelectTrigger className="w-32"><SelectValue placeholder="全部状态" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">全部</SelectItem>
              {([1,2,3,4,5] as InboundTaskStatus[]).map(s => (
                <SelectItem key={s} value={String(s)}>{INBOUND_STATUS_LABEL[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => { setKeyword(search); setPage(1) }}>搜索</Button>
          <Button variant="outline" onClick={() => { setSearch(''); setKeyword(''); setStatusFilter(''); setPage(1) }}>重置</Button>
        </div>
      </FilterCard>

      <DataTable
        columns={columns}
        data={data?.list ?? []}
        loading={isLoading}
        rowKey="id"
      />

      {data && (
        <div className="flex items-center justify-between px-1 text-sm text-muted-foreground">
          <span>共 {data.total} 条</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</Button>
            <Button size="sm" variant="outline" disabled={page * 20 >= data.total} onClick={() => setPage(p => p + 1)}>下一页</Button>
          </div>
        </div>
      )}

      <Dialog open={!!detailTask} onOpenChange={v => !v && setDetailTask(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>入库任务详情 — {detail?.taskNo ?? detailTask?.taskNo}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-muted-foreground">供应商：</span>{detail?.supplierName ?? '—'}</div>
              <div><span className="text-muted-foreground">仓库：</span>{detail?.warehouseName ?? '—'}</div>
              <div><span className="text-muted-foreground">状态：</span>
                {detail && <Badge variant={INBOUND_STATUS_VARIANT[detail.status]}>{INBOUND_STATUS_LABEL[detail.status]}</Badge>}
              </div>
              <div><span className="text-muted-foreground">操作人：</span>{detail?.operatorName ?? '—'}</div>
            </div>
            {detail?.items && detail.items.length > 0 && (
              <table className="w-full text-sm border rounded">
                <thead>
                  <tr className="bg-muted/40">
                    <th className="px-3 py-2 text-left">商品</th>
                    <th className="px-3 py-2 text-right">订单数</th>
                    <th className="px-3 py-2 text-right">已收货</th>
                    <th className="px-3 py-2 text-right">已上架</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {detail.items.map(item => (
                    <tr key={item.id}>
                      <td className="px-3 py-2">{item.productName}</td>
                      <td className="px-3 py-2 text-right">{item.orderedQty}</td>
                      <td className="px-3 py-2 text-right">{item.receivedQty}</td>
                      <td className="px-3 py-2 text-right">{item.putawayQty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <DialogFooter>
            {detail && [1,2,3].includes(detail.status) && (
              <Button variant="destructive" onClick={() => cancelMut.mutate(detail.id)} disabled={cancelMut.isPending}>取消任务</Button>
            )}
            <Button variant="outline" onClick={() => setDetailTask(null)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
