/**
 * 货架管理
 * 路由：/racks
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { toast } from '@/lib/toast'
import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { activeTone } from '@/lib/statusTone'
import { getRacksApi, deleteRackApi, printRackLabelApi } from '@/api/racks'
import { getWarehousesActiveApi } from '@/api/warehouses'
import DataTable from '@/components/shared/DataTable'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import TableActionsMenu from '@/components/shared/TableActionsMenu'
import type { TableColumn } from '@/types'
import type { Rack } from '@/types/racks'
import RackFormDialog from '@/pages/locations/components/RackFormDialog'
import { getLocalPrintEnvironmentKind } from '@/lib/desktopLocalPrint'
import { printQueueFeedback, triggerPrintPoll } from '@/lib/printQueue'
import RackQueryDialog, { type RackQueryValues } from './RackQueryDialog'

export default function RacksPage() {
  const qc = useQueryClient()
  const [keyword, setKeyword] = useState('')
  const [warehouseFilter, setWarehouseFilter] = useState<number | null>(null)
  const [warehouseName, setWarehouseName] = useState('')
  const [zoneFilter, setZoneFilter] = useState('')
  const [queryOpen, setQueryOpen] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editItem, setEditItem] = useState<Rack | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Rack | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['racks', keyword, warehouseFilter, zoneFilter],
    queryFn: () =>
      getRacksApi({
        pageSize: 99999,
        keyword,
        warehouseId: warehouseFilter ?? undefined,
        zone: zoneFilter || undefined,
      }),
  })

  const { data: whData } = useQuery({
    queryKey: ['warehouses-simple'],
    queryFn: () => getWarehousesActiveApi().then(r => r ?? []),
  })

  // ── 查询弹窗筛选值 ──
  const initialQuery: RackQueryValues = {
    keyword, warehouseId: warehouseFilter, warehouseName, zone: zoneFilter,
  }
  function applyQuery(v: RackQueryValues) {
    setKeyword(v.keyword)
    setWarehouseFilter(v.warehouseId)
    setWarehouseName(v.warehouseName)
    setZoneFilter(v.zone)
    setQueryOpen(false)
  }
  function clearAll() { setKeyword(''); setWarehouseFilter(null); setWarehouseName(''); setZoneFilter('') }

  // 当前生效筛选摘要（可逐项移除）
  const chips = [
    keyword && { key: 'keyword', label: `关键字：${keyword}`, onRemove: () => setKeyword('') },
    warehouseFilter && { key: 'warehouse', label: `仓库：${warehouseName || (whData ?? []).find((w: { id: number; name: string }) => w.id === warehouseFilter)?.name || warehouseFilter}`, onRemove: () => { setWarehouseFilter(null); setWarehouseName('') } },
    zoneFilter && { key: 'zone', label: `区域：${zoneFilter}`, onRemove: () => setZoneFilter('') },
  ].filter(Boolean) as { key: string; label: string; onRemove: () => void }[]

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteRackApi(id, { skipGlobalError: true }),
    onSuccess: () => {
      toast.success('已删除')
      setDeleteTarget(null)
      qc.invalidateQueries({ queryKey: ['racks'] })
    },
    onError: (e: unknown) =>
      toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '删除失败'),
  })

  const printMut = useMutation({
    mutationFn: (id: number) => printRackLabelApi(id),
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

  const localPrintEnv = getLocalPrintEnvironmentKind()

  const columns: TableColumn<Rack>[] = [
    {
      key: 'barcode',
      title: '货架条码',
      width: 120,
      render: (v) =>
        v ? <span className="text-doc-code-strong">{v as string}</span> : <span className="text-muted-foreground">—</span>,
    },
    { key: 'code', title: '编码', width: 100 },
    { key: 'zone', title: '库区', width: 72, render: v => (v as string) || '—' },
    { key: 'name', title: '名称', width: 180, render: v => (v as string) || '—' },
    { key: 'warehouseName', title: '仓库', width: 140 },
    {
      key: 'status',
      title: '状态',
      width: 80,
      render: (_, row) => (
        <SoftStatusLabel label={row.status === 1 ? '启用' : '停用'} tone={activeTone(row.status === 1)} />
      ),
    },
    {
      key: 'actions',
      title: '操作',
      width: 152,
      render: (_, row) => (
        <TableActionsMenu
          primaryLabel="打印"
          primaryVariant="outline"
          primaryDisabled={printMut.isPending && printMut.variables === row.id}
          onPrimaryClick={() => printMut.mutate(row.id)}
          items={[
            {
              label: '编辑',
              onClick: () => { setEditItem(row); setFormOpen(true) },
            },
            {
              label: '删除',
              destructive: true,
              separatorBefore: true,
              disabled: deleteMut.isPending,
              onClick: () => setDeleteTarget(row),
            },
          ]}
        />
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="货架管理"
        description="货架唯一条码（H）与标签打印"
        actions={
          <>
            <Button variant="outline" onClick={() => setQueryOpen(true)}>查询</Button>
            <Button onClick={() => { setEditItem(null); setFormOpen(true) }}>+ 新建货架</Button>
          </>
        }
      />

      {localPrintEnv !== 'ok' && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm leading-relaxed ${
            localPrintEnv === 'electron_no_bridge'
              ? 'border-destructive/50 bg-destructive/5 text-destructive'
              : 'border-amber-500/50 bg-amber-500/5 text-amber-950 dark:text-amber-100'
          }`}
        >
          {localPrintEnv === 'browser' ? (
            <>
              <strong>当前页面无法本机出纸：</strong>
              检测到在普通浏览器中打开，不会调用 Windows
              打印队列，故「打印队列里什么也没有」是正常现象。请安装并打开
              <strong> 极序 Flow ERP 桌面客户端</strong>
              ，在桌面程序里登录同一服务器后再点「打印」。
            </>
          ) : (
            <>
              <strong>桌面端未加载本机打印桥接：</strong>
              无法向标签机送 RAW。请完全退出后重启极序 Flow ERP；仍不行请检查安全软件是否拦截预加载脚本。在控制台执行{' '}
              <code className="rounded bg-muted px-1">typeof window.flowcubeDesktop?.printZpl</code> 应显示{' '}
              <code className="rounded bg-muted px-1">&quot;function&quot;</code>。
            </>
          )}
        </div>
      )}

      {chips.length > 0 && (
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
      )}

      <DataTable
        columns={columns}
        data={data?.list ?? []}
        loading={isLoading}
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

      <RackQueryDialog
        open={queryOpen}
        initial={initialQuery}
        onClose={() => setQueryOpen(false)}
        onApply={applyQuery}
      />
    </div>
  )
}
