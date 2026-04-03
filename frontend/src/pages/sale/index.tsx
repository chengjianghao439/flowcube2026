import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { downloadExport } from '@/lib/exportDownload'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { SaleFilters } from './components/SaleFilters'
import { SaleRowActions } from './components/SaleRowActions'
import { useSaleList, useReserveSale, useReleaseSale, useShipSale, useCancelSale, useDeleteSale } from '@/hooks/useSale'
import { getSaleDetailApi } from '@/api/sale'
import { PrintPreviewOverlay } from '@/components/print/SaleOrderPrintTemplate'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { toast } from '@/lib/toast'
import { formatDisplayDateTime } from '@/lib/dateTime'
import type { SaleOrder } from '@/types/sale'
import type { TableColumn } from '@/types'

// ─── 二次确认 state 类型 ─────────────────────────────────────────────────────
interface ConfirmState {
  open: boolean
  title: string
  description: string
  onConfirm: () => void
}

const EMPTY_CONFIRM: ConfirmState = { open: false, title: '', description: '', onConfirm: () => {} }

// ─── 主页面 ───────────────────────────────────────────────────────────────────

export default function SalePage() {
  const [page,         setPage]         = useState(1)
  const [keyword,      setKeyword]      = useState('')
  const [search,       setSearch]       = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [selectedIds,  setSelectedIds]  = useState<Set<number>>(new Set())
  const [batchLoading, setBatchLoading] = useState(false)
  const [confirmState, setConfirmState] = useState<ConfirmState>(EMPTY_CONFIRM)
  const [printOrder,   setPrintOrder]   = useState<SaleOrder | null>(null)

  const { data, isLoading } = useSaleList({ page, pageSize: 20, keyword, status: statusFilter || undefined })
  const reserveMutate = useReserveSale()
  const releaseMutate = useReleaseSale()
  const ship          = useShipSale()
  const cancel        = useCancelSale()
  const deleteMutate  = useDeleteSale()
  const navigate  = useNavigate()
  const { addTab } = useWorkspaceStore()

  function goToNew() {
    addTab({ key: '/sale/new', title: '新建销售单', path: '/sale/new' })
    navigate('/sale/new')
  }

  function goToDetail(order: SaleOrder) {
    const key = `/sale/${order.id}`
    addTab({ key, title: order.orderNo, path: key })
    navigate(key)
  }

  function openConfirm(title: string, description: string, onConfirm: () => void) {
    setConfirmState({ open: true, title, description, onConfirm })
  }
  const closeConfirm = () => setConfirmState(s => ({ ...s, open: false }))

  async function handlePrint(id: number) {
    try {
      const res = await getSaleDetailApi(id)
      setPrintOrder(res.data.data)
    } catch {
      toast.error('获取订单详情失败，无法打印')
    }
  }

  // ── 筛选操作 ──
  function handleSearch() { setKeyword(search); setPage(1) }
  function handleReset()  { setSearch(''); setKeyword(''); setStatusFilter(''); setPage(1) }
  function handleStatusChange(v: string) { setStatusFilter(v); setPage(1) }

  // ── 批量操作 ──
  const selectedList = data?.list.filter(r => selectedIds.has(r.id)) ?? []

  async function batchReserve() {
    const can = selectedList.filter(r => r.status === 1)
    if (!can.length) { toast.warning('所选中没有草稿状态的销售单'); return }
    openConfirm('批量占用库存', `确认为 ${can.length} 笔销售单占用库存？可用库存将相应减少。`, async () => {
      closeConfirm()
      setBatchLoading(true)
      for (const r of can) await reserveMutate.mutateAsync(r.id).catch(() => {})
      setBatchLoading(false)
      setSelectedIds(new Set())
    })
  }

  async function batchCancel() {
    const can = selectedList.filter(r => r.status === 1 || r.status === 2 || r.status === 3)
    if (!can.length) { toast.warning('所选中没有可取消的销售单'); return }
    openConfirm('批量取消销售单', `确认批量取消 ${can.length} 笔销售单？已占库与拣货中的单据会同步释放或取消关联任务。`, async () => {
      closeConfirm()
      setBatchLoading(true)
      for (const r of can) await cancel.mutateAsync(r.id).catch(() => {})
      setBatchLoading(false)
      setSelectedIds(new Set())
    })
  }

  // ── 列定义 ───────────────────────────────────────────────────────────────
  const columns: TableColumn<SaleOrder>[] = [
    { key: 'orderNo',      title: '销售单号', width: 160, render: v => <span className="text-doc-code">{String(v)}</span> },
    { key: 'customerName', title: '客户' },
    { key: 'warehouseName',title: '仓库',     width: 120 },
    {
      key: 'totalAmount', title: '金额', width: 110,
      render: v => <span className="font-medium tabular-nums">¥{Number(v).toFixed(2)}</span>,
    },
    {
      key: 'status', title: '状态', width: 160,
      render: (v, row) => {
        const r = row as SaleOrder
        return (
          <div className="flex items-center gap-1.5">
            <StatusBadge type="sale" status={v as number} />
            {r.taskNo && (
              <button
                onClick={() => navigate('/warehouse-tasks')}
                className="rounded-full border border-primary/20 bg-primary/5 px-1.5 py-0.5 text-doc-code text-primary transition-colors hover:bg-primary/10"
              >
                {r.taskNo}
              </button>
            )}
          </div>
        )
      },
    },
    { key: 'operatorName', title: '经办人',   width: 90 },
    { key: 'createdAt',    title: '创建时间', width: 152, render: v => formatDisplayDateTime(v) },
    {
      key: 'id', title: '操作', width: 248,
      render: (_, row) => {
        const r = row as SaleOrder
        return (
          <SaleRowActions
            row={r}
            anyPending={reserveMutate.isPending || releaseMutate.isPending || ship.isPending || cancel.isPending || deleteMutate.isPending}
            onAsk={(title, desc, cb) => openConfirm(title, desc, () => { closeConfirm(); cb() })}
            onReserveSale={id => reserveMutate.mutate(id)}
            onReleaseSale={id => releaseMutate.mutate(id)}
            onShipSale={id => ship.mutate(id)}
            onCancelSale={id => cancel.mutate(id)}
            onDeleteSale={id => deleteMutate.mutate(id)}
            onViewTask={() => navigate('/warehouse-tasks')}
            onDetail={() => goToDetail(r)}
            onPrint={() => handlePrint(r.id)}
          />
        )
      },
    },
  ]

  // ── 渲染 ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* 页头 */}
      <PageHeader
        title="销售管理"
        description="销售单创建、确认与出库"
        actions={
          <>
            <Button
              variant="outline"
              onClick={() =>
                downloadExport('/export/sale', statusFilter ? { status: statusFilter } : {}).catch(e => toast.error((e as Error).message))
              }
            >
              导出 Excel
            </Button>
            <Button onClick={goToNew}>+ 新建销售单</Button>
          </>
        }
      />

      {/* 筛选区 */}
      <SaleFilters
        search={search}
        onSearchChange={setSearch}
        onSearch={handleSearch}
        onReset={handleReset}
        statusFilter={statusFilter}
        onStatusFilterChange={handleStatusChange}
      />

      {/* 批量操作栏（有选中时显示） */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-2.5">
          <span className="text-sm font-medium text-foreground">
            已选 <span className="text-primary">{selectedIds.size}</span> 条
          </span>
          <span className="h-4 w-px bg-border" />
          <Button size="sm" variant="outline" disabled={batchLoading} onClick={batchReserve}>
            {batchLoading ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />处理中...</> : '批量占库'}
          </Button>
          <Button size="sm" variant="destructive" disabled={batchLoading} onClick={batchCancel}>
            {batchLoading ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />处理中...</> : '批量取消'}
          </Button>
          <button
            className="ml-auto text-xs text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setSelectedIds(new Set())}
          >
            清除选择
          </button>
        </div>
      )}

      {/* 数据表格 */}
      <DataTable
        columns={columns}
        data={data?.list ?? []}
        loading={isLoading}
        pagination={data?.pagination}
        onPageChange={setPage}
        selectable
        selectedIds={selectedIds}
        onSelectChange={setSelectedIds}
        onRowDoubleClick={goToDetail}
      />

      {/* 二次确认弹窗 */}
      <ConfirmDialog
        open={confirmState.open}
        title={confirmState.title}
        description={confirmState.description}
        variant={confirmState.title.includes('取消') ? 'destructive' : 'default'}
        confirmText={confirmState.title.includes('取消') ? '确认取消' : '确认'}
        onConfirm={confirmState.onConfirm}
        onCancel={closeConfirm}
      />

      {/* 打印预览全屏遮罩 */}
      {printOrder && (
        <PrintPreviewOverlay order={printOrder} onClose={() => setPrintOrder(null)} />
      )}
    </div>
  )
}
