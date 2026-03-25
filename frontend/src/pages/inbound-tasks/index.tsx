/**
 * 入库任务管理页
 * 路由：/inbound-tasks
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import PageHeader from '@/components/shared/PageHeader'
import { FilterCard } from '@/components/shared/FilterCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getInboundTasksApi } from '@/api/inbound-tasks'
import { INBOUND_STATUS_LABEL, INBOUND_STATUS_VARIANT, type InboundTask, type InboundTaskStatus } from '@/types/inbound-tasks'
import DataTable from '@/components/shared/DataTable'
import type { TableColumn } from '@/types'
import { useWorkspaceStore } from '@/store/workspaceStore'

export default function InboundTasksPage() {
  const navigate = useNavigate()
  const addTab = useWorkspaceStore(s => s.addTab)
  const [keyword, setKeyword]         = useState('')
  const [search, setSearch]           = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [page, setPage]               = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['inbound-tasks', keyword, statusFilter, page],
    queryFn: () => getInboundTasksApi({ keyword, status: statusFilter ? +statusFilter : undefined, page, pageSize: 20 })
      .then(r => r.data.data),
  })

  function openDetail(row: InboundTask) {
    const path = `/inbound-tasks/${row.id}`
    addTab({ key: path, title: row.taskNo, path })
    navigate(path)
  }

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
    { key: 'id', title: '操作', width: 100,
      render: (_, row) => (
        <Button size="sm" variant="ghost" onClick={() => openDetail(row as InboundTask)}>详情</Button>
      ) },
  ]

  return (
    <div className="space-y-5">
      <PageHeader title="入库任务" description="采购入库：收货生成容器 → 上架计入库存" />

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
          <span>共 {data.pagination.total} 条</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</Button>
            <Button size="sm" variant="outline" disabled={page * 20 >= data.pagination.total} onClick={() => setPage(p => p + 1)}>下一页</Button>
          </div>
        </div>
      )}
    </div>
  )
}
