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
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import TableActionsMenu from '@/components/shared/TableActionsMenu'
import { ProductFinder, FinderTrigger } from '@/components/finder'
import { WarehouseSelect } from '@/components/shared/WarehouseSelect'
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

interface PlasticBoxMovement {
  qty: number
  type: number
  moveType: number | null
  moveTypeName: string | null
  remark: string | null
  refNo: string | null
  operatorName: string | null
  productName: string | null
  createdAt: string
}
function getPlasticBoxMovementsApi(id: number) {
  return payloadClient.get<PlasticBoxMovement[]>(`/plastic-boxes/${id}/movements`)
}

export default function PlasticBoxesPage() {
  const qc = useQueryClient()
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<PlasticBox | null>(null)
  const [detailTarget, setDetailTarget] = useState<PlasticBox | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['plastic-boxes', keyword],
    queryFn: () => getPlasticBoxesApi({ pageSize: 99999, keyword }),
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
    { key: 'warehouseName', title: '仓库', width: 140 },
    { key: 'remainingQty', title: '当前数量', width: 80, render: v => <span className="font-semibold">{String(v)}</span> },
    {
      key: 'status', title: '状态', width: 80,
      render: v => Number(v) === 1
        ? <SoftStatusLabel label="在库" tone="active" />
        : <SoftStatusLabel label="空置" tone="draft" />,
    },
    { key: 'createdAt', title: '创建时间', width: 150, render: v => formatDisplayDateTime(v) },
    {
      key: 'id', title: '操作', width: 80,
      render: (_, row) => (
        <TableActionsMenu
          primaryLabel="详情"
          primaryVariant="outline"
          onPrimaryClick={() => setDetailTarget(row)}
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
          onKeyDown={e => { if (e.key === 'Enter') { setKeyword(search) } }}
        />
        <Button size="sm" variant="outline" onClick={() => { setKeyword(search) }}>搜索</Button>
        {keyword && <Button size="sm" variant="ghost" onClick={() => { setSearch(''); setKeyword('') }}>重置</Button>}
      </FilterCard>

      <DataTable columns={columns} data={data?.list ?? []} loading={isLoading} />

      <CreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={(data) => createMut.mutate(data)}
        loading={createMut.isPending}
      />

      <DetailDialog box={detailTarget} onClose={() => setDetailTarget(null)} />

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

function DetailDialog({ box, onClose }: { box: PlasticBox | null; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['plastic-box-movements', box?.id],
    queryFn: () => getPlasticBoxMovementsApi(box!.id),
    enabled: !!box,
  })
  const TYPE_NAMES: Record<number, string> = { 1: '入库', 2: '出库', 3: '调整' }
  const TYPE_TONE: Record<number, 'success' | 'danger' | 'info'> = { 1: 'success', 2: 'danger', 3: 'info' }

  return (
    <Dialog open={!!box} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>塑料盒流水 · {box?.barcode}</DialogTitle>
        </DialogHeader>
        <div className="text-sm text-muted-foreground">
          {box?.productName ? `绑定产品：${box.productName} (${box.productCode})` : '未绑定产品'}
          {box?.warehouseName ? ` · ${box.warehouseName}` : ''}
          {` · 当前数量 ${box?.remainingQty ?? 0}`}
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {isLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">加载中...</div>
          ) : !data?.length ? (
            <div className="py-8 text-center text-sm text-muted-foreground">暂无流水</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">时间</th>
                  <th className="py-2 pr-3 font-medium">类型</th>
                  <th className="py-2 pr-3 font-medium text-right">数量</th>
                  <th className="py-2 pr-3 font-medium">备注</th>
                  <th className="py-2 font-medium">操作人</th>
                </tr>
              </thead>
              <tbody>
                {data.map((m, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-2 pr-3 whitespace-nowrap">{formatDisplayDateTime(m.createdAt)}</td>
                    <td className="py-2 pr-3">
                      <SoftStatusLabel label={m.moveTypeName ?? TYPE_NAMES[m.type] ?? `类型${m.type}`} tone={TYPE_TONE[m.type] ?? 'info'} />
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{m.qty}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{m.remark ?? '—'}</td>
                    <td className="py-2">{m.operatorName ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function CreateDialog({ open, onClose, onSubmit, loading }: { open: boolean; onClose: () => void; onSubmit: (data: Record<string, unknown>) => void; loading: boolean }) {
  const [product, setProduct] = useState<FinderResult | null>(null)
  const [warehouse, setWarehouse] = useState<FinderResult | null>(null)
  const [productFinderOpen, setProductFinderOpen] = useState(false)

  const handleSubmit = () => {
    if (!product) { toast.warning('请选择产品'); return }
    if (!warehouse) { toast.warning('请选择仓库'); return }
    onSubmit({
      productId: product.id,
      productName: product.name,
      productCode: product.code,
      warehouseId: warehouse.id,
      warehouseName: warehouse.name,
      unit: (product as unknown as Record<string, unknown>).unit || '',
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
            <WarehouseSelect
              value={warehouse?.id ?? null}
              onChange={(id, name) => setWarehouse(id ? { id, name } : null)}
              placeholder="选择仓库"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>取消</Button>
          <Button onClick={handleSubmit} disabled={loading}>{loading ? '创建中...' : '创建'}</Button>
        </DialogFooter>
        <ProductFinder open={productFinderOpen} onClose={() => setProductFinderOpen(false)} onConfirm={(p) => { setProduct(p); setProductFinderOpen(false) }} />
      </DialogContent>
    </Dialog>
  )
}
