/**
 * 收货订单列表（采购入库 / inbound_tasks）
 * 路由：/inbound-tasks
 */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import PageHeader from '@/components/shared/PageHeader'
import { FilterCard } from '@/components/shared/FilterCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import TableActionsMenu from '@/components/shared/TableActionsMenu'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { getInboundTasksApi } from '@/api/inbound-tasks'
import {
  INBOUND_STATUS_LABEL,
  type InboundTask,
  type InboundTaskStatus,
  type InboundPurchaseCandidate,
} from '@/types/inbound-tasks'
import DataTable from '@/components/shared/DataTable'
import type { TableColumn } from '@/types'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { ProductFinder } from '@/components/finder'
import { useSubmitInboundTask } from '@/hooks/useInboundTasks'
import { toast } from '@/lib/toast'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { downloadExport } from '@/lib/exportDownload'
import type { ProductFinderResult } from '@/types/products'
import { getInboundClosureCopy } from '@/lib/inboundClosure'

export default function InboundTasksPage() {
  const navigate = useNavigate()
  const addTab = useWorkspaceStore(s => s.addTab)
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [product, setProduct] = useState<ProductFinderResult | null>(null)
  const [productFinderOpen, setProductFinderOpen] = useState(false)
  const [page, setPage] = useState(1)
  const submitMut = useSubmitInboundTask()

  const { data, isLoading } = useQuery({
    queryKey: ['inbound-tasks', keyword, statusFilter, product?.id ?? null, page],
    queryFn: () => getInboundTasksApi({ keyword, status: statusFilter ? +statusFilter : undefined, productId: product?.id, page, pageSize: 20 })
      .then(r => r.data.data),
  })

  function openDetail(row: InboundTask) {
    const path = `/inbound-tasks/${row.id}`
    addTab({ key: path, title: row.taskNo, path })
    navigate(path)
  }

  const columns: TableColumn<InboundTask>[] = [
    {
      key: 'taskNo',
      title: '任务单号',
      width: 160,
      render: v => <span className="text-doc-code">{v as string}</span>,
    },
    {
      key: 'purchaseOrderNo',
      title: '关联采购',
      width: 160,
      render: v => v ? <span className="text-doc-code">{v as string}</span> : <span className="text-muted-foreground">混合采购</span>,
    },
    {
      key: 'supplierName',
      title: '供应商',
      render: v => v ?? <span className="text-muted-foreground">—</span>,
    },
    {
      key: 'warehouseName',
      title: '仓库',
      render: v => v ?? <span className="text-muted-foreground">—</span>,
    },
    {
      key: 'status',
      title: '状态',
      width: 220,
      render: (_, row) => {
        const task = row as InboundTask
        const closureCopy = getInboundClosureCopy(task)
        const tone = task.receiptStatus?.key === 'audited'
          ? 'success'
          : task.receiptStatus?.key === 'exception'
            ? 'danger'
            : task.receiptStatus?.key === 'draft'
              ? 'draft'
              : 'active'
        return (
          <div className="space-y-1">
            <SoftStatusLabel label={task.receiptStatus?.label ?? INBOUND_STATUS_LABEL[task.status]} tone={tone} />
            <p className="text-xs text-muted-foreground">{closureCopy.nextAction}</p>
          </div>
        )
      },
    },
    {
      key: 'operatorName',
      title: '操作人',
      render: v => v ?? <span className="text-muted-foreground">—</span>,
    },
    {
      key: 'createdAt',
      title: '创建时间',
      width: 160,
      render: v => formatDisplayDateTime(v),
    },
    {
      key: 'id',
      title: '操作',
      width: 140,
      render: (_, row) => {
        const task = row as InboundTask
        const items = []
        if (task.receiptStatus?.key === 'draft') {
          items.push({
            label: '提交到 PDA',
            onClick: () => {
              submitMut.mutate(task.id, {
                onSuccess: () => toast.success('已提交到 PDA'),
                onError: (error: unknown) => toast.error((error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '提交失败'),
              })
            },
          })
        }
        if (task.auditFlowStatus?.key === 'pending' || task.auditFlowStatus?.key === 'rejected') {
          items.push(
            {
              label: task.auditFlowStatus?.key === 'rejected' ? '打开详情处理退回' : '打开详情处理审核',
              onClick: () => {
                const path = `/inbound-tasks/${task.id}`
                addTab({ key: path, title: task.taskNo, path })
                navigate(`${path}?focus=audit-follow-up`)
              },
            },
          )
        }
        items.push({
          label: '查看打印 / 补打',
          onClick: () => {
            const path = `/settings/barcode-print-query?category=inbound&inboundTaskId=${task.id}`
            addTab({ key: path, title: `补打 ${task.taskNo}`, path })
            navigate(path)
          },
        })
        return (
          <TableActionsMenu
            primaryLabel="详情"
            onPrimaryClick={() => openDetail(task)}
            items={items}
          />
        )
      },
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="收货订单"
        description="按供应商一次到货建单；收货生成容器，PDA 打印条码并上架后计入库存"
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => downloadExport('/export/inbound-tasks', {
                ...(statusFilter ? { status: statusFilter } : {}),
                ...(product?.id ? { productId: String(product.id) } : {}),
              }).catch(e => toast.error((e as Error).message))}
            >
              导出 Excel
            </Button>
            <Button
              onClick={() => {
                const path = '/inbound-tasks/new'
                addTab({ key: path, title: '新建收货订单', path })
                navigate(path)
              }}
            >
              + 新建收货订单
            </Button>
          </>
        }
      />

      <FilterCard>
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-[180px] flex-1">
            <Input
              className="h-9"
              placeholder="任务单号 / 采购单号 / 供应商"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { setKeyword(search); setPage(1) } }}
            />
          </div>
          <Select value={statusFilter || '__all__'} onValueChange={v => { setStatusFilter(v === '__all__' ? '' : v); setPage(1) }}>
            <SelectTrigger className="h-9 w-36"><SelectValue placeholder="全部状态" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">全部</SelectItem>
              {([1, 2, 3, 4, 5] as InboundTaskStatus[]).map(s => (
                <SelectItem key={s} value={String(s)}>{INBOUND_STATUS_LABEL[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" className="h-9 min-w-[180px] justify-start font-normal" onClick={() => setProductFinderOpen(true)}>
            {product ? `${product.name} (${product.code})` : '按产品筛选'}
          </Button>
          <Button variant="outline" onClick={() => { setKeyword(search); setPage(1) }}>搜索</Button>
          <Button variant="ghost" onClick={() => { setSearch(''); setKeyword(''); setStatusFilter(''); setProduct(null); setPage(1) }}>重置</Button>
        </div>
      </FilterCard>

      <DataTable
        columns={columns}
        data={data?.list ?? []}
        loading={isLoading}
        rowKey="id"
      />
      <ProductFinder
        open={productFinderOpen}
        onClose={() => setProductFinderOpen(false)}
        onConfirm={(selected) => {
          setProduct(selected)
          setPage(1)
        }}
      />
    </div>
  )
}
