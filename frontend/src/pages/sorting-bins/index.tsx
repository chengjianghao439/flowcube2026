/**
 * 分拣格管理页
 * 路由：/sorting-bins
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { toast } from '@/lib/toast'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
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
import TableActionsMenu from '@/components/shared/TableActionsMenu'
import SortingBinQueryDialog, { type SortingBinQueryValues } from './SortingBinQueryDialog'
import { SORTING_BIN_STATUS_TONE, SORTING_BIN_STATUS_LABEL } from './constants'
import BaseCrudPage from '@/components/shared/BaseCrudPage'
import { downloadExport } from '@/lib/exportDownload'

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
      <DialogContent className="max-w-2xl">
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
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [warehouseFilter, setWarehouseFilter] = useState<number | null>(null)
  const [warehouseName, setWarehouseName] = useState('')
  const [queryOpen, setQueryOpen] = useState(false)
  const [batchOpen, setBatchOpen] = useState(false)
  const [releaseTarget, setReleaseTarget] = useState<SortingBin | null>(null)
  const [form, setForm] = useState({ code: '', warehouseId: '', remark: '', capacity: '' })

  const qc = useQueryClient()

  const { data: whData } = useQuery({
    queryKey: ['warehouses-simple'],
    queryFn: () => getWarehousesActiveApi().then(r => r ?? []),
  })

  // 打开弹窗时回填表单（新建=默认值，编辑=备注/容量阈值）
  function handleOpen(editing: SortingBin | null) {
    if (editing) {
      setForm({
        code: editing.code,
        warehouseId: String(editing.warehouseId),
        remark: editing.remark ?? '',
        capacity: editing.capacity != null ? String(editing.capacity) : '',
      })
    } else {
      setForm({ code: '', warehouseId: '', remark: '', capacity: '' })
    }
  }

  // ── 查询弹窗筛选值 ──
  const initialQuery: SortingBinQueryValues = {
    keyword, status: statusFilter, warehouseId: warehouseFilter, warehouseName,
  }
  function applyQuery(v: SortingBinQueryValues) {
    setKeyword(v.keyword)
    setStatusFilter(v.status)
    setWarehouseFilter(v.warehouseId)
    setWarehouseName(v.warehouseName)
    setQueryOpen(false)
  }
  function clearAll() { setKeyword(''); setStatusFilter(''); setWarehouseFilter(null); setWarehouseName('') }

  // 当前生效筛选摘要（可逐项移除）
  const chips = [
    keyword && { key: 'keyword', label: `关键字：${keyword}`, onRemove: () => setKeyword('') },
    statusFilter && { key: 'status', label: `状态：${SORTING_BIN_STATUS_LABEL[+statusFilter] ?? statusFilter}`, onRemove: () => setStatusFilter('') },
    warehouseFilter && { key: 'warehouse', label: `仓库：${warehouseName || warehouseFilter}`, onRemove: () => { setWarehouseFilter(null); setWarehouseName('') } },
  ].filter(Boolean) as { key: string; label: string; onRemove: () => void }[]

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['sorting-bins'] })
  }

  const releaseMut = useMutation({
    mutationFn: (id: number) => releaseSortingBinApi(id),
    onSuccess: () => { toast.success('分拣格已释放'); setReleaseTarget(null); invalidate() },
  })

  const columns: TableColumn<SortingBin>[] = [
    { key: 'code',          title: '分拣格编号', width: 200,
      render: (v) => <span className="text-doc-code-strong">{v as string}</span> },
    { key: 'warehouseName', title: '仓库', width: 140 },
    { key: 'status',        title: '状态', width: 80,
      render: (v) => <SoftStatusLabel label={SORTING_BIN_STATUS_LABEL[v as number]} tone={SORTING_BIN_STATUS_TONE[v as number] ?? 'draft'} /> },
    { key: 'currentTaskNo', title: '当前任务',
      render: (v) => v ? <span className="text-doc-code">{v as string}</span> : <span className="text-muted-foreground">—</span> },
    { key: 'customerName',  title: '客户', width: 140,
      render: (v) => (v as string | null) ?? <span className="text-muted-foreground">—</span> },
    { key: 'capacity',      title: '容量阈值', width: 90,
      render: (v) => (v != null ? `${v} 件` : <span className="text-muted-foreground">不限</span>) },
    { key: 'remark',        title: '备注',
      render: (v) => (v as string | null) ?? <span className="text-muted-foreground">—</span> },
  ]

  return (
    <>
      <BaseCrudPage<SortingBin>
        title="分拣格管理"
        description="管理仓库 Put Wall 分拣格，查看占用状态"
        columns={columns}
        queryKey={['sorting-bins', keyword, statusFilter, warehouseFilter]}
        listQuery={() => getSortingBinsApi({
          keyword,
          status: statusFilter ? +statusFilter : undefined,
          warehouseId: warehouseFilter ?? undefined,
        }).then(r => r ?? [])}
        deleteApi={(id) => deleteSortingBinApi(id)}
        deleteMessage="确认删除该分拣格？"
        createLabel="+ 新建分拣格"
        saveSuccessMessage={(editing) => editing ? '已更新' : '分拣格已创建'}
        formWidthClass="max-w-2xl"
        onOpen={handleOpen}
        canSubmit={(editing) => editing ? true : !!form.code && !!form.warehouseId}
        headerActions={
          <>
            <Button variant="outline" onClick={() => downloadExport('/export/sorting-bins').catch(e => toast.error((e as Error).message))}>导出</Button>
            <Button variant="outline" onClick={() => setQueryOpen(true)}>查询</Button>
            <Button variant="outline" onClick={() => setBatchOpen(true)}>批量创建</Button>
          </>
        }
        renderToolbar={
          chips.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              {chips.map(c => (
                <span key={c.key} className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                  {c.label}
                  <button type="button" onClick={c.onRemove} className="text-muted-foreground/70 hover:text-foreground" aria-label={`移除筛选 ${c.label}`}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <Button size="sm" variant="ghost" onClick={clearAll}>清空</Button>
            </div>
          ) : null
        }
        renderActions={(row, helpers) => (
          row.status === 2 ? (
            <TableActionsMenu
              primaryLabel="释放"
              primaryVariant="outline"
              onPrimaryClick={() => setReleaseTarget(row)}
              items={[
                { label: '编辑', onClick: () => helpers.openEdit(row) },
                { label: '删除', destructive: true, onClick: () => helpers.openDelete(row) },
              ]}
            />
          ) : (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => helpers.openEdit(row)}>编辑</Button>
              <Button size="sm" variant="destructive" onClick={() => helpers.openDelete(row)}>删除</Button>
            </div>
          )
        )}
        renderForm={(editing) => editing ? (
          <div className="space-y-4 py-2">
            <div>
              <Label>容量阈值（件）</Label>
              <Input className="mt-1" type="number" min={1} placeholder="不限容量" value={form.capacity} onChange={e => setForm(f => ({ ...f, capacity: e.target.value }))} />
              <p className="mt-1 text-xs text-muted-foreground">分拣件数超过阈值时，PDA 端会提醒但不阻断作业；留空表示不限容量。</p>
            </div>
            <div><Label>备注</Label><Input className="mt-1" placeholder="可选" value={form.remark} onChange={e => setForm(f => ({ ...f, remark: e.target.value }))} /></div>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div><Label>编号</Label><Input className="mt-1" placeholder="如 A01" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} /></div>
            <div>
              <Label>仓库</Label>
              <Select value={form.warehouseId} onValueChange={v => setForm(f => ({ ...f, warehouseId: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="选择仓库" /></SelectTrigger>
                <SelectContent>
                  {(whData ?? []).map((w: { id: number; name: string }) => (
                    <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div><Label>备注</Label><Input className="mt-1" placeholder="可选" value={form.remark} onChange={e => setForm(f => ({ ...f, remark: e.target.value }))} /></div>
          </div>
        )}
        submitForm={(editing) => {
          if (editing) {
            return updateSortingBinApi(editing.id, {
              remark: form.remark,
              capacity: form.capacity.trim() === '' ? null : +form.capacity,
            })
          }
          return createSortingBinApi({ code: form.code, warehouseId: +form.warehouseId, remark: form.remark })
        }}
      />

      <BatchDialog open={batchOpen} onClose={() => setBatchOpen(false)} onSuccess={invalidate} />

      <SortingBinQueryDialog
        open={queryOpen}
        initial={initialQuery}
        onClose={() => setQueryOpen(false)}
        onApply={applyQuery}
      />

      <ConfirmDialog
        open={!!releaseTarget}
        title="强制释放分拣格"
        description={`确认释放 ${releaseTarget?.code}？当前关联任务将解除绑定。`}
        confirmText="确认释放"
        onConfirm={() => { releaseMut.mutate(releaseTarget!.id) }}
        onCancel={() => setReleaseTarget(null)}
      />
    </>
  )
}
