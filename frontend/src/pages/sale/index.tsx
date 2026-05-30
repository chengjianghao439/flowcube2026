import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { downloadExport } from '@/lib/exportDownload'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { SaleFilters } from './components/SaleFilters'
import { SaleRowActions } from './components/SaleRowActions'
import { useSaleList, useReserveSale, useReleaseSale, useShipSale, useCancelSale, useDeleteSale } from '@/hooks/useSale'
import { getSaleDetailApi } from '@/api/sale'
import { PrintPreviewOverlay } from '@/components/print/SaleOrderPrintTemplate'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { toast } from '@/lib/toast'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { ProductFinder } from '@/components/finder'
import { readStringParam, upsertSearchParams } from '@/lib/urlSearchParams'
import { getSaleWorkflowStatus } from '@/lib/saleWorkflowStatus'
import type { SaleOrder } from '@/types/sale'
import type { ProductFinderResult } from '@/types/products'
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
  const [searchParams, setSearchParams] = useSearchParams()
  const keyword = readStringParam(searchParams, 'keyword')
  const statusFilter = readStringParam(searchParams, 'status')
  const productId = Number(searchParams.get('productId') || '')
  const productCode = readStringParam(searchParams, 'productCode')
  const productName = readStringParam(searchParams, 'productName')
  const product = useMemo<ProductFinderResult | null>(() => {
    if (!Number.isInteger(productId) || productId <= 0) return null
    return {
      id: productId,
      code: productCode,
      name: productName,
      categoryId: null,
      categoryName: null,
      categoryPath: null,
      unit: '',
      spec: null,
      salePrice: null,
      costPrice: null,
      stock: 0,
    }
  }, [productCode, productId, productName])
  const [search, setSearch] = useState(keyword)
  const [productFinderOpen, setProductFinderOpen] = useState(false)
  const [confirmState, setConfirmState] = useState<ConfirmState>(EMPTY_CONFIRM)
  const [printOrder,   setPrintOrder]   = useState<SaleOrder | null>(null)

  const { data, isLoading } = useSaleList({ pageSize: 99999, keyword, status: statusFilter || undefined, productId: product?.id || undefined })
  const reserveMutate = useReserveSale()
  const releaseMutate = useReleaseSale()
  const ship          = useShipSale()
  const cancel        = useCancelSale()
  const deleteMutate  = useDeleteSale()
  const navigate  = useNavigate()
  const { addTab } = useWorkspaceStore()

  useEffect(() => {
    setSearch(keyword)
  }, [keyword])

  function updateParams(updates: Record<string, string | number | null | undefined>) {
    setSearchParams(upsertSearchParams(searchParams, updates))
  }

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
      setPrintOrder(res)
    } catch {
      toast.error('获取订单详情失败，无法打印')
    }
  }

  // ── 筛选操作 ──
  function handleSearch() { updateParams({ keyword: search }) }
  function handleReset()  {
    setSearch('')
    updateParams({ keyword: null, status: null, productId: null, productCode: null, productName: null })
  }
  function handleStatusChange(v: string) { updateParams({ status: v }) }

  // ── 列定义 ───────────────────────────────────────────────────────────────
  const columns: TableColumn<SaleOrder>[] = [
    { key: 'orderNo',      title: '销售单号', width: 160, render: v => <span className="text-sm font-medium text-primary">{String(v)}</span> },
    { key: 'customerName', title: '客户' },
    { key: 'warehouseName',title: '仓库',     width: 120 },
    {
      key: 'totalAmount', title: '金额', width: 110,
      render: v => <span className="font-medium">¥{Number(v).toFixed(2)}</span>,
    },
    { key: 'remark', title: '备注', width: 120, render: v => (v as string) || '-' },
    {
      key: 'status', title: '状态', width: 90,
      render: (v, row) => {
        const r = row as SaleOrder
        const ws = getSaleWorkflowStatus(r)
        const hasTask = r.taskNo && r.taskId
        return (
          <Badge
            variant="outline"
            className={`text-xs font-medium ${ws.className} ${hasTask ? 'cursor-pointer hover:opacity-80' : ''}`}
            onClick={() => hasTask && navigate(`/sale/${r.id}`)}
          >
            {ws.label}
          </Badge>
        )
      },
    },
    { key: 'operatorName', title: '经办人',   width: 90 },
    { key: 'createdAt',    title: '创建时间', width: 152, render: v => formatDisplayDateTime(v) },
    {
      key: 'id', title: '操作', width: 120,
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
            onViewTask={() => goToDetail(r)}
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
                downloadExport('/export/sale', {
                  ...(statusFilter ? { status: statusFilter } : {}),
                  ...(product?.id ? { productId: String(product.id) } : {}),
                }).catch(e => toast.error((e as Error).message))
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
        productName={product ? `${product.name} (${product.code})` : ''}
        onPickProduct={() => setProductFinderOpen(true)}
      />

      {/* 数据表格 */}
      <DataTable
        columns={columns}
        data={data?.list ?? []}
        loading={isLoading}
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

      <ProductFinder
        open={productFinderOpen}
        onClose={() => setProductFinderOpen(false)}
        onConfirm={(selected) => {
          updateParams({
            productId: selected.id,
            productCode: selected.code,
            productName: selected.name,
          })
          setProductFinderOpen(false)
        }}
      />
    </div>
  )
}
