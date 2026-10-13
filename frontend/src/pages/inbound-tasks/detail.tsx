import { isInboundDraftEditable } from './inboundDraftEditable'
import { INBOUND_FREIGHT_LABEL } from './inboundFreight'
import { getInboundListWorkspacePath } from '@/lib/inboundListNavigation'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { blocksInboundRead, inboundReadTitle } from './readState'
import { InboundQuantitySummary } from './InboundQuantitySummary'
import { InboundInventoryHelp } from './InboundInventoryHelp'
import { areInboundQuantitiesZero, groupInboundQuantities } from './inboundQuantity'
import { inboundExceptionReason } from './inboundException'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { money, unitPrice } from '@/lib/format'
import { OrderDetailSections } from '@/components/shared/OrderDetailSections'
import { InboundProductIdentity } from './InboundProductIdentity'
/**
 * 收货订单详情 — 上架进度 / 打印
 * 收货和上架仅允许通过 PDA 完成；收货结束且实收全部上架后系统自动结算应付
 * 路由：/inbound-tasks/:id（多标签）
 */
import { useContext, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ActionBar } from '@/components/shared/ActionBar'
import { SectionCard } from '@/components/shared/SectionCard'
import { ArrowLeft, CircleDollarSign, PackageCheck, Printer, Send, Undo2, X, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { useWorkspaceTabTitle } from '@/hooks/useWorkspaceTabTitle'
import { toast } from '@/lib/toast'
import CloseReceivingDialog from './CloseReceivingDialog'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import {
  useInboundTaskDetail,
  useSubmitInboundTask,
  useCancelInbound,
  useVoidInboundReceipt,
} from '@/hooks/useInboundTasks'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import { OrderPrintOverlay } from '@/components/print/OrderPrintOverlay'
import { mapInboundTaskToPrint } from '@/lib/orderPrintData'
import { formatDisplayDateTime } from '@/lib/dateTime'
import DataTable from '@/components/shared/DataTable'
import type { TableColumn } from '@/types'
import type { InboundTaskItem } from '@/types/inbound-tasks'

type StatusTone = 'draft' | 'active' | 'success' | 'danger' | 'warning' | 'info'

const PUTAWAY_TONE: Record<string, StatusTone> = {
  completed: 'success', waiting: 'active', putting_away: 'active', cancelled: 'danger', not_started: 'draft',
}
const AUDIT_TONE: Record<string, StatusTone> = {
  approved: 'success', cancelled: 'danger', not_ready: 'draft',
}
const PRINT_TONE: Record<string, StatusTone> = {
  success: 'success', queued: 'active', printing: 'active', failed: 'danger', timeout: 'danger', cancelled: 'draft', not_started: 'draft',
}

/** 沿用销售摘要区的间距与图标，保留上架、结算和条码打印各自状态。 */
function StatusCard({ label, value, tone, detail, help, icon: Icon }: { label: string; value: string; tone: StatusTone; detail?: React.ReactNode; help?: React.ReactNode; icon: LucideIcon }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 px-4 py-2.5">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><Icon className="h-3.5 w-3.5" /></span>
      <div className="min-w-0 space-y-1 [overflow-wrap:anywhere]">
        <div className="flex items-center gap-1"><p className="text-helper">{label}</p>{help}</div>
        <SoftStatusLabel label={value} tone={tone} />
        {detail && <p className="text-helper">{detail}</p>}
      </div>
    </div>
  )
}

