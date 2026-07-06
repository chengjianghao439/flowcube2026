import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { FilterCard } from '@/components/shared/FilterCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import TableActionsMenu from '@/components/shared/TableActionsMenu'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { getTransferListApi, confirmTransferApi, cancelTransferApi } from '@/api/transfer'
import { downloadExport } from '@/lib/exportDownload'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { toast } from '@/lib/toast'
import { useWorkspaceStore } from '@/store/workspaceStore'
import type { TransferOrder } from '@/api/transfer'
import type { TableColumn } from '@/types'

export default function TransferPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { addTab } = useWorkspaceStore()
  const [keyword, setKeyword] = useState(''); const [search, setSearch] = useState('')
  const [confirmState, setConfirmState] = useState<{ open: boolean; title: string; description: string; onConfirm: () => void }>({ open: false, title: '', description: '', onConfirm: () => {} })
  const openConfirm = (title: string, description: string, onConfirm: () => void) => setConfirmState({ open: true, title, description, onConfirm })
  const closeConfirm = () => setConfirmState(s => ({ ...s, open: false }))
  const [pendingId, setPendingId] = useState<number | null>(null)

  const { data, isLoading } = useQuery({ queryKey: ['transfer', { keyword }], queryFn: () => getTransferListApi({ pageSize: 99999, keyword }).then(r => r!) })

  const mut = (fn: () => Promise<unknown>, id?: number) => {
    if (id) setPendingId(id)
    fn()
      .then(() => qc.invalidateQueries({ queryKey: ['transfer'] }))
      .finally(() => { if (id) setPendingId(null) })
  }

  function goToNew() {
    addTab({ key: '/transfer/new', title: '新建调拨单', path: '/transfer/new' })
    navigate('/transfer/new')
  }
  function goToDetail(order: TransferOrder) {
    const key = `/transfer/${order.id}`
    addTab({ key, title: order.orderNo, path: key })
    navigate(key)
  }

  const columns: TableColumn<TransferOrder>[] = [
    { key: 'orderNo', title: '调拨单号', width: 170, render: (v) => <span className="text-doc-code">{String(v)}</span> },
    { key: 'fromWarehouseName', title: '源仓库', width: 130 },
    { key: 'toWarehouseName', title: '目标仓库', width: 130 },
    { key: 'status', title: '状态', width: 90, render: (v, row) => {
      const status = v as number
      const tone = status === 4 ? 'success' : status === 5 ? 'danger' : status === 1 ? 'draft' : 'active'
      return <SoftStatusLabel label={(row as TransferOrder).statusName} tone={tone} />
    } },
    { key: 'operatorName', title: '经办人', width: 90 },
    { key: 'createdAt', title: '创建时间', width: 160, render: (v) => formatDisplayDateTime(v) },
    { key: 'id', title: '操作', width: 120, render: (_, row) => {
      const r = row as TransferOrder
      return (
        <TableActionsMenu
          primaryLabel="详情"
          primaryVariant="outline"
          onPrimaryClick={() => goToDetail(r)}
          items={[
            ...(r.status === 1 ? [{
              label: pendingId === r.id ? '处理中...' : '确认派发',
              onClick: () => mut(() => confirmTransferApi(r.id), r.id),
              disabled: pendingId === r.id,
            }] : []),
            ...((r.status === 1 || r.status === 2) ? [{
              label: pendingId === r.id ? '处理中...' : '取消',
              onClick: () => openConfirm('取消调拨', '确认取消此调拨单？', () => mut(() => cancelTransferApi(r.id), r.id)),
              disabled: pendingId === r.id,
              destructive: true,
              separatorBefore: true,
            }] : []),
          ]}
        />
      )
    } },
  ]

  return (
    <div className="space-y-4">
      <PageHeader title="库存调拨" description="在仓库之间调拨商品，自动同步两端库存" actions={
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => downloadExport('/export/transfer').catch(e => toast.error((e as Error).message))}>导出 Excel</Button>
          <Button onClick={goToNew}>+ 新建调拨单</Button>
        </div>
      } />
      <FilterCard>
        <Input placeholder="搜索单号/仓库..." value={search} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)} className="h-9 w-56" onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') { setKeyword(search) } }} />
        <Button size="sm" variant="outline" onClick={() => { setKeyword(search) }}>搜索</Button>
        {keyword && <Button size="sm" variant="ghost" onClick={() => { setSearch(''); setKeyword('') }}>重置</Button>}
      </FilterCard>
      <DataTable columns={columns} data={data?.list || []} loading={isLoading} onRowDoubleClick={goToDetail} />

      <ConfirmDialog
        open={confirmState.open}
        title={confirmState.title}
        description={confirmState.description}
        variant={confirmState.title.includes('取消') ? 'destructive' : 'default'}
        confirmText={confirmState.title.includes('取消') ? '确认取消' : '确认'}
        onConfirm={() => { closeConfirm(); confirmState.onConfirm() }}
        onCancel={closeConfirm}
      />
    </div>
  )
}
