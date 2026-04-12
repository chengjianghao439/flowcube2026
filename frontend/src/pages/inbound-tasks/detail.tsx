/**
 * 收货订单详情 — 收货 / 上架 / 容器列表
 * 路由：/inbound-tasks/:id（多标签）
 */
import { useContext, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
  useReceiveInbound,
  useSubmitInboundTask,
  useAuditInboundTask,
  useReprintInboundTask,
  useCancelInbound,
} from '@/hooks/useInboundTasks'
import {
  type InboundContainerRow,
  type InboundPrintBatch,
  type InboundTaskItem,
} from '@/types/inbound-tasks'
import type { InboundRecentPrintJob } from '@/types/inbound-tasks'

function skuRemainToReceive(items: InboundTaskItem[] | undefined, productId: number): number {
  if (!items?.length) return 0
  return items
    .filter(i => i.productId === productId)
    .reduce((s, i) => s + Math.max(0, i.orderedQty - i.receivedQty), 0)
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card-base p-5 space-y-4">
      <h3 className="text-section-title pb-2 border-b border-border/50">{title}</h3>
      {children}
    </div>
  )
}

function ManualReceiveCard({
  title,
  subtitle,
  createdAt,
  createdByName,
}: {
  title: string
  subtitle: string
  createdAt: string
  createdByName: string | null
}) {
  return (
    <div className="rounded-lg border border-border px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-foreground">{title}</span>
        <span className="text-helper">{createdAt}</span>
        {createdByName && <span className="text-helper">· {createdByName}</span>}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
    </div>
  )
}

function printStatusTone(statusKey: string): 'draft' | 'active' | 'success' | 'danger' {
  if (statusKey === 'failed' || statusKey === 'timeout' || statusKey === 'cancelled') return 'danger'
  if (statusKey === 'success') return 'success'
  if (statusKey === 'queued' || statusKey === 'printing') return 'active'
  return 'draft'
}

