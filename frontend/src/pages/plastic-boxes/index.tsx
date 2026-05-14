import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { FilterCard } from '@/components/shared/FilterCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Badge } from '@/components/ui/badge'
import TableActionsMenu from '@/components/shared/TableActionsMenu'
import { ProductFinder, WarehouseFinder, FinderTrigger } from '@/components/finder'
import { toast } from '@/lib/toast'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { payloadClient } from '@/api/client'
import type { TableColumn } from '@/types'
import type { FinderResult } from '@/types/finder'

interface PlasticBox {
  id: number
  barcode: string
  productId: number | null
  productName: string | null
  productCode: string | null
  warehouseId: number | null
  warehouseName: string | null
  locationId: number | null
  locationName: string | null
  remainingQty: number
  status: number
  unit: string
  createdAt: string
  updatedAt: string
}

function getPlasticBoxesApi(params?: Record<string, string | number>) {
  return payloadClient.get<{ list: PlasticBox[]; pagination: { page: number; pageSize: number; total: number } }>('/plastic-boxes', { params })
}
function createPlasticBoxApi(data: Record<string, unknown>) {
  return payloadClient.post<{ id: number; barcode: string }>('/plastic-boxes', data)
}
function deletePlasticBoxApi(id: number) {
  return payloadClient.delete(`/plastic-boxes/${id}`)
}

export default function PlasticBoxesPage() {
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<PlasticBox | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['plastic-boxes', page, keyword],
    queryFn: () => getPlasticBoxesApi({ page, pageSize: 20, keyword }),
  })

  const createMut = useMutation({
    mutationFn: createPlasticBoxApi,
    onSuccess: (res) => { toast.success(`塑料盒 ${res.barcode} 已创建`); qc.invalidateQueries({ queryKey: ['plastic-boxes'] }); setCreateOpen(false) },
    onError: (e) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '创建失败'),
  })

  const deleteMut = useMutation({
    mutationFn: deletePlasticBoxApi,
    onSuccess: () => { toast.success('已删除'); qc.invalidateQueries({ queryKey: ['plastic-boxes'] }); setDeleteTarget(null) },
    onError: (e) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '删除失败'),
  })

  const columns: TableColumn<PlasticBox>[] = [
    { key: 'barcode', title: '条码', width: 140, render: v => <span className="text-doc-code">{String(v)}</span> },
    { key: 'productName', title: '绑定产品', width: 180, render: (_, row) => row.productName ? `${row.productName} (${row.productCode})` : '—' },
    { key: 'warehouseName', title: '仓库', width: 100 },
    { key: 'remainingQty', title: '当前数量', width: 80, render: v => <span className="font-semibold">{String(v)}</span> },
    {
      key: 'status', title: '状态', width: 80,
      render: v => Number(v) === 1 ? <Badge variant="default">在库</Badge> : <Badge variant="secondary">空置</Badge>,
    },
    { key: 'createdAt', title: '创建时间', width: 150, render: v => formatDisplayDateTime(v) },
    {
      key: 'id', title: '操作', width: 80,
      render: (_, row) => (
        <TableActionsMenu
          primaryLabel="详情"
          primaryVariant="outline"
          onPrimaryClick={() => {}}
          items={[
            ...(row.remainingQty === 0 ? [{
              label: '删除',
              destructive: true,
              onClick: () => setDeleteTarget(row),
            }] : []),
          ]}
        />
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="塑料盒管理"
        description="管理永久暂存容器（B 条码），每个塑料盒绑定一个产品，用于零散出货"
        actions={<Button onClick={() => setCreateOpen(true)}>+ 新建塑料盒</Button>}
      />

      <FilterCard>
        <Input
          placeholder="搜索条码 / 产品..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="h-9 w-56"
          onKeyDown={e => { if (e.key === 'Enter') { setKeyword(search); setPage(1) } }}
        />
        <Button size="sm" variant="outline" onClick={() => { setKeyword(search); setPage(1) }}>搜索</Button>
        {keyword && <Button size="sm" variant="ghost" onClick={() => { setSearch(''); setKeyword(''); setPage(1) }}>重置</Button>}
      </FilterCard>

      <DataTable columns={columns} data={data?.list ?? []} loading={isLoading} pagination={data?.pagination} onPageChange={setPage} />

      <CreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={(data) => createMut.mutate(data)}
        loading={createMut.isPending}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title="删除塑料盒"
        description={`确认删除 ${deleteTarget?.barcode}？`}
        variant="destructive"
        confirmText="确认删除"
        onConfirm={() => deleteMut.mutate(deleteTarget!.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

function CreateDialog({ open, onClose, onSubmit, loading }: { open: boolean; onClose: () => void; onSubmit: (data: Record<string, unknown>) => void; loading: boolean }) {
  const [product, setProduct] = useState<FinderResult | null>(null)
  const [warehouse, setWarehouse] = useState<FinderResult | null>(null)
  const [productFinderOpen, setProductFinderOpen] = useState(false)
  const [warehouseFinderOpen, setWarehouseFinderOpen] = useState(false)

  const handleSubmit = () => {
    if (!product) { toast.warning('请选择产品'); return }
    if (!warehouse) { toast.warning('请选择仓库'); return }
    onSubmit({
      productId: product.id,
      productName: product.name,
      productCode: product.code,
      warehouseId: warehouse.id,
      warehouseName: warehouse.name,
      unit: (product as Record<string, unknown>).unit || '',
    })
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>新建塑料盒</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>绑定产品 *</Label>
            <FinderTrigger value={product?.name ?? ''} placeholder="点击选择产品..." onClick={() => setProductFinderOpen(true)} />
          </div>
          <div className="space-y-1.5">
            <Label>所属仓库 *</Label>
            <FinderTrigger value={warehouse?.name ?? ''} placeholder="点击选择仓库..." onClick={() => setWarehouseFinderOpen(true)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>取消</Button>
          <Button onClick={handleSubmit} disabled={loading}>{loading ? '创建中...' : '创建'}</Button>
        </DialogFooter>
        <ProductFinder open={productFinderOpen} onClose={() => setProductFinderOpen(false)} onConfirm={(p) => { setProduct(p); setProductFinderOpen(false) }} />
        <WarehouseFinder open={warehouseFinderOpen} onClose={() => setWarehouseFinderOpen(false)} onConfirm={(w) => { setWarehouse(w); setWarehouseFinderOpen(false) }} />
      </DialogContent>
    </Dialog>
  )
}
