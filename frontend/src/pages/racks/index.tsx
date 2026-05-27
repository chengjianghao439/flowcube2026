/**
 * 货架管理
 * 路由：/racks
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from '@/lib/toast'
import PageHeader from '@/components/shared/PageHeader'
import { FilterCard } from '@/components/shared/FilterCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { getRacksApi, deleteRackApi, printRackLabelApi } from '@/api/racks'
import { getWarehousesActiveApi } from '@/api/warehouses'
import DataTable from '@/components/shared/DataTable'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import TableActionsMenu from '@/components/shared/TableActionsMenu'
import type { TableColumn } from '@/types'
import type { Rack } from '@/types/racks'
import RackFormDialog from '@/pages/locations/components/RackFormDialog'
import {
  getLocalPrintEnvironmentKind,
  isDesktopLocalPrintError,
  tryDesktopLocalZplThenComplete,
} from '@/lib/desktopLocalPrint'

export default function RacksPage() {
  const navigate = useNavigate()
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

  const printMut = useMutation({
    mutationFn: (id: number) => printRackLabelApi(id),
    onSuccess: async (d) => {
      if (!d) return
      if (d.queued) {
        const local = await tryDesktopLocalZplThenComplete({
          jobId: d.jobId,
          content: d.content,
          contentType: d.contentType,
          printerName: d.printerName,
        })
        if (local === 'ok') {
          toast.success('已打印')
          return
        }
        if (isDesktopLocalPrintError(local)) {
          toast.error(local.error)
          return
        }
        if (local === 'skipped_no_desktop') {
          toast.warning('已入队，请在桌面端完成打印')
          return
        }
        if (local === 'skipped_no_payload') {
          toast.warning('已入队，请在打印任务中处理')
          return
        }
        const h = d.dispatchHint
        if (h?.code === 'no_print_client') {
          toast.warning('无在线打印客户端')
        } else if (h?.code === 'queued_concurrency') {
          toast.warning('任务排队中')
        } else if (h?.code === 'dispatched') {
          toast.success('已下发至打印工作站')
        } else {
          toast.success('已加入打印队列')
        }
      } else {
        toast.warning('未绑定打印机或离线')
      }
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : '打印失败'),
  })

  function handleSearch() {
    setPage(1)
    setKeyword(search)
  }

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
        actions={<Button onClick={() => { setEditItem(null); setFormOpen(true) }}>+ 新建货架</Button>}
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
