import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { FilterCard } from '@/components/shared/FilterCard'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { usePurchaseList, useConfirmPurchase, useReceivePurchase, useCancelPurchase, usePurchaseDetail } from '@/hooks/usePurchase'
// PurchaseFormDialog 软移除：保留代码，不再渲染（改为独立页面 /purchase/new）
import PurchaseFormDialog from './components/PurchaseFormDialog'
import PrintOrderDialog from '@/components/shared/PrintOrderDialog'
import { downloadExport } from '@/lib/exportDownload'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { toast } from '@/lib/toast'
import type { PurchaseOrder } from '@/types/purchase'
import type { TableColumn } from '@/types'

export default function PurchasePage() {
  const navigate   = useNavigate()
  const { addTab } = useWorkspaceStore()

  function goToNew() {
    addTab({ key: '/purchase/new', title: '新建采购单', path: '/purchase/new' })
    navigate('/purchase/new')
  }

  function goToDetail(order: PurchaseOrder) {
    const key = `/purchase/${order.id}`
    addTab({ key, title: order.orderNo, path: key })
    navigate(key)
  }

  const [page, setPage] = useState(1)
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [printId, setPrintId]   = useState<number | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [batchLoading, setBatchLoading] = useState(false)

  const [confirmState, setConfirmState] = useState<{
    open: boolean
    title: string
    description: string
    onConfirm: () => void
  }>({ open: false, title: '', description: '', onConfirm: () => {} })

  const { data, isLoading } = usePurchaseList({ page, pageSize: 20, keyword, status: statusFilter || undefined })
  const confirm = useConfirmPurchase()
  const receive = useReceivePurchase()
  const cancel = useCancelPurchase()
  const { data: printDetail } = usePurchaseDetail(printId || 0)

  function openConfirm(title: string, description: string, onConfirm: () => void) {
    setConfirmState({ open: true, title, description, onConfirm })
  }
  function closeConfirm() {
    setConfirmState(s => ({ ...s, open: false }))
  }

  const selectedList = data?.list.filter(r => selectedIds.has(r.id)) || []

  const batchConfirm = async () => {
    if (!selectedList.length) return
    const canConfirm = selectedList.filter(r => r.status === 1)
    if (!canConfirm.length) { toast.warning('所选单据中没有可确认的草稿'); return }
    openConfirm(
      '批量确认采购单',
      `确认批量确认 ${canConfirm.length} 笔采购单？`,
      async () => {
        closeConfirm()
        setBatchLoading(true)
        for (const r of canConfirm) await confirm.mutateAsync(r.id).catch(() => {})
        setBatchLoading(false)
        setSelectedIds(new Set())
      }
    )
  }

  const batchCancel = async () => {
    if (!selectedList.length) return
    const canCancel = selectedList.filter(r => r.status === 1 || r.status === 2)
    if (!canCancel.length) { toast.warning('所选单据中没有可取消的'); return }
    openConfirm(
      '批量取消采购单',
      `确认批量取消 ${canCancel.length} 笔采购单？此操作不可恢复。`,
      async () => {
        closeConfirm()
        setBatchLoading(true)
        for (const r of canCancel) await cancel.mutateAsync(r.id).catch(() => {})
        setBatchLoading(false)
        setSelectedIds(new Set())
      }
    )
  }

  const columns: TableColumn<PurchaseOrder>[] = [
    { key: 'orderNo', title: '采购单号', width: 160 },
    { key: 'supplierName', title: '供应商' },
    { key: 'warehouseName', title: '仓库', width: 120 },
    { key: 'totalAmount', title: '金额', width: 100, render: (v) => `¥${Number(v).toFixed(2)}` },
    {
      key: 'status', title: '状态', width: 100,
      render: (v, row) => <StatusBadge type="purchase" status={v as number} aria-label={(row as PurchaseOrder).statusName} />
    },
    { key: 'operatorName', title: '经办人', width: 90 },
    { key: 'createdAt', title: '创建时间', width: 160, render: (v) => String(v).slice(0, 16) },
    {
      key: 'id', title: '操作', width: 240, render: (_, row) => {
        const r = row as PurchaseOrder
        return (
          <div className="flex gap-1 flex-wrap">
            <Button size="sm" variant="ghost" onClick={() => goToDetail(r)}>详情</Button>
            {r.status === 1 && (
              <Button size="sm" variant="outline" disabled={confirm.isPending}
                onClick={() => confirm.mutate(r.id)}>
                确认
              </Button>
            )}
            {r.status === 2 && (
              <Button size="sm" disabled={receive.isPending}
                onClick={() => openConfirm(
                  '确认收货入库',
                  '确认后将执行入库操作，库存数量将相应增加。',
                  () => { closeConfirm(); receive.mutate(r.id) }
                )}>
                收货入库
              </Button>
            )}
            {(r.status === 1 || r.status === 2) && (
              <Button size="sm" variant="destructive" disabled={cancel.isPending}
                onClick={() => openConfirm(
                  '取消采购单',
                  '取消后此采购单将无法恢复，请确认操作。',
                  () => { closeConfirm(); cancel.mutate(r.id) }
                )}>
                取消
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setPrintId(r.id)}>打印</Button>
          </div>
        )
      }
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="采购管理"
        description="采购单创建、确认与收货入库"
        actions={
          <>
            <Button variant="outline"
              onClick={() => downloadExport('/export/purchase', statusFilter ? { status: statusFilter } : {}).catch(e => toast.error((e as Error).message))}>
              导出 Excel
            </Button>
            <Button onClick={goToNew}>+ 新建采购单</Button>
          </>
        }
      />

      {/* 筛选区 */}
      <FilterCard>
        <Input
          placeholder="搜索单号/供应商..."
          value={search}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
          className="h-9 w-56"
          onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') { setKeyword(search); setPage(1) } }}
        />
        <select
          className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          value={statusFilter}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { setStatusFilter(e.target.value); setPage(1) }}
        >
          <option value="">全部状态</option>
          <option value="1">草稿</option>
          <option value="2">已确认</option>
          <option value="3">已收货</option>
          <option value="4">已取消</option>
        </select>
        <Button size="sm" variant="outline" onClick={() => { setKeyword(search); setPage(1) }}>搜索</Button>
        {keyword && <Button size="sm" variant="ghost" onClick={() => { setSearch(''); setKeyword(''); setPage(1) }}>重置</Button>}
      </FilterCard>

      {/* 批量操作区 */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-2.5">
          <span className="text-sm font-medium text-foreground">已选 {selectedIds.size} 条</span>
          <div className="h-4 w-px bg-border" />
          <Button size="sm" variant="outline" onClick={batchConfirm} disabled={batchLoading}>
            {batchLoading ? '处理中...' : '批量确认'}
          </Button>
          <Button size="sm" variant="destructive" onClick={batchCancel} disabled={batchLoading}>
            {batchLoading ? '处理中...' : '批量取消'}
          </Button>
          <button
            className="ml-auto text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setSelectedIds(new Set())}
          >
            清除选择
          </button>
        </div>
      )}

      <DataTable
        columns={columns}
        data={data?.list || []}
        loading={isLoading}
        pagination={data?.pagination}
        onPageChange={setPage}
        selectable
        selectedIds={selectedIds}
        onSelectChange={setSelectedIds}
        onRowDoubleClick={goToDetail}
      />

      {/* PurchaseFormDialog 已软移除，改为独立页面 /purchase/new；代码保留供回滚 */}
      {false && <PurchaseFormDialog open={false} onClose={() => {}} />}

      <PrintOrderDialog
        open={!!printId}
        onClose={() => setPrintId(null)}
        data={printDetail ? {
          orderNo: printDetail.orderNo,
          type: '采购单',
          status: printDetail.statusName,
          partyLabel: '供应商',
          partyName: printDetail.supplierName,
          warehouseName: printDetail.warehouseName,
          date: printDetail.expectedDate,
          totalAmount: printDetail.totalAmount,
          operatorName: printDetail.operatorName,
          createdAt: printDetail.createdAt,
          remark: printDetail.remark,
          items: (printDetail.items || []).map(i => ({
            productCode: i.productCode,
            productName: i.productName,
            unit: i.unit,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            amount: i.amount,
            remark: i.remark,
          })),
        } : null}
      />

      <ConfirmDialog
        open={confirmState.open}
        title={confirmState.title}
        description={confirmState.description}
        variant={confirmState.title.includes('取消') ? 'destructive' : 'default'}
        confirmText={confirmState.title.includes('取消') ? '确认取消' : '确认'}
        onConfirm={confirmState.onConfirm}
        onCancel={closeConfirm}
      />
    </div>
  )
}
