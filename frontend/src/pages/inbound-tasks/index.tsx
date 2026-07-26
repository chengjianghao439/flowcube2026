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
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { getInboundTasksApi } from '@/api/inbound-tasks'
import {
  INBOUND_STATUS_LABEL,
  type InboundTask,
} from '@/types/inbound-tasks'
import DataTable from '@/components/shared/DataTable'
import type { TableColumn } from '@/types'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { useSubmitInboundTask, useCancelInbound, useVoidInboundReceipt, useCloseReceivingInbound } from '@/hooks/useInboundTasks'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
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
  const cancelMut = useCancelInbound()
  const voidReceiptMut = useVoidInboundReceipt()
  const closeReceivingMut = useCloseReceivingInbound()

  const [confirmState, setConfirmState] = useState<{
    open: boolean
    title: string
    description: string
    confirmText?: string
    variant?: 'default' | 'destructive'
    onConfirm: () => void
  }>({ open: false, title: '', description: '', onConfirm: () => {} })

  function openConfirm(
    title: string,
    description: string,
    onConfirm: () => void,
    options?: { confirmText?: string; variant?: 'default' | 'destructive' },
  ) {
    setConfirmState({ open: true, title, description, onConfirm, confirmText: options?.confirmText, variant: options?.variant })
  }
  function closeConfirm() {
    setConfirmState(s => ({ ...s, open: false }))
  }

  // ── 当前生效的筛选（全部存于 URL 参数，刷新/分享可保留） ──
  const keyword       = readStringParam(searchParams, 'keyword')
  const remark        = readStringParam(searchParams, 'remark')
  const operatorId    = Number(searchParams.get('operatorId') || '') || null
  const operatorName  = readStringParam(searchParams, 'operatorName')
  const statusFilter  = readStringParam(searchParams, 'status')
  const productId     = Number(searchParams.get('productId') || '') || null
  const productCode   = readStringParam(searchParams, 'productCode')
  const productName   = readStringParam(searchParams, 'productName')
  const supplierId    = Number(searchParams.get('supplierId') || '') || null
  const supplierName  = readStringParam(searchParams, 'supplierName')
  const warehouseId   = Number(searchParams.get('warehouseId') || '') || null
  const warehouseName = readStringParam(searchParams, 'warehouseName')
  const startDate     = readStringParam(searchParams, 'startDate')
  const endDate       = readStringParam(searchParams, 'endDate')

  const isActiveTab = useActiveWorkspaceTab()
  // 收货现场变化频繁，标签页常驻挂载时若不轮询容易停留在打开时的陈旧进度
  const { data, isLoading } = useQuery({
    queryKey: ['inbound-tasks', { keyword, remark, operatorId, statusFilter, productId, supplierId, warehouseId, startDate, endDate }],
    queryFn: () => getInboundTasksApi({
      pageSize: 99999,
      keyword,
      remark: remark || undefined,
      operatorId: operatorId || undefined,
      status: statusFilter ? +statusFilter : undefined,
      productId: productId || undefined,
      supplierId: supplierId || undefined,
      warehouseId: warehouseId || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    }),
    refetchInterval: isActiveTab ? 20_000 : false,
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
    ...(supplierId ? { supplierId: String(supplierId) } : {}),
    ...(warehouseId ? { warehouseId: String(warehouseId) } : {}),
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
  }

  // 查询弹窗初始值
  const initialQuery: InboundTaskQueryValues = {
    keyword, remark, operatorId, operatorName, status: statusFilter,
    productId, productCode, productName,
    supplierId, supplierName,
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
      supplierId: v.supplierId || null,
      supplierName: v.supplierName || null,
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
      supplierId: null, supplierName: null,
      warehouseId: null, warehouseName: null,
      startDate: null, endDate: null,
    })
  }

  // 当前生效筛选摘要（可逐项移除）
  const chips = [
    keyword && { key: 'keyword', label: `单号：${keyword}`, onRemove: () => updateParams({ keyword: null }) },
    supplierId && { key: 'supplier', label: `供应商：${supplierName || supplierId}`, onRemove: () => updateParams({ supplierId: null, supplierName: null }) },
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
      width: 11.47,
      render: v => <span className="block truncate whitespace-nowrap" title={String(v)}>{v as string}</span>,
    },
    {
      key: 'supplierName',
      title: '供应商',
      width: 13.23,
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
      width: 7.95,
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
      width: 7.53,
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
      width: 11.05,
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
      width: 13.37,
      render: v => {
        const text = formatDisplayDateTime(v)
        return <span className="block whitespace-nowrap" title={text}>{text}</span>
      },
    },
    {
      key: 'remark',
      title: '备注',
      width: 26.95,
      render: v => v
        ? <span className="line-clamp-1 text-muted-foreground" title={String(v)}>{v as string}</span>
        : <span className="text-muted-foreground/50">—</span>,
    },
    {
      key: 'id',
      title: '操作',
      width: 8.45,
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
        items.push({
          label: '查看打印 / 补打',
          onClick: () => {
            const path = `/settings/barcode-print-query?category=inbound&inboundTaskId=${task.id}`
            addTab({ key: path, title: `补打 ${task.taskNo}`, path })
            navigate(path)
          },
        })
        if (task.status === 2) {
          items.push({
            label: '结束收货',
            separatorBefore: true,
            onClick: () => openConfirm(
              '结束收货',
              '供应商短装、不再继续收货时使用：立即结束收货，剩余未收数量作罢，进入待上架，可正常上架已收到的部分。此操作不可撤回。',
              () => closeReceivingMut.mutate(task.id, {
                onSuccess: () => { toast.success('已结束收货，进入待上架'); closeConfirm() },
                onError: (error: unknown) => toast.error((error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '结束收货失败'),
              }),
              { confirmText: '确定结束收货' },
            ),
            disabled: closeReceivingMut.isPending,
          })
        }
        if (task.status === 2 || task.status === 3 || task.status === 4) {
          items.push({
            label: '撤回收货',
            destructive: true,
            separatorBefore: task.status !== 2,
            onClick: () => openConfirm(
              '撤回收货',
              '整单撤回后：已扫码的库存条码将全部作废、恢复为待收货状态，可重新扫码收货。'
              + (task.status === 4
                ? '该收货订单已完成并自动结算过应付，撤回后会一并反冲已入库的库存、冲销已生成的应付记录，若关联采购单因此已自动完成，也会退回"已提交"状态。'
                : '')
              + '若容器已被后续拣货、拆分或调拨等动作动过，将无法撤回，请改用库存盘点处理差异。此操作请谨慎确认。',
              () => voidReceiptMut.mutate(task.id, {
                onSuccess: () => { toast.success('已撤回收货，恢复为待收货'); closeConfirm() },
                onError: (error: unknown) => toast.error((error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '撤回失败'),
              }),
              { confirmText: '确定撤回', variant: 'destructive' },
            ),
            disabled: voidReceiptMut.isPending,
          })
        }
        if (task.status === 1) {
          items.push({
            label: '取消',
            destructive: true,
            separatorBefore: true,
            onClick: () => openConfirm(
              '取消收货订单',
              '确定取消该收货订单？取消后需重新创建收货订单才能继续收货。',
              () => cancelMut.mutate(task.id, {
                onSuccess: () => { toast.success('已取消'); closeConfirm() },
                onError: () => toast.error('取消失败'),
              }),
              { confirmText: '确定取消', variant: 'destructive' },
            ),
            disabled: cancelMut.isPending,
          })
        }
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
        fluid
        columnStorageKey="inbound-tasks:v5"
        onRowDoubleClick={openDetail}
      />

      <InboundTaskQueryDialog
        open={queryOpen}
        initial={initialQuery}
        onClose={() => setQueryOpen(false)}
        onApply={applyQuery}
      />

      <ConfirmDialog
        open={confirmState.open}
        title={confirmState.title}
        description={confirmState.description}
        variant={confirmState.variant ?? 'default'}
        confirmText={confirmState.confirmText ?? '确认'}
        loading={cancelMut.isPending || voidReceiptMut.isPending || closeReceivingMut.isPending}
        onConfirm={confirmState.onConfirm}
        onCancel={closeConfirm}
      />
    </div>
  )
}