function PrintBatchCard({
  batch,
  onOpenQuery,
  onOpenFailedQuery,
}: {
  batch: InboundPrintBatch
  onOpenQuery: () => void
  onOpenFailedQuery: () => void
}) {
  const needsFollowUp = batch.failed > 0 || batch.timeout > 0

  return (
    <div className="rounded-xl border border-border bg-card px-4 py-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-medium text-foreground">{batch.title}</h4>
            <SoftStatusLabel label={batch.statusLabel} tone={printStatusTone(batch.statusKey)} />
          </div>
          <p className="text-helper">{batch.dispatchReasonLabel} · {batch.firstCreatedAt}</p>
          <p className="text-helper">最近回写 {batch.lastUpdatedAt}</p>
        </div>
        <div className="grid min-w-[220px] grid-cols-3 gap-2 text-right">
          <div className="rounded-lg border border-border px-3 py-2">
            <p className="text-helper">总任务</p>
            <p className="mt-1 text-lg font-semibold text-foreground">{batch.total}</p>
          </div>
          <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] px-3 py-2">
            <p className="text-helper">成功</p>
            <p className="mt-1 text-lg font-semibold text-foreground">{batch.success}</p>
          </div>
          <div className="rounded-lg border border-rose-500/25 bg-rose-500/[0.06] px-3 py-2">
            <p className="text-helper">失败 / 超时</p>
            <p className="mt-1 text-lg font-semibold text-foreground">{batch.failed + batch.timeout}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-4">
        <div className="rounded-lg border border-border px-3 py-2">
          <p className="text-helper">待派发</p>
          <p className="mt-1 font-medium text-foreground">{batch.queued}</p>
        </div>
        <div className="rounded-lg border border-border px-3 py-2">
          <p className="text-helper">打印中</p>
          <p className="mt-1 font-medium text-foreground">{batch.printing}</p>
        </div>
        <div className="rounded-lg border border-border px-3 py-2">
          <p className="text-helper">打印机</p>
          <p className="mt-1 font-medium text-foreground">{batch.printerNames.join(' / ') || '未绑定打印机'}</p>
        </div>
        <div className="rounded-lg border border-border px-3 py-2">
          <p className="text-helper">条码样本</p>
          <p className="mt-1 font-medium text-foreground">{batch.barcodes.slice(0, 2).join(' / ') || '—'}</p>
        </div>
      </div>

      {batch.latestErrorMessage && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.08] px-4 py-3 text-sm text-foreground">
          最近异常：{batch.latestErrorMessage}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {needsFollowUp
            ? '当前批次仍有失败或超时任务，建议先补打并确认打印回执，再继续后续审核。'
            : '当前批次打印结果已回写，可继续核对上架与审核状态。'}
        </p>
        <div className="flex flex-wrap gap-2">
          {needsFollowUp && (
            <Button size="sm" variant="outline" onClick={onOpenFailedQuery}>
              去失败补打
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onOpenQuery}>
            查看本单打印记录
          </Button>
        </div>
      </div>
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

  const receiveMut = useReceiveInbound()
  const submitMut = useSubmitInboundTask()
  const auditMut = useAuditInboundTask()
  const reprintMut = useReprintInboundTask()
  const cancelMut = useCancelInbound()

  const [lineQty, setLineQty] = useState<Record<number, string>>({})
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false)
  const [approveConfirmOpen, setApproveConfirmOpen] = useState(false)
  const [rejectConfirmOpen, setRejectConfirmOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  function closeTab() {
    const { removeTab, tabs } = useWorkspaceStore.getState()
    const nextKey = removeTab(tabPath || '/inbound-tasks')
    const nextTab = tabs.find(t => t.key === nextKey)
    navigate(nextTab?.path ?? '/inbound-tasks')
  }

  async function afterMutation() {
    await refetchTask()
    await refetchContainers()
  }

  const items = Array.isArray(task?.items) ? task.items : []
  const recentPrintJobs = Array.isArray(task?.recentPrintJobs) ? task.recentPrintJobs : []
  const printBatches = Array.isArray(task?.printBatches) ? task.printBatches : []
  const timeline = Array.isArray(task?.timeline) ? task.timeline : []
  const exceptionFlags = task?.exceptionFlags ?? null
  const printSummary = task?.printSummary ?? null
  const putawaySummary = task?.putawaySummary ?? null
  const receiptStatus = task?.receiptStatus ?? null
  const printStatus = task?.printStatus ?? null
  const putawayStatus = task?.putawayStatus ?? null
  const auditFlowStatus = task?.auditFlowStatus ?? null

  const canSubmit = receiptStatus?.key === 'draft'
  const canReceive = receiptStatus?.key === 'submitted' || receiptStatus?.key === 'receiving'
  const canPutaway = putawayStatus?.key === 'waiting' || putawayStatus?.key === 'putting_away'
  const canAudit = auditFlowStatus?.key === 'pending' || auditFlowStatus?.key === 'rejected'
  const canCancel = task?.status === 1
  const waitingCount = containers?.waiting?.length ?? 0
  const storedCount = containers?.stored?.length ?? 0
  const totalWaitingQty = (containers?.waiting ?? []).reduce((sum, row) => sum + Number(row.qty || 0), 0)
  const totalStoredQty = (containers?.stored ?? []).reduce((sum, row) => sum + Number(row.qty || 0), 0)
  const statusTone = receiptStatus?.key === 'audited'
    ? 'success'
    : receiptStatus?.key === 'exception'
      ? 'danger'
      : receiptStatus?.key === 'draft'
        ? 'draft'
        : 'active'
  const exceptionLines = useMemo(() => {
    const flags = exceptionFlags
    if (!flags?.hasException) return []
    const lines: string[] = []
    if (flags.failedPrintJobs > 0) lines.push(`${flags.failedPrintJobs} 条库存条码打印失败待补打`)
    if (flags.timeoutPrintJobs > 0) lines.push(`${flags.timeoutPrintJobs} 条库存条码打印超时待确认`)
    if (flags.overduePutawayContainers > 0) lines.push(`${flags.overduePutawayContainers} 箱已打印未上架超时`)
    if (flags.pendingAuditOverdue) lines.push('该收货订单已上架但审核超时')
    if (flags.auditRejected) lines.push('该收货订单已被审核退回')
    return lines
  }, [exceptionFlags])
  const manualReceiveEvents = useMemo(() => {
    return timeline
      .filter(event => event.eventType === 'receive_recorded')
      .map(event => {
        const payload = event.payload ?? {}
        const productName = typeof payload.productName === 'string' ? payload.productName : event.title
        const totalQty = typeof payload.totalQty === 'number' ? payload.totalQty : null
        const packages = typeof payload.packages === 'number' ? payload.packages : null
        return {
          id: event.id,
          title: productName || '补录收货',
          subtitle: `${packages ?? 0} 箱${totalQty != null ? `，共 ${totalQty}` : ''}，已生成库存条码并进入打印队列`,
          createdAt: event.createdAt,
          createdByName: event.createdByName,
        }
      })
  }, [timeline])

  if (!validId) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-border bg-card p-5 text-muted-foreground">
          <p className="font-medium text-foreground">收货订单路径无效</p>
          <p className="mt-1">请从收货订单列表重新打开该详情页。</p>
        </div>
      </div>
    )
  }

  if (isLoading || !task) {
    return <p className="p-6 text-muted-body">加载中…</p>
  }

  function submitOnePackage(it: InboundTaskItem) {
    if (!validId || !task) return
    const raw = lineQty[it.id]?.trim()
    if (!raw) {
      toast.error('请填写本包数量')
      return
    }
    const q = Number(raw.replace(/,/g, '.'))
    if (!Number.isFinite(q) || q <= 0) {
      toast.error(`数量无效：${it.productName}`)
      return
    }
    const remainSku = skuRemainToReceive(items, it.productId)
    if (q > remainSku) {
      toast.error(`${it.productName} 超出待收（该 SKU 最多还可收 ${remainSku}）`)
      return
    }
    receiveMut.mutate(
      { id: validId, data: { productId: it.productId, qty: q } },
      {
        onSuccess: async (data) => {
          const pj = data.printJobId ? '，已排队打印标签' : '（未配置 INBOUND_LABEL_PRINTER_CODE 则未打印）'
          toast.success(`本包容器 ${data.containerCode}${pj}`)
          setLineQty(p => ({ ...p, [it.id]: '' }))
          await afterMutation()
        },
        onError: (err: unknown) => {
          const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '收货失败'
          toast.error(msg)
        },
      },
    )
  }

  function openPrintQuery(extra: Record<string, string> = {}) {
    const searchParams = new URLSearchParams({ category: 'inbound', inboundTaskId: String(task.id), ...extra })
    const path = `/settings/barcode-print-query?${searchParams.toString()}`
    addTab({ key: path, title: `补打 ${task.taskNo}`, path })
    navigate(path)
  }

  function triggerReprint(data: { mode: 'task' | 'item' | 'barcode'; itemId?: number; barcode?: string }, successText: string) {
    if (!validId) return
    reprintMut.mutate(
      { id: validId, data },
      {
        onSuccess: async (result) => {
          toast.success(`${successText}，已加入 ${result.count} 条打印任务`)
          await afterMutation()
        },
        onError: (err: unknown) => {
          const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '补打失败'
          toast.error(msg)
        },
      },
    )
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
            <Button variant="outline" size="sm" onClick={() => openPrintQuery()}>
              查看打印 / 补打
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={reprintMut.isPending}
              onClick={() => triggerReprint({ mode: 'task' }, '整单补打已提交')}
            >
              整单补打
            </Button>
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
            <Button variant="outline" size="sm" onClick={closeTab}>关闭</Button>
          </div>
        }
      />

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <p className="text-helper">收货状态</p>
          <p className="mt-1 text-lg font-semibold">{receiptStatus?.label ?? '—'}</p>
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <p className="text-helper">打印状态</p>
          <p className="mt-1 text-lg font-semibold">{printStatus?.label ?? '—'}</p>
          <p className="mt-1 text-helper">已打印 {printSummary?.success ?? 0} / 失败 {printSummary?.failed ?? 0}</p>
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <p className="text-helper">上架状态</p>
          <p className="mt-1 text-lg font-semibold">{putawayStatus?.label ?? '—'}</p>
          <p className="mt-1 text-helper">待上架 {putawaySummary?.waitingContainers ?? 0} / 已上架 {putawaySummary?.storedContainers ?? 0}</p>
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <p className="text-helper">审核状态</p>
          <p className="mt-1 text-lg font-semibold">{auditFlowStatus?.label ?? '—'}</p>
          <p className="mt-1 text-helper">{task.auditedAt ? `审核于 ${task.auditedAt}` : '收货完成后进入审核'}</p>
          {task.auditedByName && (
            <p className="mt-1 text-helper">审核人 {task.auditedByName}</p>
          )}
        </div>
      </div>

      {!!exceptionLines.length && (
        <Section title="异常提醒">
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 space-y-2">
            {exceptionLines.map(line => (
              <p key={line} className="text-sm text-foreground">{line}</p>
            ))}
            {task.auditRemark && auditFlowStatus?.key === 'rejected' && (
              <p className="text-sm text-foreground">退回原因：{task.auditRemark}</p>
            )}
            <div className="pt-1">
              <Button size="sm" variant="outline" onClick={() => openPrintQuery({ status: 'failed' })}>
                去补打 / 排查
              </Button>
            </div>
          </div>
        </Section>
      )}

      {(auditFlowStatus?.key === 'rejected' || manualReceiveEvents.length > 0) && (
        <Section title="审核处理与补录">
          <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-3">
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.08] px-4 py-3 text-sm space-y-1.5">
                <p className="font-medium text-foreground">退回后的处理顺序</p>
                <p className="text-muted-foreground">先补打失败条码或补录缺失箱数，再确认上架与打印状态无异常，最后从本页重新审核通过。</p>
                {task.auditRemark && auditFlowStatus?.key === 'rejected' && (
                  <p className="text-foreground">最新退回原因：{task.auditRemark}</p>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="sm" variant="outline" onClick={() => openPrintQuery({ status: 'failed' })}>
                    查看失败补打
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openPrintQuery()}>
                    打开本单打印记录
                  </Button>
                  {canAudit && auditFlowStatus?.key === 'rejected' && (
                    <Button size="sm" onClick={() => setApproveConfirmOpen(true)} disabled={auditMut.isPending}>
                      重新审核通过
                    </Button>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h4 className="font-medium text-foreground">最近补录动作</h4>
                <span className="text-helper">{manualReceiveEvents.length} 条</span>
              </div>
              {manualReceiveEvents.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                  当前没有补录记录
                </div>
              ) : (
                <div className="space-y-2">
                  {manualReceiveEvents.slice(0, 5).map(event => (
                    <ManualReceiveCard
                      key={event.id}
                      title={event.title}
                      subtitle={event.subtitle}
                      createdAt={event.createdAt}
                      createdByName={event.createdByName}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </Section>
      )}

      <Section title="任务明细（应到 / 已收 / 已上架）">
        {!task.submittedAt && (
          <div className="space-y-1.5 rounded-lg border border-slate-500/30 bg-slate-500/[0.06] px-4 py-3 text-helper">
            <p className="font-medium text-foreground">当前仍是草稿收货订单。</p>
            <p>请先点击“提交到 PDA”，再由 PDA 执行收货、打印库存条码和上架。</p>
          </div>
        )}
        {canReceive && (
          <div className="space-y-1.5 rounded-lg border border-amber-500/30 bg-amber-500/[0.08] px-4 py-3 text-helper">
            <p className="font-medium text-foreground">电脑端只保留补录单箱收货，现场主流程请走 PDA。</p>
            <p>电脑端每次只补录 1 箱，提交后会生成 1 个库存条码并加入打印队列。</p>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-table-head">
                <th className="text-left py-2">商品</th>
                <th className="text-right py-2 w-24">应到</th>
                <th className="text-right py-2 w-24">已收</th>
                <th className="text-right py-2 w-20">本行剩余</th>
                <th className="text-right py-2 w-24">已上架</th>
                {canReceive && <th className="text-right py-2 min-w-[200px]">本包收货</th>}
                <th className="text-right py-2 w-28">补打</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((it: InboundTaskItem) => {
                const lineRemain = Math.max(0, it.orderedQty - it.receivedQty)
                const skuRemain = skuRemainToReceive(items, it.productId)
                return (
                  <tr key={it.id}>
                    <td className="py-2">
                      <div className="font-medium">{it.productName}</div>
                      <div className="text-doc-code-muted">{it.productCode}</div>
                    </td>
                    <td className="text-right">{it.orderedQty}</td>
                    <td className="text-right">{it.receivedQty}</td>
                    <td className="text-right text-muted-foreground">{lineRemain}</td>
                    <td className="text-right">{it.putawayQty}</td>
                    {canReceive && (
                      <td className="py-2 text-right">
                        <div className="flex flex-col items-end gap-1 sm:flex-row sm:justify-end sm:items-center">
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap sm:mr-1">
                            SKU 还可收 {skuRemain}
                          </span>
                          <Input
                            className="h-8 w-24 text-right"
                            placeholder="本包"
                            value={lineQty[it.id] ?? ''}
                            onChange={e => setLineQty(p => ({ ...p, [it.id]: e.target.value }))}
                            disabled={skuRemain <= 0 || receiveMut.isPending}
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={skuRemain <= 0 || receiveMut.isPending}
                            onClick={() => submitOnePackage(it)}
                          >
                            提交本包
                          </Button>
                        </div>
                      </td>
                    )}
                    <td className="py-2 text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={reprintMut.isPending || it.receivedQty <= 0}
                        onClick={() => triggerReprint({ mode: 'item', itemId: it.id }, `${it.productName} 补打已提交`)}
                      >
                        补打本商品
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Section>

      {canPutaway && (
        <Section title="待上架库存">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-border bg-card px-4 py-3">
              <p className="text-helper">待上架箱数</p>
              <p className="mt-1 text-2xl font-bold">{waitingCount}</p>
              <p className="mt-1 text-helper">合计数量 {totalWaitingQty}</p>
            </div>
            <div className="rounded-xl border border-border bg-card px-4 py-3">
              <p className="text-helper">已上架箱数</p>
              <p className="mt-1 text-2xl font-bold">{storedCount}</p>
              <p className="mt-1 text-helper">合计数量 {totalStoredQty}</p>
            </div>
          </div>
          <div className="rounded-lg border border-sky-500/35 bg-sky-500/[0.08] px-4 py-3 text-sm space-y-1.5">
            <p className="font-medium text-sky-950 dark:text-sky-100">请使用 PDA 扫码完成上架</p>
            <p className="text-muted-body">
              在 PDA「扫码上架」进入本任务，依次扫描库存条码（I）与货架条码（R）。如果库存条码丢失或打印残缺，可直接去本单的打印查询补打。
            </p>
            <Button size="sm" variant="outline" onClick={() => openPrintQuery()} className="mt-1">打开本单补打</Button>
          </div>

          {!containers?.waiting?.length ? (
            <p className="pt-1 text-muted-body">暂无待上架库存</p>
          ) : (
            <div className="overflow-x-auto pt-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-table-head">
                    <th className="text-left py-2 pr-2">库存条码</th>
                    <th className="text-left py-2">商品</th>
                    <th className="text-right py-2 w-24">数量</th>
                    <th className="text-right py-2 w-28">补打</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {containers.waiting.map((c: InboundContainerRow) => (
                    <tr key={c.id}>
                      <td className="py-2.5 whitespace-nowrap"><span className="text-doc-code">{c.barcode}</span></td>
                      <td className="py-2.5">
                        <span className="font-medium">{c.productName ?? '—'}</span>
                        {c.productCode && (
                          <span className="block text-doc-code-muted">{c.productCode}</span>
                        )}
                      </td>
                      <td className="py-2.5 text-right tabular-nums">
                        {c.qty}{c.unit ? ` ${c.unit}` : ''}
                      </td>
                      <td className="py-2.5 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={reprintMut.isPending}
                          onClick={() => triggerReprint({ mode: 'barcode', barcode: c.barcode }, `${c.barcode} 补打已提交`)}
                        >
                          补打条码
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}

      <Section title="容器：已上架">
        {!containers?.stored?.length ? (
          <p className="text-muted-body">暂无</p>
        ) : (
          <ul className="text-sm space-y-2">
            {containers.stored.map(c => (
              <li key={c.id} className="flex flex-wrap justify-between gap-2 border rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <span className="text-doc-code">{c.barcode}</span>
                  <span className="ml-3">{c.productName} × {c.qty}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">{c.locationCode ?? '—'}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={reprintMut.isPending}
                    onClick={() => triggerReprint({ mode: 'barcode', barcode: c.barcode }, `${c.barcode} 补打已提交`)}
                  >
                    补打
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="打印批次与补打结果">
        {!printBatches.length ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            本单暂无打印批次，后续收货生成库存条码后会在这里回写批次结果。
          </div>
        ) : (
          <div className="space-y-3">
            {printBatches.map((batch: InboundPrintBatch) => (
              <PrintBatchCard
                key={batch.batchKey}
                batch={batch}
                onOpenQuery={() => openPrintQuery()}
                onOpenFailedQuery={() => openPrintQuery({ status: 'failed' })}
              />
            ))}
          </div>
        )}

        <div className="space-y-2 pt-3 border-t border-border/60">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h4 className="font-medium text-foreground">打印明细记录</h4>
            <span className="text-helper">保留最近 {recentPrintJobs.length} 条</span>
          </div>
          {!recentPrintJobs.length ? (
            <p className="text-muted-body">本单暂无打印记录</p>
          ) : (
            <div className="space-y-2">
              {recentPrintJobs.map((job: InboundRecentPrintJob) => (
                <div key={job.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-medium text-foreground">{job.productName ?? job.barcode ?? '库存条码'}</div>
                      <SoftStatusLabel label={job.statusLabel ?? '未知'} tone={printStatusTone(job.statusKey)} />
                    </div>
                    <div className="text-doc-code-muted">{job.barcode ?? '—'} · {job.dispatchReason ?? 'default'}</div>
                    <div className="text-helper">{job.printerCode ?? job.printerName ?? '未绑定打印机'}{job.errorMessage ? ` · ${job.errorMessage}` : ''}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-helper">{job.updatedAt}</span>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={reprintMut.isPending}
                        onClick={() => job.barcode
                          ? triggerReprint({ mode: 'barcode', barcode: job.barcode }, `${job.barcode} 补打已提交`)
                          : openPrintQuery()
                        }
                      >
                        补打
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => openPrintQuery(job.barcode ? { keyword: job.barcode } : {})}>
                        查看记录
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Section>

      <Section title="操作时间线">
        {!timeline.length ? (
          <p className="text-muted-body">暂无时间线记录</p>
        ) : (
          <div className="space-y-3">
            {timeline.map(event => (
              <div key={event.id} className="rounded-lg border border-border px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{event.title}</span>
                  <span className="text-helper">{event.createdAt}</span>
                  {event.createdByName && <span className="text-helper">· {event.createdByName}</span>}
                </div>
                {event.description && <p className="mt-1 text-sm text-muted-foreground">{event.description}</p>}
              </div>
            ))}
          </div>
        )}
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
