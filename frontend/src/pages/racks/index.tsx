/**
 * 货架管理
 * 路由：/racks
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from '@/lib/toast'
import PageHeader from '@/components/shared/PageHeader'
import { FocusModePanel } from '@/components/shared/FocusModePanel'
import { ExecutionBridgePanel } from '@/components/shared/ExecutionBridgePanel'
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
  getLocalPrintEnvironmentKind,
  isDesktopLocalPrintError,
  tryDesktopLocalZplThenComplete,
} from '@/lib/desktopLocalPrint'
import { ChevronDown, Edit2, Printer, Trash2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

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
          const q = d.printerName ? `「${d.printerName}」` : '本机打印机'
          toast.success(
            `已向 ${q} 提交 RAW 并核销队列。请到 Windows「设备和打印机」中打开同名打印机的队列查看是否有瞬间出现的作业；若始终为空请看页顶提示确认是否在用桌面客户端。`,
          )
          return
        }
        if (isDesktopLocalPrintError(local)) {
          toast.error(local.error)
          return
        }
        if (local === 'skipped_no_desktop') {
          toast.warning(
            '未连接本机打印桥接：若您是用 Chrome / Edge 直接打开网页，Windows 打印队列里不会出现任何作业，标签机也不会动——请改用「极序 Flow ERP」桌面安装包登录同一地址再试。若已是桌面端，请重启应用，或在开发者工具控制台执行 typeof window.flowcubeDesktop?.printZpl 应为 function。任务已在服务器入队。',
          )
          return
        }
        if (local === 'skipped_no_payload') {
          toast.warning(
            '任务已在服务器入队，但响应中缺少可本机打印的 ZPL 或任务 ID，本机未送 RAW，Windows 打印队列中不会看到作业。请刷新页面重试，或检查网关/代理是否截断 JSON；也可在「打印任务」中处理。',
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
        <div className="flex items-center justify-end gap-1 shrink-0">
          <Button
            size="sm"
            variant="outline"
            className="px-2"
            disabled={printMut.isPending && printMut.variables === row.id}
            onClick={() => printMut.mutate(row.id)}
          >
            <Printer className="size-3.5 mr-0.5" />
            打印
          </Button>
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
        description="货架唯一条码（H）与标签打印"
        actions={<Button onClick={() => { setEditItem(null); setFormOpen(true) }}>+ 新建货架</Button>}
      />

      <FocusModePanel
        badge="仓储主数据"
        title="货架页负责维护货架条码和打印入口，并把后续执行交给现场仓库链路"
        description="这页最适合先确认货架编码、层位规则和条码打印，再回收货、仓库任务和打印查询继续处理现场执行与补打。"
        summary={editItem ? `当前操作：编辑货架 - ${editItem.code}` : '当前焦点：货架资料维护'}
        steps={[
          '先维护货架编码、层位容量和状态，保证现场扫码和摆放规则一致。',
          '需要现场执行时，回收货订单和仓库任务确认具体上架或出库链路。',
          '遇到货架标签或物流标签打印问题时，回打印查询和异常工作台继续处理。',
        ]}
        actions={[
          { label: '打开收货订单', variant: 'default', onClick: () => navigate('/inbound-tasks') },
          { label: '打开仓库任务', onClick: () => navigate('/warehouse-tasks') },
          { label: '打开打印查询', onClick: () => navigate('/settings/barcode-print-query?category=inbound&status=failed') },
        ]}
      />

      <ExecutionBridgePanel
        badge="ERP / 现场执行桥接"
        title="货架页统一承接货架规则判断与现场扫码执行"
        description="ERP 在这里负责判断货架编码、层位、状态和标签是否适合继续使用；现场则通过收货、仓库任务、扫码上架和补打链路完成真实执行，避免货架页只停在资料维护和单次打印。"
        erpTitle="先在 ERP 判断货架结构、条码规则和可用状态"
        erpItems={[
          '先确认货架编码、状态和所属仓库是否与当前现场规则一致。',
          '打印或重新打印货架标签前，优先判断是否会影响现场扫码和上架流程。',
          '货架规则确认后，再回收货订单、仓库任务或打印查询继续处理。',
        ]}
        pdaTitle="再由现场通过扫码、上架和补打动作完成真实使用"
        pdaItems={[
          'PDA 收货和上架现场负责真正扫描货架条码完成落位。',
          '仓库任务负责把货架规则带入拣货、补货和出库执行。',
          '如果现场条码损坏或打印异常，再回打印查询和异常工作台收口问题。',
        ]}
        actions={[
          { label: '打开收货订单', variant: 'default', onClick: () => navigate('/inbound-tasks') },
          { label: '打开仓库任务', onClick: () => navigate('/warehouse-tasks') },
          { label: '打开打印查询', onClick: () => navigate('/settings/barcode-print-query?category=inbound&status=failed') },
        ]}
      />

      {localPrintEnv !== 'ok' && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm leading-relaxed ${
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
