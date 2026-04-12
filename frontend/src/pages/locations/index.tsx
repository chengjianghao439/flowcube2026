/**
 * 库位管理页
 * 路由：/locations
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from '@/lib/toast'
import PageHeader from '@/components/shared/PageHeader'
import { FocusModePanel } from '@/components/shared/FocusModePanel'
import { FilterCard } from '@/components/shared/FilterCard'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { getLocationsApi, createLocationApi, updateLocationApi, deleteLocationApi } from '@/api/locations'
import { getWarehousesActiveApi } from '@/api/warehouses'
import type { Location, CreateLocationParams } from '@/types/locations'
import DataTable from '@/components/shared/DataTable'
import type { TableColumn } from '@/types'

const STATUS_VARIANT: Record<number, 'default' | 'outline' | 'secondary'> = { 1: 'default', 2: 'outline' }
const STATUS_LABEL:   Record<number, string> = { 1: '启用', 2: '停用' }

const EMPTY_FORM: CreateLocationParams = { warehouseId: 0, code: '', zone: '', aisle: '', rack: '', level: '', position: '', capacity: 0, remark: '' }

export default function LocationsPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [keyword, setKeyword]         = useState('')
  const [search, setSearch]           = useState('')
  const [warehouseFilter, setWarehouseFilter] = useState<string>('')
  const [page, setPage]               = useState(1)
  const [dialogOpen, setDialogOpen]   = useState(false)
  const [editTarget, setEditTarget]   = useState<Location | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Location | null>(null)
  const [form, setForm]               = useState<CreateLocationParams>(EMPTY_FORM)

  const { data, isLoading } = useQuery({
    queryKey: ['locations', keyword, warehouseFilter, page],
    queryFn: () => getLocationsApi({ keyword, warehouseId: warehouseFilter ? +warehouseFilter : undefined, page, pageSize: 20 }),
  })

  const { data: whData } = useQuery({
    queryKey: ['warehouses-simple'],
    queryFn: () => getWarehousesActiveApi().then(r => r ?? []),
  })

  function invalidate() { qc.invalidateQueries({ queryKey: ['locations'] }) }

  const createMut = useMutation({
    mutationFn: () => createLocationApi(form),
    onSuccess: () => { toast.success('库位已创建'); invalidate(); closeDialog() },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '创建失败'),
  })

  const updateMut = useMutation({
    mutationFn: () => updateLocationApi(editTarget!.id, form),
    onSuccess: () => { toast.success('已更新'); invalidate(); closeDialog() },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '更新失败'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteLocationApi(id),
    onSuccess: () => { toast.success('已删除'); invalidate() },
    onError: () => toast.error('删除失败'),
  })

  function openCreate() { setEditTarget(null); setForm(EMPTY_FORM); setDialogOpen(true) }
  function openEdit(loc: Location) {
    setEditTarget(loc)
    setForm({ warehouseId: loc.warehouseId, code: loc.code, zone: loc.zone ?? '', aisle: loc.aisle ?? '', rack: loc.rack ?? '', level: loc.level ?? '', position: loc.position ?? '', capacity: loc.capacity, remark: loc.remark ?? '' })
    setDialogOpen(true)
  }
  function closeDialog() { setDialogOpen(false); setEditTarget(null); setForm(EMPTY_FORM) }

  const set = (k: keyof CreateLocationParams, v: string | number) => setForm(f => ({ ...f, [k]: v }))

  const columns: TableColumn<Location>[] = [
    { key: 'code',          title: '库位编号', width: 120,
      render: v => <span className="text-doc-code-strong">{v as string}</span> },
    { key: 'warehouseName', title: '仓库',
      render: v => v ?? <span className="text-muted-foreground">—</span> },
    { key: 'zone',    title: '区域', render: v => v ?? <span className="text-muted-foreground">—</span> },
    { key: 'aisle',   title: '通道', render: v => v ?? <span className="text-muted-foreground">—</span> },
    { key: 'rack',    title: '货架', render: v => v ?? <span className="text-muted-foreground">—</span> },
    { key: 'capacity', title: '容量', width: 80 },
    { key: 'status', title: '状态', width: 80,
      render: v => <Badge variant={STATUS_VARIANT[v as number]}>{STATUS_LABEL[v as number]}</Badge> },
    { key: 'containerCount', title: '容器数', width: 80,
      render: v => v ?? 0 },
    {
      key: 'id', title: '操作', width: 120,
      render: (_, row) => (
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => openEdit(row)}>编辑</Button>
          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleteTarget(row)}>删除</Button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="库位管理"
        description="管理仓库内的存储库位"
        actions={<Button onClick={openCreate}>+ 新建库位</Button>}
      />

      <FocusModePanel
        badge="仓储主数据"
        title="库位页负责维护上架落点，并把后续动作交给收货、仓库任务和库存处理链"
        description="这页最适合先确认仓库、库区、巷道和库位编码是否规范，再回收货订单、仓库任务和库存管理继续执行上架与库存追踪。"
        summary={editTarget ? `当前操作：编辑库位 - ${editTarget.code}` : '当前焦点：库位资料维护'}
        steps={[
          '先维护库位编码、区域结构和容量，保证上架与盘点现场有清晰落点。',
          '再到收货订单和仓库任务确认实际上架、补录和现场任务是否能落到正确库位。',
          '发现库存差异或现场异常时，回库存管理和异常工作台继续排查。',
        ]}
        actions={[
          { label: '打开收货订单', variant: 'default', onClick: () => navigate('/inbound-tasks') },
          { label: '打开仓库任务', onClick: () => navigate('/warehouse-tasks') },
          { label: '打开库存管理', onClick: () => navigate('/inventory') },
        ]}
      />

      <FilterCard>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[180px]">
            <Input placeholder="库位编号 / 区域" value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { setKeyword(search); setPage(1) } }}
            />
          </div>
          <Select value={warehouseFilter || '__all__'} onValueChange={v => { setWarehouseFilter(v === '__all__' ? '' : v); setPage(1) }}>
            <SelectTrigger className="w-36"><SelectValue placeholder="全部仓库" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">全部</SelectItem>
              {(whData ?? []).map((w: { id: number; name: string }) => (
                <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => { setKeyword(search); setPage(1) }}>搜索</Button>
          <Button variant="outline" onClick={() => { setSearch(''); setKeyword(''); setWarehouseFilter(''); setPage(1) }}>重置</Button>
        </div>
      </FilterCard>

      <DataTable
        columns={columns}
        data={data?.list ?? []}
        loading={isLoading}
        rowKey="id"
      />

      <Dialog open={dialogOpen} onOpenChange={v => !v && closeDialog()}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editTarget ? '编辑库位' : '新建库位'}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>仓库</Label>
              <Select value={String(form.warehouseId || '')} onValueChange={v => set('warehouseId', +v)} disabled={!!editTarget}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="选择仓库" /></SelectTrigger>
                <SelectContent>
                  {(whData ?? []).map((w: { id: number; name: string }) => (
                    <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div><Label>库位编号</Label><Input className="mt-1" placeholder="如 A01-01" value={form.code} onChange={e => set('code', e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>区域</Label><Input className="mt-1" placeholder="可选" value={form.zone} onChange={e => set('zone', e.target.value)} /></div>
              <div><Label>通道</Label><Input className="mt-1" placeholder="可选" value={form.aisle} onChange={e => set('aisle', e.target.value)} /></div>
              <div><Label>货架</Label><Input className="mt-1" placeholder="可选" value={form.rack} onChange={e => set('rack', e.target.value)} /></div>
              <div><Label>层</Label><Input className="mt-1" placeholder="可选" value={form.level} onChange={e => set('level', e.target.value)} /></div>
            </div>
            <div><Label>容量</Label><Input className="mt-1" type="number" min={0} value={form.capacity} onChange={e => set('capacity', +e.target.value)} /></div>
            <div><Label>备注</Label><Input className="mt-1" placeholder="可选" value={form.remark} onChange={e => set('remark', e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>取消</Button>
            <Button
              disabled={!form.warehouseId || !form.code || createMut.isPending || updateMut.isPending}
              onClick={() => editTarget ? updateMut.mutate() : createMut.mutate()}
            >
              {editTarget ? '保存' : '创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        title="删除库位"
        description={`确认删除库位 ${deleteTarget?.code}？`}
        variant="destructive"
        confirmText="确认删除"
        onConfirm={() => { deleteMut.mutate(deleteTarget!.id); setDeleteTarget(null) }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
