import { useState } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { FilterCard } from '@/components/shared/FilterCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import type { StatusTone } from '@/lib/statusTone'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useDisposalList } from '@/hooks/useDisposal'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { formatDisplayDateTime } from '@/lib/dateTime'
import type { DisposalOrder } from '@/types/disposal'
import type { TableColumn } from '@/types'
import DisposalDetailDialog from './components/DisposalDetailDialog'
import CreateDisposalDialog from './components/CreateDisposalDialog'

const STATUS_TONE: Record<number, StatusTone> = {
  1: 'draft',   // 草稿
  2: 'active',  // 待审批
  3: 'warning', // 已批准（待处置）
  4: 'success', // 已处置
  5: 'danger',  // 已驳回
  6: 'danger',  // 已取消
}

export default function DisposalPage() {
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [detailId, setDetailId] = useState<number | null>(null)
  const { can } = usePermission()

  const { data, isLoading } = useDisposalList({ pageSize: 99999, keyword, status: statusFilter || undefined })

  const columns: TableColumn<DisposalOrder>[] = [
    { key: 'disposalNo', title: '处置单号', width: 180, render: (v) => <span className="text-doc-code">{String(v)}</span> },
    { key: 'warehouseName', title: '仓库', width: 120 },
    {
      key: 'status', title: '状态', width: 100,
      render: (v, row) => <SoftStatusLabel label={(row as DisposalOrder).statusName} tone={STATUS_TONE[v as number] ?? 'draft'} />,
    },
    {
      key: 'totalValue', title: '处置价值', width: 120,
      render: (v) => <span className="text-right tabular-nums">¥{Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</span>,
    },
    { key: 'operatorName', title: '经办人', width: 100 },
    {
      key: 'createdAt', title: '创建时间', width: 160,
      render: (v) => formatDisplayDateTime(v),
    },
    {
      key: 'id', title: '操作', width: 100,
      render: (_, row) => (
        <Button size="sm" variant="outline" onClick={() => setDetailId((row as DisposalOrder).id)}>查看/处理</Button>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="呆滞库存处置"
        description="圈选呆滞商品生成处置单 → 审批 → 降价促销/退货供应商/报废（处置只走 ERP 端，出库自动扣库存）"
        actions={
          can(PERMISSIONS.INVENTORY_DISPOSAL_CREATE) ? (
            <Button onClick={() => setCreateOpen(true)}>+ 新建处置单</Button>
          ) : undefined
        }
      />
      <FilterCard>
        <Input
          placeholder="搜索单号/仓库..." value={search}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
          className="h-9 w-56"
          onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') setKeyword(search) }}
        />
        <Select value={statusFilter || '__none__'} onValueChange={(v) => setStatusFilter(v === '__none__' ? '' : v)}>
          <SelectTrigger className="h-9 w-36"><SelectValue placeholder="全部状态" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">全部状态</SelectItem>
            <SelectItem value="1">草稿</SelectItem>
            <SelectItem value="2">待审批</SelectItem>
            <SelectItem value="3">已批准</SelectItem>
            <SelectItem value="4">已处置</SelectItem>
            <SelectItem value="5">已驳回</SelectItem>
            <SelectItem value="6">已取消</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={() => setKeyword(search)}>搜索</Button>
        {(keyword || statusFilter) && (
          <Button size="sm" variant="ghost" onClick={() => { setSearch(''); setKeyword(''); setStatusFilter('') }}>重置</Button>
        )}
      </FilterCard>

      <DataTable columns={columns} data={data?.list || []} loading={isLoading} />

      <CreateDisposalDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      <DisposalDetailDialog open={!!detailId} onClose={() => setDetailId(null)} id={detailId} />
    </div>
  )
}
