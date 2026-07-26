/**
 * 分拣格管理页
 * 路由：/sorting-bins
 */
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from '@/lib/toast'
import PageHeader from '@/components/shared/PageHeader'
import { FilterCard } from '@/components/shared/FilterCard'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import type { StatusTone } from '@/lib/statusTone'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import {
  getSortingBinsApi, createSortingBinApi, batchCreateSortingBinsApi,
  releaseSortingBinApi, deleteSortingBinApi, updateSortingBinApi,
} from '@/api/sorting-bins'
import type { SortingBin } from '@/api/sorting-bins'
import { getWarehousesActiveApi } from '@/api/warehouses'
import type { TableColumn } from '@/types'
import DataTable from '@/components/shared/DataTable'
import TableActionsMenu from '@/components/shared/TableActionsMenu'

const STATUS_TONE:  Record<number, StatusTone> = { 1:'draft', 2:'active' }
const STATUS_LABEL: Record<number, string>     = { 1:'空闲', 2:'占用' }

// ─── 新建单个分拣格弹窗 ───────────────────────────────────────────────────────
function CreateDialog({ open, onClose, onSuccess }: { open: boolean; onClose: () => void; onSuccess: () => void }) {
  const [code, setCode]               = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [remark, setRemark]           = useState('')

  const { data: whData } = useQuery({
    queryKey: ['warehouses-simple'],
    queryFn: () => getWarehousesActiveApi().then(r => r ?? []),
  })

  const mut = useMutation({
    mutationFn: () => createSortingBinApi({ code, warehouseId: +warehouseId, remark }),
    onSuccess: () => { toast.success('分拣格已创建'); onSuccess(); onClose(); setCode(''); setRemark('') },
  })

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>新建分拣格</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div><Label>编号</Label><Input className="mt-1" placeholder="如 A01" value={code} onChange={e => setCode(e.target.value)} /></div>
          <div>
            <Label>仓库</Label>
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="选择仓库" /></SelectTrigger>
              <SelectContent>
                {(whData ?? []).map((w: { id: number; name: string }) => (
                  <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div><Label>备注</Label><Input className="mt-1" placeholder="可选" value={remark} onChange={e => setRemark(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button disabled={!code || !warehouseId || mut.isPending} onClick={() => mut.mutate()}>创建</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── 编辑弹窗（备注 / 容量阈值）───────────────────────────────────────────────
function EditDialog({ bin, onClose, onSuccess }: { bin: SortingBin | null; onClose: () => void; onSuccess: () => void }) {
  const [remark, setRemark]     = useState('')
  const [capacity, setCapacity] = useState('')

  useEffect(() => {
    if (bin) { setRemark(bin.remark ?? ''); setCapacity(bin.capacity != null ? String(bin.capacity) : '') }
  }, [bin])

  const mut = useMutation({
    mutationFn: () => updateSortingBinApi(bin!.id, {
      remark,
      capacity: capacity.trim() === '' ? null : +capacity,
    }),
    onSuccess: () => { toast.success('已更新'); onSuccess(); onClose() },
  })

  return (
    <Dialog open={!!bin} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>编辑分拣格 {bin?.code}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>容量阈值（件）</Label>
            <Input className="mt-1" type="number" min={1} placeholder="不限容量" value={capacity} onChange={e => setCapacity(e.target.value)} />
            <p className="mt-1 text-xs text-muted-foreground">分拣件数超过阈值时，PDA 端会提醒但不阻断作业；留空表示不限容量。</p>
          </div>
          <div><Label>备注</Label><Input className="mt-1" placeholder="可选" value={remark} onChange={e => setRemark(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button disabled={mut.isPending} onClick={() => mut.mutate()}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── 批量创建弹窗 ─────────────────────────────────────────────────────────────
function BatchDialog({ open, onClose, onSuccess }: { open: boolean; onClose: () => void; onSuccess: () => void }) {
  const [warehouseId, setWarehouseId] = useState('')
  const [prefix, setPrefix]           = useState('A')
  const [from, setFrom]               = useState('1')
  const [to, setTo]                   = useState('10')

  const { data: whData } = useQuery({
    queryKey: ['warehouses-simple'],
    queryFn: () => getWarehousesActiveApi().then(r => r ?? []),
  })

  const mut = useMutation({
    mutationFn: () => batchCreateSortingBinsApi({ warehouseId: +warehouseId, prefix, from: +from, to: +to }),
    onSuccess: (res) => {
      toast.success(`已创建 ${res?.length ?? 0} 个分拣格`)
      onSuccess(); onClose()
    },
  })

  const preview = prefix && from && to
    ? `${prefix}${String(+from).padStart(2,'0')} ~ ${prefix}${String(+to).padStart(2,'0')}`
    : ''

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>批量创建分拣格</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>仓库</Label>
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="选择仓库" /></SelectTrigger>
              <SelectContent>
                {(whData ?? []).map((w: { id: number; name: string }) => (
                  <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>前缀</Label><Input className="mt-1" placeholder="A" value={prefix} onChange={e => setPrefix(e.target.value.toUpperCase())} maxLength={5} /></div>
            <div><Label>起始序号</Label><Input className="mt-1" type="number" min={1} value={from} onChange={e => setFrom(e.target.value)} /></div>
            <div><Label>结束序号</Label><Input className="mt-1" type="number" min={1} value={to} onChange={e => setTo(e.target.value)} /></div>
          </div>
          {preview && <p className="text-sm text-muted-foreground">将创建：{preview}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button disabled={!warehouseId || !prefix || !from || !to || mut.isPending} onClick={() => mut.mutate()}>批量创建</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────
export default function SortingBinsPage() {
  const qc = useQueryClient()
  const [keyword, setKeyword]     = useState('')
  const [search, setSearch]       = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [createOpen, setCreateOpen]     = useState(false)
  const [batchOpen, setBatchOpen]       = useState(false)
  const [releaseTarget, setReleaseTarget] = useState<SortingBin | null>(null)
  const [deleteTarget, setDeleteTarget]   = useState<SortingBin | null>(null)
  const [editTarget, setEditTarget]       = useState<SortingBin | null>(null)

  const { data: bins, isLoading } = useQuery({
    queryKey: ['sorting-bins', keyword, statusFilter],
    queryFn: () => getSortingBinsApi({ keyword, status: statusFilter ? +statusFilter : undefined })
      .then(r => r ?? []),
  })

  function invalidate() { qc.invalidateQueries({ queryKey: ['sorting-bins'] }) }

  const releaseMut = useMutation({
    mutationFn: (id: number) => releaseSortingBinApi(id),
    onSuccess: () => { toast.success('分拣格已释放'); invalidate() },
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteSortingBinApi(id),
    onSuccess: () => { toast.success('已删除'); invalidate() },
  })

  const columns: TableColumn<SortingBin>[] = [
    { key: 'code',          title: '分拣格编号', width: 120,
      render: (v) => <span className="text-doc-code-strong">{v as string}</span> },
    { key: 'warehouseName', title: '仓库', width: 140 },
    { key: 'status',        title: '状态', width: 80,
      render: (v) => <SoftStatusLabel label={STATUS_LABEL[v as number]} tone={STATUS_TONE[v as number] ?? 'draft'} /> },
    { key: 'currentTaskNo', title: '当前任务',
      render: (v) => v ? <span className="text-doc-code">{v as string}</span> : <span className="text-muted-foreground">—</span> },
    { key: 'customerName',  title: '客户', width: 140,
      render: (v) => (v as string | null) ?? <span className="text-muted-foreground">—</span> },
    { key: 'capacity',      title: '容量阈值', width: 90,
      render: (v) => (v != null ? `${v} 件` : <span className="text-muted-foreground">不限</span>) },
    { key: 'remark',        title: '备注',
      render: (v) => (v as string | null) ?? <span className="text-muted-foreground">—</span> },
    {
      key: 'id', title: '操作', width: 160,
      render: (_, row) => (
        row.status === 2 ? (
          <TableActionsMenu
            primaryLabel="释放"
            primaryVariant="outline"
            onPrimaryClick={() => setReleaseTarget(row)}
            items={[
              { label: '编辑', onClick: () => setEditTarget(row) },
              { label: '删除', destructive: true, onClick: () => setDeleteTarget(row) },
            ]}
          />
        ) : (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditTarget(row)}>编辑</Button>
            <Button size="sm" variant="destructive" onClick={() => setDeleteTarget(row)}>删除</Button>
          </div>
        )
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="分拣格管理"
        description="管理仓库 Put Wall 分拣格，查看占用状态"
        actions={
          <>
            <Button variant="outline" onClick={() => setBatchOpen(true)}>批量创建</Button>
            <Button onClick={() => setCreateOpen(true)}>+ 新建分拣格</Button>
          </>
        }
      />

      <FilterCard>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[180px]">
            <Input placeholder="搜索编号 / 仓库 / 客户" value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key==='Enter') { setKeyword(search) } }}
            />
          </div>
          <Select value={statusFilter || '__all__'} onValueChange={v => setStatusFilter(v === '__all__' ? '' : v)}>
            <SelectTrigger className="w-32"><SelectValue placeholder="全部状态" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">全部</SelectItem>
              <SelectItem value="1">空闲</SelectItem>
              <SelectItem value="2">占用</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => setKeyword(search)}>搜索</Button>
          <Button variant="outline" onClick={() => { setSearch(''); setKeyword(''); setStatusFilter('') }}>重置</Button>
        </div>
      </FilterCard>

      <DataTable
        columns={columns}
        data={bins ?? []}
        loading={isLoading}
        rowKey="id"
      />

      <CreateDialog open={createOpen} onClose={() => setCreateOpen(false)} onSuccess={invalidate} />
      <BatchDialog  open={batchOpen}  onClose={() => setBatchOpen(false)}  onSuccess={invalidate} />
      <EditDialog   bin={editTarget}  onClose={() => setEditTarget(null)}  onSuccess={invalidate} />

      <ConfirmDialog
        open={!!releaseTarget}
        title="强制释放分拣格"
        description={`确认释放 ${releaseTarget?.code}？当前关联任务将解除绑定。`}
        confirmText="确认释放"
        onConfirm={() => { releaseMut.mutate(releaseTarget!.id); setReleaseTarget(null) }}
        onCancel={() => setReleaseTarget(null)}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        title="删除分拣格"
        description={`确认删除 ${deleteTarget?.code}？`}
        variant="destructive"
        confirmText="确认删除"
        onConfirm={() => { deleteMut.mutate(deleteTarget!.id); setDeleteTarget(null) }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
