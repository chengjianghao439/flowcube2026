/**
 * 收货订单列表（采购入库 / inbound_tasks）
 * 路由：/inbound-tasks
 */
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import TableActionsMenu from '@/components/shared/TableActionsMenu'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { getInboundTasksApi } from '@/api/inbound-tasks'
import {
  INBOUND_STATUS_LABEL,
  type InboundTask,
} from '@/types/inbound-tasks'
import DataTable from '@/components/shared/DataTable'
import type { TableColumn } from '@/types'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { useSubmitInboundTask } from '@/hooks/useInboundTasks'
import { toast } from '@/lib/toast'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { downloadExport } from '@/lib/exportDownload'
import { readStringParam, upsertSearchParams } from '@/lib/urlSearchParams'
import InboundTaskQueryDialog, { type InboundTaskQueryValues } from './InboundTaskQueryDialog'

const STATUS_LABELS: Record<string, string> = INBOUND_STATUS_LABEL as unknown as Record<string, string>

/** 首次打开收货订单页时默认筛选的天数窗口（最近一周） */
const DEFAULT_RANGE_DAYS = 7
function toYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export default function InboundTasksPage() {
  const navigate = useNavigate()
  const addTab = useWorkspaceStore(s => s.addTab)
  const [searchParams, setSearchParams] = useSearchParams()
  const [queryOpen, setQueryOpen] = useState(false)
  const submitMut = useSubmitInboundTask()

  // ── 当前生效的筛选（全部存于 URL 参数，刷新/分享可保留） ──
  const keyword       = readStringParam(searchParams, 'keyword')
  const remark        = readStringParam(searchParams, 'remark')
  const operatorId    = Number(searchParams.get('operatorId') || '') || null
  const operatorName  = readStringParam(searchParams, 'operatorName')
  const statusFilter  = readStringParam(searchParams, 'status')
  const productId     = Number(searchParams.get('productId') || '') || null
  const productCode   = readStringParam(searchParams, 'productCode')
  const productName   = readStringParam(searchParams, 'productName')
  const warehouseId   = Number(searchParams.get('warehouseId') || '') || null
  const warehouseName = readStringParam(searchParams, 'warehouseName')
  const startDate     = readStringParam(searchParams, 'startDate')
  const endDate       = readStringParam(searchParams, 'endDate')

  const { data, isLoading } = useQuery({
    queryKey: ['inbound-tasks', { keyword, remark, operatorId, statusFilter, productId, warehouseId, startDate, endDate }],
    queryFn: () => getInboundTasksApi({
      pageSize: 99999,
      keyword,
      remark: remark || undefined,
      operatorId: operatorId || undefined,
      status: statusFilter ? +statusFilter : undefined,
      productId: productId || undefined,
      warehouseId: warehouseId || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    }),
  })

  function updateParams(updates: Record<string, string | number | null | undefined>) {
    setSearchParams(upsertSearchParams(searchParams, updates))
  }

  // 首次打开：无日期筛选时默认套用最近一周
  useEffect(() => {
    if (!startDate && !endDate) {
      const end = new Date()
      const start = new Date()
      start.setDate(start.getDate() - DEFAULT_RANGE_DAYS)
      setSearchParams(upsertSearchParams(searchParams, { startDate: toYmd(start), endDate: toYmd(end) }), { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function openDetail(row: InboundTask) {
    const path = `/inbound-tasks/${row.id}`
    addTab({ key: path, title: row.taskNo, path })
    navigate(path)
  }

  // 导出参数（与列表当前筛选保持一致）
  const exportParams = {
    ...(keyword ? { keyword } : {}),
    ...(remark ? { remark } : {}),
    ...(operatorId ? { operatorId: String(operatorId) } : {}),
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(productId ? { productId: String(productId) } : {}),
    ...(warehouseId ? { warehouseId: String(warehouseId) } : {}),
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
  }

  // 查询弹窗初始值
  const initialQuery: InboundTaskQueryValues = {
    keyword, remark, operatorId, operatorName, status: statusFilter,
    productId, productCode, productName,
    warehouseId, warehouseName,
    startDate, endDate,
  }

  function applyQuery(v: InboundTaskQueryValues) {
    updateParams({
      keyword: v.keyword || null,
      remark: v.remark || null,
      operatorId: v.operatorId || null,
      operatorName: v.operatorName || null,
      status: v.status || null,
      productId: v.productId || null,
      productCode: v.productCode || null,
      productName: v.productName || null,
      warehouseId: v.warehouseId || null,
      warehouseName: v.warehouseName || null,
      startDate: v.startDate || null,
      endDate: v.endDate || null,
    })
    setQueryOpen(false)
  }

  function clearAll() {
    updateParams({
      keyword: null, remark: null, operatorId: null, operatorName: null, status: null,
      productId: null, productCode: null, productName: null,
      warehouseId: null, warehouseName: null,
      startDate: null, endDate: null,
    })
  }

  // 当前生效筛选摘要（可逐项移除）
  const chips = [
    keyword && { key: 'keyword', label: `单号/供应商：${keyword}`, onRemove: () => updateParams({ keyword: null }) },
    remark && { key: 'remark', label: `备注：${remark}`, onRemove: () => updateParams({ remark: null }) },
    operatorId && { key: 'operator', label: `操作人：${operatorName || operatorId}`, onRemove: () => updateParams({ operatorId: null, operatorName: null }) },
    statusFilter && { key: 'status', label: `状态：${STATUS_LABELS[statusFilter] ?? statusFilter}`, onRemove: () => updateParams({ status: null }) },
    warehouseId && { key: 'warehouse', label: `仓库：${warehouseName || warehouseId}`, onRemove: () => updateParams({ warehouseId: null, warehouseName: null }) },
    productId && { key: 'product', label: `产品：${productName || productId}`, onRemove: () => updateParams({ productId: null, productCode: null, productName: null }) },
  ].filter(Boolean) as { key: string; label: string; onRemove: () => void }[]

  const columns: TableColumn<InboundTask>[] = [
    {
      key: 'taskNo',
      title: '任务单号',
      width: 176,
      render: v => <span className="block truncate whitespace-nowrap text-doc-code" title={String(v)}>{v as string}</span>,
    },
    {
      key: 'purchaseOrderNo',
      title: '关联采购',
      width: 176,
      render: v => v
        ? <span className="block truncate whitespace-nowrap text-doc-code" title={String(v)}>{v as string}</span>
        : <span className="whitespace-nowrap text-muted-foreground">混合采购</span>,
    },
    {
      key: 'supplierName',
      title: '供应商',
      width: 240,
      render: v => {
        const text = String(v ?? '')
        return text
          ? <span className="block truncate whitespace-nowrap" title={text}>{text}</span>
          : <span className="whitespace-nowrap text-muted-foreground">—</span>
      },
    },
    {
      key: 'warehouseName',
      title: '仓库',
      width: 140,
      render: v => {
        const text = String(v ?? '')
        return text
          ? <span className="block truncate whitespace-nowrap" title={text}>{text}</span>
          : <span className="whitespace-nowrap text-muted-foreground">—</span>
      },
    },
    {
      key: 'status',
      title: '状态',
      width: 160,
      render: (_, row) => {
        const task = row as InboundTask
        const tone = task.receiptStatus?.key === 'audited'
          ? 'success'
          : task.receiptStatus?.key === 'exception'
            ? 'danger'
            : task.receiptStatus?.key === 'draft'
              ? 'draft'
              : 'active'
        return (
          <div className="min-w-0">
            <SoftStatusLabel label={task.receiptStatus?.label ?? INBOUND_STATUS_LABEL[task.status]} tone={tone} />
          </div>
        )
      },
    },
    {
      key: 'operatorName',
      title: '操作人',
      width: 120,
      render: v => {
        const text = String(v ?? '')
        return text
          ? <span className="block truncate whitespace-nowrap" title={text}>{text}</span>
          : <span className="whitespace-nowrap text-muted-foreground">—</span>
      },
    },
    {
      key: 'createdAt',
      title: '创建时间',
      width: 176,
      render: v => {
        const text = formatDisplayDateTime(v)
        return <span className="block whitespace-nowrap text-xs" title={text}>{text}</span>
      },
    },
    {
      key: 'id',
      title: '操作',
      width: 180,
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
          <div className="flex justify-end whitespace-nowrap">
            <TableActionsMenu
              primaryLabel="详情"
              onPrimaryClick={() => openDetail(task)}
              primaryVariant="outline"
              items={items}
            />
          </div>
        )
      },
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="收货订单"
        description="按供应商一次到货建单；收货生成容器，PDA 打印条码并上架后计入库存"
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => downloadExport('/export/inbound-tasks', exportParams).catch(e => toast.error((e as Error).message))}
            >
              导出 Excel
            </Button>
            <Button variant="outline" onClick={() => setQueryOpen(true)}>查询</Button>
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

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map(c => (
            <span key={c.key} className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
              {c.label}
              <button type="button" onClick={c.onRemove} className="text-muted-foreground/70 hover:text-foreground" aria-label={`移除筛选 ${c.label}`}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <Button size="sm" variant="ghost" onClick={clearAll}>清空</Button>
        </div>
      )}

      <DataTable
        columns={columns}
        data={data?.list ?? []}
        loading={isLoading}
        rowKey="id"
        columnStorageKey="inbound-tasks:v2"
      />

      <InboundTaskQueryDialog
        open={queryOpen}
        initial={initialQuery}
        onClose={() => setQueryOpen(false)}
        onApply={applyQuery}
      />
    </div>
  )
}
