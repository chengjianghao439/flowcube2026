import { useNavigate } from 'react-router-dom'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import ListSummary from '@/components/shared/ListSummary'
import { Button } from '@/components/ui/button'
import { usePendingApprovals } from '@/hooks/useApprovals'
import { formatDisplayDateTime } from '@/lib/dateTime'
import type { PendingApproval } from '@/types/approval'
import type { TableColumn } from '@/types'

const BIZ_LABEL: Record<string, string> = {
  purchase_requisition: '采购申请单',
  expense_claim: '费用报销',
  purchase_order: '采购单',
  inventory_disposal: '滞销处理单',
}

export default function ApprovalPendingPage() {
  const navigate = useNavigate()
  const { data, isLoading } = usePendingApprovals(1)

  const list = data?.list ?? []
  const total = data?.pagination.total ?? 0

  const columns: TableColumn<PendingApproval>[] = [
    {
      key: 'bizType',
      title: '单据类型',
      width: 130,
      render: (v) => BIZ_LABEL[v as string] ?? v,
    },
    {
      key: 'no',
      title: '单据号',
      width: 180,
      render: (_, row) => (
        <button
          className="text-primary hover:underline"
          onClick={() => navigate(`/purchase-requisitions/${row.bizId}`)}
        >
          {row.no || `#${row.bizId}`}
        </button>
      ),
    },
    { key: 'title', title: '事由', render: (v) => (v ? String(v) : '—') },
    {
      key: 'applicantName',
      title: '申请人',
      width: 100,
    },
    {
      key: 'amount',
      title: '金额',
      width: 120,
      render: (v) => `¥${Number(v).toFixed(2)}`,
    },    {
      key: 'currentStep',
      title: '审批进度',
      width: 110,
      render: (_, row) => `第 ${row.currentStep} 级待审`,
    },
    {
      key: 'createdAt',
      title: '提交时间',
      width: 160,
      render: (v) => formatDisplayDateTime(v),
    },
    {
      key: 'id',
      title: '操作',
      width: 110,
      render: (_, row) => (
        <Button size="sm" variant="outline" onClick={() => navigate(`/purchase-requisitions/${row.bizId}`)}>
          去审批
        </Button>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="待我审批"
        description="当前流转到你这里的审批节点，点击单据号进入审批"
      />
      <DataTable
        columns={columns}
        data={list}
        loading={isLoading}
        rowKey="instanceId"
        emptyText={list.length === 0 && !isLoading ? '没有待你审批的单据' : undefined}
      />
      {total > 0 && (
        <ListSummary total={total} />
      )}
    </div>
  )
}
