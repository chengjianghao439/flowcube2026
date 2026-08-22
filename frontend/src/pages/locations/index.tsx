/**
 * 库位管理页
 * 路由：/locations
 */
import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { activeTone } from '@/lib/statusTone'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getLocationsApi, createLocationApi, updateLocationApi, deleteLocationApi, printLocationLabelApi } from '@/api/locations'
import { getWarehousesActiveApi } from '@/api/warehouses'
import { LOCATION_STATUS_OPTIONS, type Location, type CreateLocationParams } from '@/types/locations'
import { Button } from '@/components/ui/button'
import TableActionsMenu from '@/components/shared/TableActionsMenu'
import { downloadExport } from '@/lib/exportDownload'
import { toast } from '@/lib/toast'
import { printQueueFeedback, triggerPrintPoll } from '@/lib/printQueue'
import LocationQueryDialog, { type LocationQueryValues } from './LocationQueryDialog'
import type { TableColumn } from '@/types'
import BaseCrudPage from '@/components/shared/BaseCrudPage'

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
  const [keyword, setKeyword]         = useState('')
  const [warehouseFilter, setWarehouseFilter] = useState<number | null>(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [zoneFilter, setZoneFilter]     = useState('')
  const [queryOpen, setQueryOpen]     = useState(false)
  const [form, setForm]               = useState<CreateLocationParams>(EMPTY_FORM)
  const [page, setPage]               = useState(1)

  const { data: whData } = useQuery({
    queryKey: ['warehouses-simple'],
    queryFn: () => getWarehousesActiveApi().then(r => r ?? []),
  })

  // 库位标签打印（与货架标签同构：入队 + 桌面端本机 RAW 出纸）
  const printMut = useMutation({
    mutationFn: (id: number) => printLocationLabelApi(id),
    onSuccess: (d) => {
      if (!d) return
      if (!d.queued) {
        toast.warning('未绑定打印机或离线')
        return
      }
      triggerPrintPoll()
      const fb = printQueueFeedback(d.dispatchHint)
      if (fb.level === 'warning') toast.warning(fb.message)
      else toast.success(fb.message)
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : '打印失败'),
  })

  // 打开弹窗时回填表单（新建=默认值，编辑=行数据）
  function handleOpen(editing: Location | null) {
    if (editing) {
      setForm({ warehouseId: editing.warehouseId, code: editing.code, zone: editing.zone ?? '', aisle: editing.aisle ?? '', rack: editing.rack ?? '', level: editing.level ?? '', position: editing.position ?? '', capacity: editing.capacity, status: editing.status, remark: editing.remark ?? '' })
    } else {
      setForm(EMPTY_FORM)
    }
  }

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

  // ── 查询弹窗筛选值 ──
  const initialQuery: LocationQueryValues = {
    keyword, warehouseId: warehouseFilter, status: statusFilter, zone: zoneFilter,
  }
  function applyQuery(v: LocationQueryValues) {
    setKeyword(v.keyword)
    setWarehouseFilter(v.warehouseId)
    setStatusFilter(v.status)
    setZoneFilter(v.zone)
    setPage(1)
    setQueryOpen(false)
  }
  function clearAll() { setKeyword(''); setWarehouseFilter(null); setStatusFilter(''); setZoneFilter(''); setPage(1) }

  // 当前生效筛选摘要（可逐项移除）
  const chips = [
    keyword && { key: 'keyword', label: `关键字：${keyword}`, onRemove: () => setKeyword('') },
    warehouseFilter && { key: 'warehouse', label: `仓库：${(whData ?? []).find((w: { id: number; name: string }) => w.id === warehouseFilter)?.name ?? warehouseFilter}`, onRemove: () => setWarehouseFilter(null) },
    statusFilter && { key: 'status', label: `状态：${STATUS_LABEL[Number(statusFilter)] ?? statusFilter}`, onRemove: () => setStatusFilter('') },
    zoneFilter && { key: 'zone', label: `区域：${zoneFilter}`, onRemove: () => setZoneFilter('') },
  ].filter(Boolean) as { key: string; label: string; onRemove: () => void }[]

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
  ]

  return (
    <>
      <BaseCrudPage<Location>
        title="库位管理"
        description="管理仓库内的存储库位"
        columns={columns}
        queryKey={['locations', keyword, warehouseFilter, statusFilter, zoneFilter, page]}
        listQuery={() => getLocationsApi({
          keyword,
          warehouseId: warehouseFilter ?? undefined,
          status: statusFilter || undefined,
          zone: zoneFilter || undefined,
          pageSize: 20,
          page,
        })}
        pagination={{ page, pageSize: 20, unit: '个', onPageChange: setPage }}
        deleteApi={(id) => deleteLocationApi(id, { skipGlobalError: true })}
        deleteMessage="仅未被库存容器引用的库位允许删除；若仍在使用，请改为编辑后停用。"
        createLabel="+ 新建库位"
        saveSuccessMessage={(editing) => editing ? '库位已保存' : '库位已创建'}
        formWidthClass="max-w-md"
        onOpen={handleOpen}
        canSubmit={() => !!form.warehouseId && !!form.code}
        headerActions={
          <>
            <Button variant="outline" onClick={() => downloadExport('/export/locations').catch(e => toast.error((e as Error).message))}>导出</Button>
            <Button variant="outline" onClick={() => setQueryOpen(true)}>查询</Button>
          </>
        }
        renderActions={(row, helpers) => (
          <TableActionsMenu
            primaryLabel="打印"
            primaryVariant="outline"
            primaryDisabled={printMut.isPending && printMut.variables === row.id}
            onPrimaryClick={() => printMut.mutate(row.id)}
            items={[
              { label: '编辑', onClick: () => helpers.openEdit(row) },
              {
                label: '删除',
                destructive: true,
                separatorBefore: true,
                onClick: () => helpers.openDelete(row),
              },
            ]}
          />
        )}
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
        renderForm={(editing) => (
          <div className="space-y-3 py-2">
            <div>
              <Label>仓库</Label>
              <Select value={String(form.warehouseId || '')} onValueChange={v => set('warehouseId', +v)} disabled={!!editing}>
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
            {editing && (
              <div>
                <Label>状态</Label>
                <Select value={String(form.status ?? editing.status ?? 1)} onValueChange={v => set('status' as keyof CreateLocationParams, +v)}>
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
        )}
        submitForm={(editing) => {
          return editing
            ? updateLocationApi(editing.id, form, { skipGlobalError: true })
            : createLocationApi(form, { skipGlobalError: true })
        }}
      />
      <LocationQueryDialog
        open={queryOpen}
        initial={initialQuery}
        onClose={() => setQueryOpen(false)}
        onApply={applyQuery}
      />
    </>
  )
}
