import { useState } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { FilterCard } from '@/components/shared/FilterCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { activeTone } from '@/lib/statusTone'
import { useWarehouses, useDeleteWarehouse } from '@/hooks/useWarehouses'
import WarehouseFormDialog from './components/WarehouseFormDialog'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import TableActionsMenu from '@/components/shared/TableActionsMenu'
import type { Warehouse } from '@/types/warehouses'
import type { TableColumn } from '@/types'


export default function WarehousesPage() {
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editItem, setEditItem] = useState<Warehouse | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<Warehouse | null>(null)

  const { data, isLoading } = useWarehouses({ pageSize: 99999, keyword })
  const { mutate: deleteWarehouse } = useDeleteWarehouse()

  function handleSearch() { setKeyword(search) }

  function handleEdit(item: Warehouse) { setEditItem(item); setFormOpen(true) }

  function handleDelete(item: Warehouse) {
    setConfirmTarget(item)
  }

  const columns: TableColumn<Warehouse>[] = [
    { key: 'code', title: '仓库编码', width: 120 },
    { key: 'name', title: '仓库名称', width: 180 },
    {
      key: 'typeName', title: '类型', width: 90,
      render: (_, row) => (
        <SoftStatusLabel label={row.typeName} tone="info" />
      ),
    },
    { key: 'manager', title: '负责人', width: 100, render: (v) => (v as string) || '-' },
    { key: 'phone', title: '联系电话', width: 130, render: (v) => (v as string) || '-' },
    { key: 'address', title: '地址', render: (v) => (v as string) || '-' },
    {
      key: 'isActive', title: '状态', width: 80,
      render: (_, row) => (
        <SoftStatusLabel label={row.isActive ? '启用' : '停用'} tone={activeTone(row.isActive)} />
      ),
    },
    {
      key: 'id', title: '操作', width: 120,
      render: (_, row) => (
        <TableActionsMenu
          primaryLabel="编辑"
          primaryVariant="outline"
          onPrimaryClick={() => handleEdit(row)}
          items={[
            { label: '删除', destructive: true, onClick: () => handleDelete(row) },
          ]}
        />
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="仓库管理"
        description="管理仓库档案信息"
        actions={
          <Button onClick={() => { setEditItem(null); setFormOpen(true) }}>新增仓库</Button>
        }
      />

      <FilterCard>
        <Input placeholder="搜索编码或名称" value={search}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
          onKeyDown={(e: React.KeyboardEvent) => e.key === 'Enter' && handleSearch()}
          className="h-9 w-60" />
        <Button size="sm" variant="outline" onClick={handleSearch}>搜索</Button>
        {keyword && (
          <Button size="sm" variant="ghost" onClick={() => { setSearch(''); setKeyword('') }}>重置</Button>
        )}
      </FilterCard>

      <DataTable columns={columns} data={data?.list ?? []} loading={isLoading} rowKey="id" />

      <WarehouseFormDialog open={formOpen}
        onClose={() => { setFormOpen(false); setEditItem(null) }}
        editItem={editItem} />
      <ConfirmDialog
        open={!!confirmTarget}
        title="确认删除"
        description={`确定删除仓库「${confirmTarget?.name}」吗？仅未被库位、库存、任务或业务单据引用的仓库允许删除；若已被引用，请改为编辑后停用。`}
        variant="destructive"
        confirmText="删除"
        onConfirm={() => { deleteWarehouse(confirmTarget!.id); setConfirmTarget(null) }}
        onCancel={() => setConfirmTarget(null)}
      />
    </div>
  )
}
