import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { FilterCard } from '@/components/shared/FilterCard'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { usePurchaseList, useConfirmPurchase, useCancelPurchase, usePurchaseDetail } from '@/hooks/usePurchase'
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
    confirmText?: string
    onConfirm: () => void
  }>({ open: false, title: '', description: '', onConfirm: () => {} })

  const { data, isLoading } = usePurchaseList({ page, pageSize: 20, keyword, status: statusFilter || undefined })
  const confirm = useConfirmPurchase()
  const cancel = useCancelPurchase()
  const { data: printDetail } = usePurchaseDetail(printId || 0)

  function openConfirm(
    title: string,
    description: string,
    onConfirm: () => void,
    options?: { confirmText?: string },
  ) {
    setConfirmState({ open: true, title, description, onConfirm, confirmText: options?.confirmText })
  }
  function closeConfirm() {
    setConfirmState(s => ({ ...s, open: false }))
  }

  const selectedList = data?.list.filter(r => selectedIds.has(r.id)) || []

  const batchConfirm = async () => {
    if (!selectedList.length) return
    const canConfirm = selectedList.filter(r => r.status === 1)
    if (!canConfirm.length) { toast.warning('所选单据中没有可提交的草稿'); return }
    openConfirm(
      '批量提交采购单',
      `确认批量提交 ${canConfirm.length} 笔采购单？`,
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
    { key: 'orderNo', title: '采购单号', width: 160, render: v => <span className="text-doc-code">{String(v)}</span> },
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
                提交
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
        title="采购订单"
        description="采购单仅管理计划与提交；实际到货请在收货订单中按供应商创建本次收货单"
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
        <Select value={statusFilter || '__all__'} onValueChange={v => { setStatusFilter(v === '__all__' ? '' : v); setPage(1) }}>
          <SelectTrigger className="h-9 w-36">
            <SelectValue placeholder="全部状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">全部状态</SelectItem>
            <SelectItem value="1">草稿</SelectItem>
            <SelectItem value="2">已提交</SelectItem>
            <SelectItem value="4">已取消</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={() => { setKeyword(search); setPage(1) }}>搜索</Button>
        {keyword && <Button size="sm" variant="ghost" onClick={() => { setSearch(''); setKeyword(''); setPage(1) }}>重置</Button>}
      </FilterCard>

      {/* 批量操作区 */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-2.5">
          <span className="text-sm font-medium text-foreground">已选 {selectedIds.size} 条</span>
          <div className="h-4 w-px bg-border" />
          <Button size="sm" variant="outline" onClick={batchConfirm} disabled={batchLoading}>
            {batchLoading ? '处理中...' : '批量提交'}
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
        confirmText={
          confirmState.confirmText
            ?? (confirmState.title.includes('取消') ? '确认取消' : '确认')
        }
        loading={false}
        onConfirm={confirmState.onConfirm}
        onCancel={closeConfirm}
      />
    </div>
  )
}
