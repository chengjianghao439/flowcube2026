/**
 * 收货订单详情 — 收货 / 上架 / 容器列表
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

function Section({ title, children, sectionId }: { title: string; children: React.ReactNode; sectionId?: string }) {
  return (
    <div id={sectionId} className="card-base p-5 space-y-4 scroll-mt-24">
      <h3 className="text-section-title pb-2 border-b border-border/50">{title}</h3>
      {children}
    </div>
  )
}

export default function InboundTaskDetailPage() {
  const tabPath = useContext(TabPathContext)
  const params = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const addTab = useWorkspaceStore(s => s.addTab)
  const rawId = (tabPath || params.id || '').split('/').filter(Boolean).pop() ?? ''
  const taskId = Number(rawId)
  const validId = Number.isFinite(taskId) && taskId > 0 ? taskId : null

  const { data: task, isLoading, refetch: refetchTask } = useInboundTaskDetail(validId)
  const { data: containers, refetch: refetchContainers } = useInboundTaskContainers(validId)

  const submitMut = useSubmitInboundTask()
  const auditMut = useAuditInboundTask()
  const cancelMut = useCancelInbound()

  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false)
  const [approveConfirmOpen, setApproveConfirmOpen] = useState(false)
  const [rejectConfirmOpen, setRejectConfirmOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

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

          </div>
        }
      />

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-helper">收货状态</p>
          <p className="mt-1 text-lg font-semibold">{receiptStatus?.label ?? '—'}</p>
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-helper">上架状态</p>
          <p className="mt-1 text-lg font-semibold">{putawayStatus?.label ?? '—'}</p>
          <p className="mt-1 text-helper">待上架 {putawaySummary?.waitingContainers ?? 0} / 已上架 {putawaySummary?.storedContainers ?? 0}</p>
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-helper">审核状态</p>
          <p className="mt-1 text-lg font-semibold">{auditFlowStatus?.label ?? '—'}</p>
          <p className="mt-1 text-helper">{task.auditedAt ? `审核于 ${task.auditedAt}` : ''}</p>
          {task.auditedByName && (
            <p className="mt-1 text-helper">审核人 {task.auditedByName}</p>
          )}
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-helper">条码打印</p>
          <p className="mt-1 text-lg font-semibold">{printSummary?.success ?? 0} / {printSummary?.total ?? 0}</p>
          <p className="mt-1 text-helper">成功 {printSummary?.success ?? 0} 条，失败 {printSummary?.failed ?? 0} 条</p>
        </div>
      </div>

      <Section title="任务明细" sectionId="task-items">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-table-head">
                <th className="text-left py-2">商品</th>
                <th className="text-left py-2 w-24">应到</th>
                <th className="text-left py-2 w-24">已收</th>
                <th className="text-left py-2 w-20">剩余</th>
                <th className="text-left py-2 w-24">已上架</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((it) => {
                const lineRemain = Math.max(0, it.orderedQty - it.receivedQty)
                return (
                  <tr key={it.id}>
                    <td className="py-2">
                      <div className="font-medium">{it.productName}</div>
                      <div className="text-doc-code-muted">{it.productCode}</div>
                    </td>
                    <td className="text-left">{it.orderedQty}</td>
                    <td className="text-left">{it.receivedQty}</td>
                    <td className="text-left text-muted-foreground">{lineRemain}</td>
                    <td className="text-left">{it.putawayQty}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
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
        description={auditFlowStatus?.key === 'rejected'
          ? '确认退回问题已经处理完成，并将该收货订单重新审核通过？'
          : '确认该收货订单已完成收货、打印与上架，并正式通过审核？'}
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
    </div>
  )
}
