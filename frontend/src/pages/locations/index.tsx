/**
 * 库位管理页
 * 路由：/locations
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from '@/lib/toast'
import PageHeader from '@/components/shared/PageHeader'
import { FilterCard } from '@/components/shared/FilterCard'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { activeTone } from '@/lib/statusTone'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { getLocationsApi, createLocationApi, updateLocationApi, deleteLocationApi } from '@/api/locations'
import { getWarehousesActiveApi } from '@/api/warehouses'
import { LOCATION_STATUS_OPTIONS, type Location, type CreateLocationParams } from '@/types/locations'
import DataTable from '@/components/shared/DataTable'
import TableActionsMenu from '@/components/shared/TableActionsMenu'
import type { TableColumn } from '@/types'

const STATUS_LABEL: Record<number, string> = { 1: '启用', 2: '停用' }

const EMPTY_FORM: CreateLocationParams = { warehouseId: 0, code: '', zone: '', aisle: '', rack: '', level: '', position: '', capacity: 0, status: 1, remark: '' }

/**
 * 根据库区/巷道/货架/层/位自动生成库位编码
 * 规则：zone + aisle.padStart(2,'0') + '-' + rack.padStart(2,'0') + '-' + level.padStart(2,'0') + position.padStart(2,'0')
 * 例：A + 01 + - + 01 + - + 01 + 01  →  A01-01-0101
 * 任意字段为空时返回空字符串
 */
function buildCode(zone: string, aisle: string, rack: string, level: string, position: string): string {
  if (!zone.trim() || !aisle.trim() || !rack.trim() || !level.trim() || !position.trim()) return ''
  const pad = (v: string) => v.trim().padStart(2, '0')
  return `${zone.trim()}${pad(aisle)}-${pad(rack)}-${pad(level)}${pad(position)}`
}

