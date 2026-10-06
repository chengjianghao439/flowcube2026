import { useEffect, useState } from 'react'
import { usePermission } from '@/hooks/usePermission'
import { approvalSource, approvalNavigationPath, pendingApprovalRowKey, pendingApprovalProgress, pendingApprovalTime, pendingApprovalAmountLabel, pendingApprovalAmount } from '@/lib/approvalBusiness'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { useNavigate } from 'react-router-dom'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import ListSummary from '@/components/shared/ListSummary'
import { Button } from '@/components/ui/button'
import { usePendingApprovals } from '@/hooks/useApprovals'
import { formatDisplayDateTime } from '@/lib/dateTime'
import type { PendingApproval } from '@/types/approval'
import type { TableColumn } from '@/types'

export default function ApprovalPendingPage() {
  const navigate = useNavigate()
  const { can } = usePermission()
  const [page, setPage] = useState(1)
  const pageSize = 20
  const { data, isLoading, isFetching, isError, error, refetch } = usePendingApprovals(page, pageSize)

  const list = (data?.list ?? []).map(row => ({ ...row, entryKey: pendingApprovalRowKey(row) }))
  const total = data?.pagination.total ?? 0
  const lastPage = Math.max(1, Math.ceil(total / pageSize))
  useEffect(() => {
    if (data && !isFetching && !isError && page > lastPage) setPage(lastPage)
  }, [data, isFetching, isError, page, lastPage])
  function openSource(row: PendingApproval) {
    const source = approvalSource(row.bizType, row.bizId, can)
    if (!isFetching && !isError && source.path) navigate(approvalNavigationPath(source.path, useWorkspaceStore.getState().tabs))
  }

  const columns: TableColumn<PendingApproval>[] = [
    {
      key: 'bizType',
      title: '单据类型',
      width: 130,
      render: (_, row) => approvalSource(row.bizType, row.bizId, can).label,
    },
    {
      key: 'no',
      title: '单据号',
      width: 180,
      render: (_, row) => (
        <button
          className="text-primary hover:underline"
          disabled={isFetching || isError || !approvalSource(row.bizType, row.bizId, can).path}
          title={approvalSource(row.bizType, row.bizId, can).reason || undefined}
          onClick={() => openSource(row)}
        >
          {row.no || `#${row.bizId}`}
        </button>
      ),
    },
    { key: 'title', title: '事由', render: (v) => (v ? String(v) : '—') },
    {
      key: 'applicantName',
      title: '申请/制单人',
      width: 100,
    },
    {
      key: 'amount',
      title: '金额',
      width: 120,
      render: (_v, row) => <div>{pendingApprovalAmount(row)}<p className="text-xs text-muted-foreground">{pendingApprovalAmountLabel(row)}</p></div>,
    },    {
      key: 'currentStep',
      title: '审批进度',
      width: 110,
      render: (_, row) => pendingApprovalProgress(row),
    },
    {
      key: 'createdAt',
      title: '时间',
      width: 160,
      render: (_, row) => { const time = pendingApprovalTime(row); return <div>{time.label}<p>{time.value ? formatDisplayDateTime(time.value) : '未记录'}</p></div> },
    },
    {
      key: 'id',
      title: '操作',
      width: 110,
      render: (_, row) => (
        <div className="space-y-1"><Button size="sm" variant="outline" disabled={isFetching || isError || !approvalSource(row.bizType, row.bizId, can).path}
          title={approvalSource(row.bizType, row.bizId, can).reason || undefined}
          onClick={() => openSource(row)}>
          去审批
        </Button>
        {approvalSource(row.bizType, row.bizId, can).reason && <p className="text-xs text-muted-foreground">{approvalSource(row.bizType, row.bizId, can).reason}</p>}
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="待我审批"
        description="你可处理的审批节点与业务单级审核，点击单据号进入原单"
      />
      {isError && <QueryErrorState error={error} onRetry={() => void refetch()} title="审批待办读取失败" compact />}
      <DataTable
        columns={columns}
        data={isError ? [] : list}
        loading={isLoading || isFetching}
        rowKey="entryKey"
        emptyText={list.length === 0 && !isLoading ? '没有待你审批的单据' : undefined}
      />
      <div className="flex items-center justify-between gap-3">
        <ListSummary total={total} />
        <nav aria-label="审批待办分页" className="flex items-center gap-3 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1 || isFetching} onClick={() => setPage(p => p - 1)}>上一页</Button>
          <span>第 {page} / {lastPage} 页</span>
          <Button variant="outline" size="sm" disabled={page >= lastPage || isFetching || isError} onClick={() => setPage(p => p + 1)}>下一页</Button>
        </nav>
      </div>
    </div>
  )
}
