/**
 * 货架管理
 * 路由：/racks
 */
import { useState } from 'react'
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
import type { TableColumn } from '@/types'
import type { Rack } from '@/types/racks'
import RackFormDialog from '@/pages/locations/components/RackFormDialog'
import {
  isDesktopLocalPrintAvailable,
  isDesktopLocalPrintError,
  tryDesktopLocalZplThenComplete,
} from '@/lib/desktopLocalPrint'
import { printRackLabelWithSystemDialog } from '@/lib/printRackLabelHtml'
import { ChevronDown, Edit2, Printer, Trash2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export default function RacksPage() {
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
          toast.success('已从本机打印货架标签并核销队列')
          return
        }
        if (isDesktopLocalPrintError(local)) {
          toast.error(
            `${local.error}。若本机 RAW 标签机不可用，请点「打印」→「系统打印对话框（HTML）」用任意打印机输出。`,
          )
          return
        }
        if (local === 'skipped' && !isDesktopLocalPrintAvailable()) {
          toast.warning(
            '当前不是 FlowCube 桌面端（或未加载本机打印桥接），标签机不会出纸。请使用桌面安装包打开 ERP；若已在桌面端内，请重启应用或检查是否被安全软件拦截预加载脚本。任务已在服务器入队。',
          )
          return
        }
        const h = d.dispatchHint
        if (h?.code === 'no_print_client') {
          toast.warning(h.message || '未检测到在线打印客户端，打印机不会出纸')
        } else if (h?.code === 'queued_concurrency') {
          toast.warning(h.message || '任务已入队，因并发上限排队中')
        } else if (h?.code === 'dispatched') {
          toast.success(d.printerCode ? `已下发至工作站 → ${d.printerCode}` : '已下发至打印工作站')
        } else {
          toast.success(d.printerCode ? `已入队 → ${d.printerCode}` : '已加入打印队列')
        }
      } else {
        toast.warning('未绑定「库存标签」打印机或标签机离线，未创建任务')
      }
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : '打印失败'),
  })

  function handleSearch() {
    setPage(1)
    setKeyword(search)
  }

  const columns: TableColumn<Rack>[] = [
    {
      key: 'barcode',
      title: '货架条码',
      width: 120,
      render: (v) =>
        v ? <span className="font-mono font-semibold">{v as string}</span> : <span className="text-muted-foreground">—</span>,
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
        <div className="flex items-center justify-end gap-1 shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="px-2"
                disabled={printMut.isPending && printMut.variables === row.id}
              >
                <Printer className="size-3.5 mr-0.5" />
                打印
                <ChevronDown className="ml-0.5 size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => printMut.mutate(row.id)}>
                本机标签机（ZPL 入队）
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  const r = printRackLabelWithSystemDialog(row)
                  if (!r.ok) toast.warning(r.reason)
                  else toast.success('已打开系统打印对话框（与销售单打印相同方式）')
                }}
              >
                系统打印对话框（HTML）
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" disabled={deleteMut.isPending} className="px-2">
                更多
                <ChevronDown className="ml-0.5 size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => {
                  setEditItem(row)
                  setFormOpen(true)
                }}
              >
                <Edit2 className="size-4" />
                编辑
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                disabled={deleteMut.isPending}
                onClick={() => setDeleteTarget(row)}
              >
                <Trash2 className="size-4" />
                删除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="货架管理"
        description="货架唯一条码（RCK）与标签打印"
        actions={<Button onClick={() => { setEditItem(null); setFormOpen(true) }}>+ 新建货架</Button>}
      />

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
