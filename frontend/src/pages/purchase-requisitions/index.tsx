import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { FilterCard } from '@/components/shared/FilterCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { WarehouseSelect } from '@/components/shared/WarehouseSelect'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { listRequisitionsApi } from '@/api/purchase-requisitions'
import type { PurchaseRequisition } from '@/types/purchase-requisition'
import type { TableColumn } from '@/types'

const STATUS_OPTIONS = [
  { value: '1', label: '草稿' }, { value: '2', label: '待审批' }, { value: '3', label: '已批准' },
  { value: '4', label: '已驳回' }, { value: '5', label: '已取消' }, { value: '6', label: '已转采购' },
]

export default function RequisitionsPage() {
  const navigate = useNavigate()
  const addTab = useWorkspaceStore(s => s.addTab)
  const { can } = usePermission()
  const [search, setSearch] = useState('')
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [warehouseId, setWarehouseId] = useState<number | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['requisitions', keyword, status, warehouseId],
    queryFn: () => listRequisitionsApi({ page: 1, pageSize: 200, keyword: keyword || undefined, status: status || undefined, warehouseId: warehouseId ?? undefined }),
  })
  const list = data?.list ?? []

  function open(path: string, title: string) { addTab({ key: path, title, path }); navigate(path) }
  function reset() { setSearch(''); setKeyword(''); setStatus(null); setWarehouseId(null) }

  const columns: TableColumn<PurchaseRequisition>[] = [
    { key: 'requisitionNo', title: '请购单号', width: 150, render: v => <span className="text-doc-code">{String(v)}</span> },
    { key: 'title', title: '事由', render: v => (v as string) || '—' },
    { key: 'warehouseName', title: '期望入库仓', width: 120 },
    { key: 'applicantName', title: '申请人', width: 100 },
    { key: 'estimatedAmount', title: '预估金额', width: 110, align: 'right', render: v => <span className="tabular-nums">¥{Number(v).toFixed(2)}</span> },
    { key: 'itemCount', title: '明细数', width: 80, align: 'right', render: v => <span className="tabular-nums">{Number(v ?? 0)}</span> },
    { key: 'status', title: '状态', width: 100, render: (_, r) => <SoftStatusLabel label={r.statusName} tone={r.statusTone} /> },
    { key: 'createdAt', title: '创建时间', width: 160, render: v => formatDisplayDateTime(String(v)) },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="采购请购"
        description="发起采购需求 → 一级审批 → 转生成采购单。审批人不能是申请人本人；已批准后按供应商拆分转采购单。"
        actions={can(PERMISSIONS.PURCHASE_REQUISITION_CREATE)
          ? <Button onClick={() => open('/purchase-requisitions/new', '新建请购单')}>新建请购单</Button>
          : undefined}
      />
      <FilterCard>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Input placeholder="单号 / 事由 / 申请人..." value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && setKeyword(search)} className="w-52" />
            <Button variant="outline" onClick={() => setKeyword(search)}>搜索</Button>
          </div>
          <Select value={status ?? '__all__'} onValueChange={v => setStatus(v === '__all__' ? null : v)}>
            <SelectTrigger className="h-10 w-32"><SelectValue placeholder="全部状态" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">全部状态</SelectItem>
              {STATUS_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <WarehouseSelect value={warehouseId} onChange={id => setWarehouseId(id)} allowClear placeholder="全部仓库" className="w-44" />
          {(keyword || status || warehouseId != null) && (
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={reset}>重置</Button>
          )}
        </div>
      </FilterCard>
      <DataTable
        columns={columns}
        data={list}
        loading={isLoading}
        rowKey="id"
        emptyText="暂无请购单"
        onRowDoubleClick={r => open(`/purchase-requisitions/${r.id}`, `请购单 ${r.requisitionNo}`)}
      />
    </div>
  )
}
