/**
 * 分拣格管理页
 * 路由：/sorting-bins
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
import {
  getSortingBinsApi, createSortingBinApi, batchCreateSortingBinsApi,
  releaseSortingBinApi, deleteSortingBinApi,
} from '@/api/sorting-bins'
import type { SortingBin } from '@/api/sorting-bins'
import { getWarehousesActiveApi } from '@/api/warehouses'
import type { TableColumn } from '@/types'
import DataTable from '@/components/shared/DataTable'

const STATUS_VARIANT: Record<number, 'default'|'secondary'|'outline'> = { 1:'outline', 2:'default' }
const STATUS_LABEL:   Record<number, string> = { 1:'空闲', 2:'占用' }

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
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '创建失败'),
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
      toast.success(`已创建 ${res.data.data?.length ?? 0} 个分拣格`)
      onSuccess(); onClose()
    },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '批量创建失败'),
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
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [keyword, setKeyword]     = useState('')
  const [search, setSearch]       = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [createOpen, setCreateOpen]     = useState(false)
  const [batchOpen, setBatchOpen]       = useState(false)
  const [releaseTarget, setReleaseTarget] = useState<SortingBin | null>(null)
  const [deleteTarget, setDeleteTarget]   = useState<SortingBin | null>(null)

  const { data: bins, isLoading } = useQuery({
    queryKey: ['sorting-bins', keyword, statusFilter],
    queryFn: () => getSortingBinsApi({ keyword, status: statusFilter ? +statusFilter : undefined })
      .then(r => r.data.data ?? []),
  })

  function invalidate() { qc.invalidateQueries({ queryKey: ['sorting-bins'] }) }

  const releaseMut = useMutation({
    mutationFn: (id: number) => releaseSortingBinApi(id),
    onSuccess: () => { toast.success('分拣格已释放'); invalidate() },
    onError: () => toast.error('释放失败'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteSortingBinApi(id),
    onSuccess: () => { toast.success('已删除'); invalidate() },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '删除失败'),
  })

  const columns: TableColumn<SortingBin>[] = [
    { key: 'code',          title: '分拣格编号', width: 120,
      render: (v) => <span className="text-doc-code-strong">{v as string}</span> },
    { key: 'warehouseName', title: '仓库' },
    { key: 'status',        title: '状态', width: 80,
      render: (v) => <Badge variant={STATUS_VARIANT[v as number]}>{STATUS_LABEL[v as number]}</Badge> },
    { key: 'currentTaskNo', title: '当前任务',
      render: (v) => v ? <span className="text-doc-code">{v as string}</span> : <span className="text-muted-foreground">—</span> },
    { key: 'customerName',  title: '客户',
      render: (v) => v ?? <span className="text-muted-foreground">—</span> },
    { key: 'remark',        title: '备注',
      render: (v) => v ?? <span className="text-muted-foreground">—</span> },
    {
      key: 'id', title: '操作', width: 140,
      render: (_, row) => (
        <div className="flex gap-2">
          {row.status === 2 && (
            <Button size="sm" variant="outline" onClick={() => setReleaseTarget(row)}>释放</Button>
          )}
          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleteTarget(row)}>删除</Button>
        </div>
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

      <FocusModePanel
        badge="仓储执行主数据"
        title="分拣格页负责维护 Put Wall 落点，并把后续动作交给波次、仓库任务和 PDA 分拣执行"
        description="这页最适合先确认分拣格编码、仓库归属和占用状态，再回波次、仓库任务和 PDA 分拣现场继续执行。遇到格口占用异常、任务卡点或标签问题时，直接切异常工作台和打印查询继续收口。"
        summary={releaseTarget ? `当前操作：释放分拣格 - ${releaseTarget.code}` : '当前焦点：分拣格结构与占用状态'}
        steps={[
          '先维护分拣格编码和仓库归属，保证波次和客户订单有明确落格位置。',
          '再回波次详情、仓库任务和 PDA 分拣现场，确认商品已被正确分到对应格口。',
          '发现占用异常、格口冲突或标签问题时，回异常工作台和打印查询继续处理。',
        ]}
        actions={[
          { label: '打开波次详情', variant: 'default', onClick: () => navigate('/picking-waves?waveId=1&focus=print-closure') },
          { label: '打开仓库任务', onClick: () => navigate('/warehouse-tasks') },
          { label: '打开 PDA 分拣', onClick: () => navigate('/pda/sort') },
          { label: '打开异常工作台', onClick: () => navigate('/reports/exception-workbench') },
        ]}
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