export default function LocationsPage() {
  const qc = useQueryClient()
  const [keyword, setKeyword]         = useState('')
  const [search, setSearch]           = useState('')
  const [warehouseFilter, setWarehouseFilter] = useState<string>('')
  const [dialogOpen, setDialogOpen]   = useState(false)
  const [editTarget, setEditTarget]   = useState<Location | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Location | null>(null)
  const [form, setForm]               = useState<CreateLocationParams>(EMPTY_FORM)

  const { data, isLoading } = useQuery({
    queryKey: ['locations', keyword, warehouseFilter],
    queryFn: () => getLocationsApi({ keyword, warehouseId: warehouseFilter ? +warehouseFilter : undefined, pageSize: 99999 }),
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
    onError: (e: unknown) => toast.error((e as Error).message || '删除失败'),
  })

  function openCreate() { setEditTarget(null); setForm(EMPTY_FORM); setDialogOpen(true) }
  function openEdit(loc: Location) {
    setEditTarget(loc)
    setForm({ warehouseId: loc.warehouseId, code: loc.code, zone: loc.zone ?? '', aisle: loc.aisle ?? '', rack: loc.rack ?? '', level: loc.level ?? '', position: loc.position ?? '', capacity: loc.capacity, status: loc.status, remark: loc.remark ?? '' })
    setDialogOpen(true)
  }
  function closeDialog() { setDialogOpen(false); setEditTarget(null); setForm(EMPTY_FORM) }

  /**
   * 分段字段（区/巷/架/层/位）变化时自动重建编码。
   * 仅当五段齐全（buildCode 返回非空）才覆盖 code：编辑存量手写编码的库位时，
   * 若分段不完整，保留原编码而不是被清空——避免把历史库位编码洗掉。
   */
  const SEGMENT_KEYS = new Set<keyof CreateLocationParams>(['zone', 'aisle', 'rack', 'level', 'position'])
  const set = (k: keyof CreateLocationParams, v: string | number) => setForm(f => {
    const next = { ...f, [k]: v }
    if (SEGMENT_KEYS.has(k)) {
      const code = buildCode(String(next.zone ?? ''), String(next.aisle ?? ''), String(next.rack ?? ''), String(next.level ?? ''), String(next.position ?? ''))
      if (code) next.code = code
    }
    return next
  })

  const columns: TableColumn<Location>[] = [
    { key: 'code',          title: '库位编号', width: 120,
      render: v => <span className="text-doc-code-strong">{v as string}</span> },
    { key: 'warehouseName', title: '仓库', width: 140,
      render: v => (v as string | null) ?? <span className="text-muted-foreground">—</span> },
    { key: 'zone',    title: '区域', render: v => (v as string | null) ?? <span className="text-muted-foreground">—</span> },
    { key: 'aisle',   title: '通道', render: v => (v as string | null) ?? <span className="text-muted-foreground">—</span> },
    { key: 'rack',    title: '货架', render: v => (v as string | null) ?? <span className="text-muted-foreground">—</span> },
    { key: 'capacity', title: '容量', width: 80 },
    { key: 'status', title: '状态', width: 80,
      render: v => <SoftStatusLabel label={STATUS_LABEL[v as number]} tone={activeTone(Number(v) === 1)} /> },
    { key: 'containerCount', title: '容器数', width: 80,
      render: v => (v as number | null) ?? 0 },
    {
      key: 'id', title: '操作', width: 120,
      render: (_, row) => (
        <TableActionsMenu
          primaryLabel="编辑"
          primaryVariant="outline"
          onPrimaryClick={() => openEdit(row)}
          items={[
            { label: '删除', destructive: true, onClick: () => setDeleteTarget(row) },
          ]}
        />
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

      <FilterCard>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[180px]">
            <Input placeholder="库位编号 / 区域" value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { setKeyword(search) } }}
            />
          </div>
          <Select value={warehouseFilter || '__all__'} onValueChange={v => { setWarehouseFilter(v === '__all__' ? '' : v) }}>
            <SelectTrigger className="w-36"><SelectValue placeholder="全部仓库" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">全部</SelectItem>
              {(whData ?? []).map((w: { id: number; name: string }) => (
                <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => { setKeyword(search) }}>搜索</Button>
          <Button variant="outline" onClick={() => { setSearch(''); setKeyword(''); setWarehouseFilter('') }}>重置</Button>
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
            <div className="grid grid-cols-3 gap-3">
              <div><Label>库区</Label><Input className="mt-1" placeholder="如 A" value={form.zone ?? ''} onChange={e => set('zone', e.target.value)} /></div>
              <div><Label>巷道</Label><Input className="mt-1" placeholder="如 01" value={form.aisle ?? ''} onChange={e => set('aisle', e.target.value)} /></div>
              <div><Label>货架</Label><Input className="mt-1" placeholder="如 01" value={form.rack ?? ''} onChange={e => set('rack', e.target.value)} /></div>
              <div><Label>层</Label><Input className="mt-1" placeholder="如 01" value={form.level ?? ''} onChange={e => set('level', e.target.value)} /></div>
              <div><Label>位</Label><Input className="mt-1" placeholder="如 01" value={form.position ?? ''} onChange={e => set('position', e.target.value)} /></div>
              <div>
                <Label>库位编码</Label>
                <Input className="mt-1 bg-muted/50 font-mono" placeholder="自动生成" value={form.code} readOnly />
              </div>
            </div>
            <div><Label>容量</Label><Input className="mt-1" type="number" min={0} value={form.capacity} onChange={e => set('capacity', +e.target.value)} /></div>
            {editTarget && (
              <div>
                <Label>状态</Label>
                <Select value={String(form.status ?? editTarget.status ?? 1)} onValueChange={v => set('status' as keyof CreateLocationParams, +v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="选择状态" /></SelectTrigger>
                  <SelectContent>
                    {LOCATION_STATUS_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={String(option.value)}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
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
        description={`确认删除库位 ${deleteTarget?.code}？仅未被库存容器引用的库位允许删除；若仍在使用，请改为编辑后停用。`}
        variant="destructive"
        confirmText="确认删除"
        onConfirm={() => { deleteMut.mutate(deleteTarget!.id); setDeleteTarget(null) }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