export default function InboundTaskDetailPage() {
  const tabPath = useContext(TabPathContext)
  const params = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const rawId = (tabPath || params.id || '').split('?')[0].split('/').filter(Boolean).pop() ?? ''
  const taskId = Number(rawId)
  const validId = Number.isFinite(taskId) && taskId > 0 ? taskId : null

  const isActiveTab = useActiveWorkspaceTab()
  // 收货现场变化频繁，标签页常驻挂载时若不轮询容易停留在打开时的陈旧进度
  const { data: task, isLoading, refetch: refetchTask, error } = useInboundTaskDetail(validId, { refetchInterval: isActiveTab ? 20_000 : false, visible: isActiveTab })
  useWorkspaceTabTitle(task?.taskNo)

  const { can } = usePermission()
  const submitMut = useSubmitInboundTask()
  const cancelMut = useCancelInbound()
  const voidReceiptMut = useVoidInboundReceipt()

  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false)
  const [voidConfirmOpen, setVoidConfirmOpen] = useState(false)
  const [closeReceivingConfirmOpen, setCloseReceivingConfirmOpen] = useState(false)
  const [printOpen, setPrintOpen] = useState(false)

  function closeTab() {
    const { removeTab } = useWorkspaceStore.getState()
    removeTab(tabPath || '/inbound-tasks')
    navigate(getInboundListWorkspacePath())
  }

  async function afterMutation() {
    await refetchTask()
  }

  const items = Array.isArray(task?.items) ? task.items : []
  const quantityGroups = groupInboundQuantities(items)
  const printSummary = task?.printSummary ?? null
  const putawaySummary = task?.putawaySummary ?? null
  const receiptStatus = task?.receiptStatus ?? null
  const putawayStatus = task?.putawayStatus ?? null
  const auditFlowStatus = task?.auditFlowStatus ?? null
  const printStatus = task?.printStatus ?? null

  const printDetail = printSummary
    ? [
        printSummary.timeout > 0 ? `${printSummary.timeout} 条超时待确认` : null,
        printSummary.failed > 0 ? `${printSummary.failed} 条失败` : null,
        printSummary.queued + printSummary.printing > 0 ? `${printSummary.queued + printSummary.printing} 条待打印` : null,
      ].filter(Boolean).join(' · ') || `${printSummary.success} / ${printSummary.total} 已成功`
    : null

  const canEdit = !error && isActiveTab && can(PERMISSIONS.INBOUND_ORDER_UPDATE) && isInboundDraftEditable(task)
  const canSubmit = !error && can(PERMISSIONS.INBOUND_ORDER_SUBMIT) && receiptStatus?.key === 'draft'
  const canCancel = !error && can(PERMISSIONS.INBOUND_ORDER_CANCEL) && task?.status === 1
  const canVoidReceipt = !error && can(PERMISSIONS.INBOUND_ORDER_CANCEL) && (task?.status === 2 || task?.status === 3 || task?.status === 4)
  const canCloseReceiving = !error && can(PERMISSIONS.INBOUND_ORDER_CANCEL) && task?.status === 2
  const statusTone = receiptStatus?.key === 'audited'
    ? 'success'
    : receiptStatus?.key === 'exception'
      ? 'danger'
      : receiptStatus?.key === 'draft'
        ? 'draft'
        : 'active'
  if (!validId) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-border bg-card p-5 text-muted-foreground">
          <p className="font-medium text-foreground">收货订单路径无效</p>
          <p className="mt-1">请从收货订单列表重新打开该详情页。</p>
        </div>
      </div>
    )
  }

  if (error && (!task || blocksInboundRead(error))) {
    return <div className="space-y-3"><QueryErrorState error={error} title={inboundReadTitle(error)} onRetry={() => { void refetchTask() }} /><Button variant="outline" onClick={closeTab}>返回收货列表</Button></div>
  }

  if (isLoading || !task) {
    return <p className="p-6 text-muted-body">加载中…</p>
  }

  return (
    <div className="flex flex-col gap-2.5">
      {error && <QueryErrorState compact error={error} title="刷新失败，当前显示上次读取的数据" onRetry={() => { void refetchTask() }} />}
      <ActionBar
        title={task.taskNo}
        subtitle={<SoftStatusLabel label={receiptStatus?.label ?? task.statusName} tone={statusTone} />}
        rightActions={
          <>
            {canEdit && <Button variant="outline" size="sm" onClick={() => {
              if (!isInboundDraftEditable(task) || !can(PERMISSIONS.INBOUND_ORDER_UPDATE)) return
              const path = `/inbound-tasks/${task.id}/edit`
              useWorkspaceStore.getState().addTab({ key: path, path, title: `编辑 ${task.taskNo}` }); navigate(path)
            }}>编辑</Button>}
            {canCancel && (
              <Button
                variant="outline"
                className="text-destructive-ink border-destructive/30 hover:bg-destructive/5"
                size="sm"
                disabled={cancelMut.isPending}
                onClick={() => setCancelConfirmOpen(true)}
              >
                <X className="mr-1 h-4 w-4" />取消任务
              </Button>
            )}
            {canVoidReceipt && (
              <Button
                variant="outline"
                className="text-destructive-ink border-destructive/30 hover:bg-destructive/5"
                size="sm"
                disabled={voidReceiptMut.isPending}
                onClick={() => setVoidConfirmOpen(true)}
              >
                <Undo2 className="mr-1 h-4 w-4" />撤回收货
              </Button>
            )}
            {canCloseReceiving && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCloseReceivingConfirmOpen(true)}
              >
                结束收货
              </Button>
            )}
            <Button variant="outline" size="sm" disabled={!!error} onClick={() => setPrintOpen(true)}><Printer className="mr-1 h-4 w-4" />打印</Button>
            <Button variant="outline" size="sm" onClick={closeTab}><ArrowLeft className="mr-1 h-4 w-4" />返回列表</Button>
            {canSubmit && (
              <Button
                size="sm"
                onClick={() => {
                  if (!validId) return
                  submitMut.mutate(validId, {
                    onSuccess: async () => {
                      toast.success('已提交到 PDA')
                      await afterMutation()
                    },
                    onError: (err: unknown) => {
                      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '提交失败'
                      toast.error(msg)
                    },
                  })
                }}
                disabled={submitMut.isPending}
              >
                <Send className="mr-1 h-4 w-4" />{submitMut.isPending ? '提交中…' : '提交到 PDA'}
              </Button>
            )}
          </>
        }
      />

      <section aria-label="收货摘要" className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="grid divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <StatusCard
          icon={PackageCheck}
          label="上架状态"
          help={<InboundInventoryHelp />}
          value={putawayStatus?.label ?? '—'}
          tone={PUTAWAY_TONE[putawayStatus?.key ?? ''] ?? 'draft'}
          detail={`待上架 ${putawaySummary?.waitingContainers ?? 0} 条库存条码 · 已上架 ${putawaySummary?.storedContainers ?? 0} 条库存条码`}
        />
        <StatusCard
          icon={CircleDollarSign}
          label="结算状态"
          value={auditFlowStatus?.label ?? '—'}
          tone={AUDIT_TONE[auditFlowStatus?.key ?? ''] ?? 'draft'}
          detail={task.auditedAt ? `${formatDisplayDateTime(task.auditedAt)} · ${task.auditedByName ?? '—'}` : undefined}
        />
        <StatusCard
          icon={Printer}
          label="条码打印"
          value={printStatus?.label ?? '—'}
          tone={PRINT_TONE[printStatus?.key ?? ''] ?? 'draft'}
          detail={printDetail}
        />
      </div>

      </section>

      {inboundExceptionReason(task.exceptionFlags) && <p className="text-sm text-warning-ink">{inboundExceptionReason(task.exceptionFlags)}；请核对对应状态。</p>}
      <OrderDetailSections type="inbound" id={task.id} compactTabs>
      <SectionCard title="基础信息" compact contentClassName="p-3">
        <div className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2 xl:grid-cols-3 [&>div]:min-w-0 [&>div]:[overflow-wrap:anywhere]">
          <div><span className="text-muted-foreground">供应商：</span>{task.supplierName ?? '—'}</div>
          <div><span className="text-muted-foreground">仓库：</span>{task.warehouseName ?? '—'}</div>
          <div><span className="text-muted-foreground">采购单：</span>{task.purchaseOrderId && can(PERMISSIONS.PURCHASE_ORDER_VIEW) ? <button className="text-primary underline underline-offset-2" onClick={() => { const path = `/purchase/${task.purchaseOrderId}`; useWorkspaceStore.getState().addTab({ key: path, path, title: task.purchaseOrderNo ?? '采购详情' }); navigate(path) }}>{task.purchaseOrderNo}</button> : <span>{task.purchaseOrderNo ?? '混合采购'}</span>}</div>
          <div><span className="text-muted-foreground">时间：</span>{formatDisplayDateTime(task.createdAt)}</div>
          <div><span className="text-muted-foreground">经办人：</span>{task.operatorName ?? '—'}</div>
          <div><span className="text-muted-foreground">运费方式：</span>{task.freightType != null ? INBOUND_FREIGHT_LABEL[task.freightType] ?? '—' : '—'}</div>
          <div><span className="text-muted-foreground">运费金额：</span>{task.freightAmount != null ? money(task.freightAmount) : '—'}</div>
          <div className="sm:col-span-2 xl:col-span-3"><span className="text-muted-foreground">备注：</span>{task.remark || '—'}</div>
        </div>
      </SectionCard>
      <SectionCard title="商品明细" compact noPadding>
        <div data-workspace-scroll tabIndex={0} aria-label="收货商品明细" className="max-h-[min(60vh,36rem)] overflow-auto [&>div]:rounded-none [&>div]:border-0 [&>div]:overflow-visible [&_[data-table-scroll]]:overflow-visible [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10">
        <DataTable
          columns={[
            { key: 'productName', title: '商品', width: 25, minWidth: 220, render: (_, item) => <InboundProductIdentity item={{ ...item, productCode: item.productCode ?? '' }} /> },
            { key: 'purchaseOrderNo', title: '采购来源', width: 15, minWidth: 145, render: (_, item) => item.purchaseOrderId && can(PERMISSIONS.PURCHASE_ORDER_VIEW) ? <button className="text-primary underline underline-offset-2 text-sm font-mono" onClick={() => { const path = `/purchase/${item.purchaseOrderId}`; useWorkspaceStore.getState().addTab({ key: path, path, title: item.purchaseOrderNo ?? '采购详情' }); navigate(path) }}>{item.purchaseOrderNo}</button> : item.purchaseOrderNo ?? '—' },
            { key: 'unit', title: '单位', width: 5, minWidth: 60, render: v => <span>{(v as string) || '—'}</span> },
            { key: 'orderedQty', title: '应到', width: 9, minWidth: 70, align: 'right', render: v => <span className="tabular-nums">{String(v)}</span> },
            {
              key: 'receivedQty', title: '已收', width: 9, minWidth: 70, align: 'right',
              render: (v, r) => (
                <span className={`tabular-nums ${(v as number) > r.orderedQty ? 'font-semibold text-destructive-ink' : ''}`}>{String(v)}</span>
              ),
            },
            {
              key: 'lineRemain', title: '剩余', width: 9, minWidth: 70, align: 'right',
              render: (v, r) => {
                const overQty = r.receivedQty - r.orderedQty
                return overQty > 0
                  ? <span className="font-semibold text-destructive-ink tabular-nums">超收 {overQty}</span>
                  : <span className="text-muted-foreground tabular-nums">{String(v)}</span>
              },
            },
            { key: 'putawayQty', title: '已上架', width: 9, minWidth: 70, align: 'right', render: v => <span className="tabular-nums">{String(v)}</span> },
            { key: 'unitPrice', title: '单价', width: 10, minWidth: 90, align: 'right', render: v => <span className="tabular-nums">{v != null ? unitPrice(v as number) : '—'}</span> },
            { key: 'lineAmount', title: '已上架金额', width: 9, minWidth: 98, align: 'right', render: v => <span className="font-semibold tabular-nums">{v != null ? money(v as number) : '—'}</span> },
          ] satisfies TableColumn<InboundTaskItem & { lineRemain: number; lineAmount: number | null }>[]}
          data={items.map(it => ({
            ...it,
            lineRemain: Math.max(0, it.orderedQty - it.receivedQty),
            // 小计按「已上架」量算，跟审核结算（recomputePurchasePayable）的取数口径一致——
            // 已收但还没上架的部分还不算真正确认入库，不计入金额，避免这里的数字和最终应付对不上。
            lineAmount: it.unitPrice != null ? it.putawayQty * it.unitPrice : null,
          }))}
          rowKey="id"
          fluid virtualized columnStorageKey="inbound-detail-items"
          emptyText="暂无商品明细"
        />

        </div>
        <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-2 border-t border-border px-4 py-3 text-sm">
          <span className="mr-auto tabular-nums"><span className="text-muted-foreground">明细</span> {items.length} 行</span>
          <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-2 text-muted-foreground">
            {(['orderedQty', 'receivedQty', 'putawayQty'] as const).map((field, index) => <span key={field} className="min-w-0">{(quantityGroups.length <= 3 || areInboundQuantitiesZero(quantityGroups, field)) && <span className="mr-2">{['应到', '已收', '已上架'][index]}</span>}<InboundQuantitySummary collapseZero groups={quantityGroups} field={field} label={['应到', '已收', '已上架'][index]} /></span>)}
          </div>
          <strong className="tabular-nums"><span className="mr-2 font-normal">已上架金额合计</span>{money(items.reduce((sum, it) => sum + (it.unitPrice != null ? it.putawayQty * it.unitPrice : 0), 0))}</strong>
          {task.status === 2 && <p className="w-full text-sm text-muted-foreground">收货尚未结束，此金额不是本次已结算应付或采购结算凭证；仍可继续收货。</p>}
        </div>
      </SectionCard>

      </OrderDetailSections>

      <ConfirmDialog
        open={cancelConfirmOpen}
        title="取消收货订单"
        description="确定取消该收货订单？取消后需重新创建收货订单才能继续收货。"
        variant="destructive"
        confirmText="确定取消"
        loading={cancelMut.isPending}
        onConfirm={() => {
          if (!validId) return
          cancelMut.mutate(validId, {
            onSuccess: () => {
              setCancelConfirmOpen(false)
              toast.success('已取消')
              closeTab()
            },
            onError: () => toast.error('取消失败'),
          })
        }}
        onCancel={() => setCancelConfirmOpen(false)}
      />

      <ConfirmDialog
        open={voidConfirmOpen}
        title="撤回收货"
        description={
          '整单撤回后：已扫码的库存条码将全部作废、恢复为待收货状态，可重新扫码收货。'
          + (task.status === 4
            ? '该收货订单已完成并自动结算过应付，撤回后会一并反冲已入库的库存、冲销已生成的应付记录，若关联采购单因此已自动完成，也会退回"已提交"状态。'
            : '')
          + '若库存条码已被后续拣货、拆分或调拨等动作动过，将无法撤回，请改用库存盘点处理差异。此操作请谨慎确认。'
        }
        variant="destructive"
        confirmText="确定撤回"
        loading={voidReceiptMut.isPending}
        onConfirm={() => {
          if (!validId) return
          voidReceiptMut.mutate(validId, {
            onSuccess: async () => {
              setVoidConfirmOpen(false)
              toast.success('已撤回收货，恢复为待收货')
              await afterMutation()
            },
            onError: (err: unknown) => {
              const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '撤回失败'
              toast.error(msg)
            },
          })
        }}
        onCancel={() => setVoidConfirmOpen(false)}
      />

      <CloseReceivingDialog taskId={closeReceivingConfirmOpen ? validId : null}
        onClose={() => setCloseReceivingConfirmOpen(false)} />

      {printOpen && task && (
        <OrderPrintOverlay
          templateType={2}
          title={task.taskNo}
          {...mapInboundTaskToPrint(task)}
          onClose={() => setPrintOpen(false)}
        />
      )}
    </div>
  )
}
