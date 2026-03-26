/**
 * 货架管理
 * 路由：/racks
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from '@/lib/toast'
import PageHeader from '@/components/shared/PageHeader'
import { FilterCard } from '@/components/shared/FilterCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { getRacksApi, printRackLabelApi, deleteRackApi } from '@/api/racks'
import { getWarehousesActiveApi } from '@/api/warehouses'
import DataTable from '@/components/shared/DataTable'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import type { TableColumn } from '@/types'
import type { Rack } from '@/types/racks'
import RackFormDialog from '@/pages/locations/components/RackFormDialog'
import { Printer } from 'lucide-react'

export default function RacksPage() {
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const [warehouseFilter, setWarehouseFilter] = useState<string>('')
  const [formOpen, setFormOpen] = useState(false)
  const [editItem, setEditItem] = useState<Rack | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Rack | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['racks', keyword, warehouseFilter, page],
    queryFn: () =>
      getRacksApi({
        page,
        pageSize: 20,
        keyword,
        warehouseId: warehouseFilter ? +warehouseFilter : undefined,
      }),
  })

  const { data: whData } = useQuery({
    queryKey: ['warehouses-simple'],
    queryFn: () => getWarehousesActiveApi().then(r => r ?? []),
  })

  const printMut = useMutation({
    mutationFn: (id: number) => printRackLabelApi(id),
    onSuccess: (d) => {
      if (d.queued) toast.success(d.printerCode ? `已入队 → ${d.printerCode}` : '已加入打印队列')
      else toast.warning('未绑定「库存标签」打印机或标签机离线，未创建任务')
    },
    onError: (e: unknown) =>
      toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '打印失败'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteRackApi(id),
    onSuccess: () => {
      toast.success('已删除')
      setDeleteTarget(null)
      qc.invalidateQueries({ queryKey: ['racks'] })
    },
    onError: (e: unknown) =>
      toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '删除失败'),
  })

  function handleSearch() {
    setPage(1)
    setKeyword(search)
  }

  const columns: TableColumn<Rack>[] = [
    {
      key: 'barcode',
      title: '货架条码',
      width: 120,
      render: (v) =>
        v ? <span className="font-mono font-semibold">{v as string}</span> : <span className="text-muted-foreground">—</span>,
    },
    { key: 'code', title: '编码', width: 100 },
    { key: 'zone', title: '库区', width: 72, render: v => (v as string) || '—' },
    { key: 'name', title: '名称', render: v => (v as string) || '—' },
    { key: 'warehouseName', title: '仓库' },
    {
      key: 'status',
      title: '状态',
      width: 80,
      render: (_, row) => (
        <Badge variant={row.status === 1 ? 'default' : 'secondary'}>{row.status === 1 ? '启用' : '停用'}</Badge>
      ),
    },
    {
      key: 'actions',
      title: '操作',
      width: 260,
      render: (_, row) => (
        <div className="flex max-w-[min(100%,320px)] flex-nowrap items-center justify-start gap-1 overflow-x-auto py-0.5">
          <Button size="sm" variant="outline" className="h-8 shrink-0 px-2 text-xs" onClick={() => { setEditItem(row); setFormOpen(true) }}>
            编辑
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="h-8 shrink-0 gap-0.5 px-2 text-xs"
            disabled={!row.barcode || printMut.isPending}
            onClick={() => printMut.mutate(row.id)}
          >
            <Printer className="h-3 w-3 shrink-0" />
            打印
          </Button>
          <Button
            size="sm"
            variant="destructive"
            className="h-8 shrink-0 px-2 text-xs"
            disabled={deleteMut.isPending}
            onClick={() => setDeleteTarget(row)}
          >
            删除
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="货架管理"
        description="货架唯一条码（RCK）与标签打印"
        actions={<Button onClick={() => { setEditItem(null); setFormOpen(true) }}>+ 新建货架</Button>}
      />

      <FilterCard>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[180px]">
            <Input
              placeholder="编码 / 名称 / 库区"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
            />
          </div>
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={warehouseFilter || '__all__'}
            onChange={e => { setWarehouseFilter(e.target.value === '__all__' ? '' : e.target.value); setPage(1) }}
          >
            <option value="__all__">全部仓库</option>
            {whData?.map(w => (
              <option key={w.id} value={String(w.id)}>{w.name}</option>
            ))}
          </select>
          <Button size="sm" variant="outline" onClick={handleSearch}>搜索</Button>
        </div>
      </FilterCard>

      <DataTable
        columns={columns}
        data={data?.list ?? []}
        loading={isLoading}
        pagination={data?.pagination}
        onPageChange={setPage}
        rowKey="id"
      />

      <RackFormDialog
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditItem(null); qc.invalidateQueries({ queryKey: ['racks'] }) }}
        editItem={editItem}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title="删除货架"
        description={
          deleteTarget
            ? `确定删除货架「${deleteTarget.code}」吗？若库位或库存仍指向该货架编码，将禁止删除。`
            : ''
        }
        variant="destructive"
        confirmText="删除"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
        loading={deleteMut.isPending}
      />
    </div>
  )
}
