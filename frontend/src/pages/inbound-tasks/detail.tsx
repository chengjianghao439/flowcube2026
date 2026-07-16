/**
 * 收货订单详情 — 上架 / 审核 / 打印
 * 收货和上架仅允许通过 PDA 完成
 * 路由：/inbound-tasks/:id（多标签）
 */
import { useContext, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { AppDialog } from '@/components/shared/AppDialog'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { toast } from '@/lib/toast'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { LimitedTextarea } from '@/components/shared/LimitedTextarea'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import {
  useInboundTaskDetail,
  useInboundTaskContainers,
  useSubmitInboundTask,
  useAuditInboundTask,
  useCancelInbound,
} from '@/hooks/useInboundTasks'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import { OrderPrintOverlay } from '@/components/print/OrderPrintOverlay'
import { mapInboundTaskToPrint } from '@/lib/orderPrintData'
import { formatDisplayDateTime } from '@/lib/dateTime'
import DataTable from '@/components/shared/DataTable'
import type { TableColumn } from '@/types'
import type { InboundTaskItem } from '@/types/inbound-tasks'

function Section({ title, children, sectionId }: { title: string; children: React.ReactNode; sectionId?: string }) {
  return (
    <div id={sectionId} className="card-base p-5 space-y-4 scroll-mt-24">
      <h3 className="text-section-title pb-2 border-b border-border/50">{title}</h3>
      {children}
    </div>
  )
}

type StatusTone = 'draft' | 'active' | 'success' | 'danger'

const PUTAWAY_TONE: Record<string, StatusTone> = {
  completed: 'success', waiting: 'active', putting_away: 'active', cancelled: 'danger', not_started: 'draft',
}
const AUDIT_TONE: Record<string, StatusTone> = {
  approved: 'success', pending: 'active', rejected: 'danger', cancelled: 'danger', not_ready: 'draft',
}
const PRINT_TONE: Record<string, StatusTone> = {
  success: 'success', queued: 'active', printing: 'active', failed: 'danger', timeout: 'danger', cancelled: 'draft', not_started: 'draft',
}

/** 状态小卡片：标题 + 状态徽章 + 一行补充信息，三张卡统一结构，避免各写各的 */
function StatusCard({ label, value, tone, detail }: { label: string; value: string; tone: StatusTone; detail?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3 space-y-1.5">
      <p className="text-helper">{label}</p>
      <SoftStatusLabel label={value} tone={tone} />
      {detail && <p className="text-helper">{detail}</p>}
    </div>
  )
}

export default function InboundTaskDetailPage() {
  const tabPath = useContext(TabPathContext)
  const params = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const rawId = (tabPath || params.id || '').split('/').filter(Boolean).pop() ?? ''
  const taskId = Number(rawId)
  const validId = Number.isFinite(taskId) && taskId > 0 ? taskId : null

  const isActiveTab = useActiveWorkspaceTab()
  // 收货现场变化频繁，标签页常驻挂载时若不轮询容易停留在打开时的陈旧进度
  const { data: task, isLoading, refetch: refetchTask } = useInboundTaskDetail(validId, { refetchInterval: isActiveTab ? 20_000 : false })
  const { refetch: refetchContainers } = useInboundTaskContainers(validId)

  const submitMut = useSubmitInboundTask()
  const auditMut = useAuditInboundTask()
  const cancelMut = useCancelInbound()

  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false)
  const [approveConfirmOpen, setApproveConfirmOpen] = useState(false)
  const [rejectConfirmOpen, setRejectConfirmOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [printOpen, setPrintOpen] = useState(false)

  function closeTab() {
    const { removeTab } = useWorkspaceStore.getState()
    removeTab(tabPath || '/inbound-tasks')
    navigate('/inbound-tasks')
  }

  async function afterMutation() {
    await refetchTask()
    await refetchContainers()
  }

  const items = Array.isArray(task?.items) ? task.items : []
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

  const canSubmit = receiptStatus?.key === 'draft'
  const canAudit = auditFlowStatus?.key === 'pending' || auditFlowStatus?.key === 'rejected'
  const canCancel = task?.status === 1
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

  if (isLoading || !task) {
    return <p className="p-6 text-muted-body">加载中…</p>
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={`收货订单 ${task.taskNo}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <SoftStatusLabel label={receiptStatus?.label ?? task.statusName} tone={statusTone} />
            <span className="text-muted-foreground">采购单 <span className="text-doc-code">{task.purchaseOrderNo ?? '混合采购'}</span></span>
            <span className="text-muted-foreground">供应商 <span className="text-doc-code">{task.supplierName ?? '—'}</span></span>
          </span>
        }
        actions={
          <div className="flex gap-2 flex-wrap">
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
                {submitMut.isPending ? '提交中...' : '提交到 PDA'}
              </Button>
            )}
            {canAudit && (
              <>
                <Button variant="secondary" size="sm" onClick={() => setApproveConfirmOpen(true)} disabled={auditMut.isPending}>
                  {auditFlowStatus?.key === 'rejected' ? '重新审核通过' : '审核通过'}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setRejectConfirmOpen(true)} disabled={auditMut.isPending}>
                  审核退回
                </Button>
              </>
            )}
            {canCancel && (
              <Button
                variant="destructive"
                size="sm"
                disabled={cancelMut.isPending}
                onClick={() => setCancelConfirmOpen(true)}
              >
                取消任务
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setPrintOpen(true)}>打印</Button>
          </div>
        }
      />

      {/* 整体状态已经在标题旁的徽章里显示过，这里不重复；只展示三个组成状态各自的进度 */}
      <div className="grid gap-3 md:grid-cols-3">
        <StatusCard
          label="上架状态"
          value={putawayStatus?.label ?? '—'}
          tone={PUTAWAY_TONE[putawayStatus?.key ?? ''] ?? 'draft'}
          detail={`待上架 ${putawaySummary?.waitingContainers ?? 0} · 已上架 ${putawaySummary?.storedContainers ?? 0}`}
        />
        <StatusCard
          label="审核状态"
          value={auditFlowStatus?.label ?? '—'}
          tone={AUDIT_TONE[auditFlowStatus?.key ?? ''] ?? 'draft'}
          detail={task.auditedAt ? `${formatDisplayDateTime(task.auditedAt)} · ${task.auditedByName ?? '—'}` : undefined}
        />
        <StatusCard
          label="条码打印"
          value={printStatus?.label ?? '—'}
          tone={PRINT_TONE[printStatus?.key ?? ''] ?? 'draft'}
          detail={printDetail}
        />
      </div>

      <Section title="任务明细" sectionId="task-items">
        <DataTable
          columns={[
            { key: 'productCode', title: '编码', width: 110, render: v => <span className="text-doc-code-muted">{(v as string) || '—'}</span> },
            { key: 'articleNumber', title: '货号', width: 100, render: v => <span className="text-muted-foreground">{(v as string) || '—'}</span> },
            { key: 'spec', title: '型号', width: 100, render: v => <span className="text-muted-foreground">{(v as string) || '—'}</span> },
            { key: 'productName', title: '商品', width: 180, render: v => <span className="font-medium">{String(v)}</span> },
            { key: 'color', title: '颜色', width: 90, render: v => <span className="text-muted-foreground">{(v as string) || '—'}</span> },
            { key: 'unit', title: '单位', width: 70, render: v => <span className="text-muted-foreground">{(v as string) || '—'}</span> },
            { key: 'orderedQty', title: '应到', width: 90 },
            {
              key: 'receivedQty', title: '已收', width: 90,
              render: (v, r) => (
                <span className={(v as number) > r.orderedQty ? 'font-semibold text-destructive' : undefined}>{String(v)}</span>
              ),
            },
            {
              key: 'lineRemain', title: '剩余', width: 90,
              render: (v, r) => {
                const overQty = r.receivedQty - r.orderedQty
                return overQty > 0
                  ? <span className="font-semibold text-destructive">超收 {overQty}</span>
                  : <span className="text-muted-foreground">{String(v)}</span>
              },
            },
            { key: 'putawayQty', title: '已上架', width: 90 },
            { key: 'unitPrice', title: '单价', width: 100, render: v => <span className="text-muted-foreground">{v != null ? `¥${(v as number).toFixed(2)}` : '—'}</span> },
            { key: 'lineAmount', title: '小记', width: 110, render: v => <span className="font-medium">{v != null ? `¥${(v as number).toFixed(2)}` : '—'}</span> },
          ] satisfies TableColumn<InboundTaskItem & { lineRemain: number; lineAmount: number | null }>[]}
          data={items.map(it => ({
            ...it,
            lineRemain: Math.max(0, it.orderedQty - it.receivedQty),
            // 小记按「已上架」量算，跟审核结算（recomputePurchasePayable）的取数口径一致——
            // 已收但还没上架的部分还不算真正确认入库，不计入金额，避免这里的数字和最终应付对不上。
            lineAmount: it.unitPrice != null ? it.putawayQty * it.unitPrice : null,
          }))}
          rowKey="id"
          emptyText="暂无商品明细"
        />

        <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
          <p className="text-muted-body">共 {items.length} 种商品</p>
          <div className="text-right">
            <p className="text-helper">已上架金额合计</p>
            <p className="text-2xl font-semibold text-foreground">
              ¥{items.reduce((sum, it) => sum + (it.unitPrice != null ? it.putawayQty * it.unitPrice : 0), 0).toFixed(2)}
            </p>
          </div>
        </div>
      </Section>

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
        open={approveConfirmOpen}
        title={auditFlowStatus?.key === 'rejected' ? '重新审核通过' : '审核通过'}
        description={
          (items.some(it => it.receivedQty > it.orderedQty) ? '⚠ 存在超收商品，请核对后再确认通过。' : '')
          + (auditFlowStatus?.key === 'rejected'
            ? '确认退回问题已经处理完成，并将该收货订单重新审核通过？'
            : '确认该收货订单已完成收货、打印与上架，并正式通过审核？')
        }
        confirmText={auditFlowStatus?.key === 'rejected' ? '重新审核通过' : '审核通过'}
        loading={auditMut.isPending}
        onConfirm={() => {
          if (!validId) return
          auditMut.mutate({ id: validId, data: { action: 'approve' } }, {
            onSuccess: async () => {
              setApproveConfirmOpen(false)
              toast.success('审核通过')
              await afterMutation()
            },
            onError: (err: unknown) => {
              toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '审核失败')
            },
          })
        }}
        onCancel={() => setApproveConfirmOpen(false)}
      />

      <AppDialog
        open={rejectConfirmOpen}
        onOpenChange={(open) => {
          if (!open && !auditMut.isPending) {
            setRejectConfirmOpen(false)
          }
        }}
        dialogId="inbound-audit-reject"
        title="审核退回"
        resizable={false}
        defaultWidth={520}
        defaultHeight={330}
        minWidth={420}
        minHeight={280}
        footer={(
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={auditMut.isPending}
              onClick={() => {
                setRejectConfirmOpen(false)
                setRejectReason('')
              }}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={auditMut.isPending}
              onClick={() => {
                if (!validId) return
                const remark = rejectReason.trim()
                if (!remark) {
                  toast.error('请填写审核退回原因')
                  return
                }
                auditMut.mutate({ id: validId, data: { action: 'reject', remark } }, {
                  onSuccess: async () => {
                    setRejectConfirmOpen(false)
                    setRejectReason('')
                    toast.success('已退回')
                    await afterMutation()
                  },
                  onError: (err: unknown) => {
                    toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '退回失败')
                  },
                })
              }}
            >
              {auditMut.isPending ? '处理中...' : '确认退回'}
            </Button>
          </div>
        )}
      >
        <div className="space-y-4 px-5 py-4">
          <div className="space-y-1.5 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">请明确填写退回原因</p>
            <p>退回后该收货订单会进入异常处理，后续补打、补录和重新审核都会围绕这个原因继续处理。</p>
          </div>
          <LimitedTextarea
            autoFocus
            maxLength={200}
            value={rejectReason}
            onChange={e => setRejectReason(e.target.value)}
            placeholder="例如：有 2 箱库存条码打印失败，需补打后重新审核"
            rows={5}
          />
        </div>
      </AppDialog>

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
