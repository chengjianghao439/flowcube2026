/**
 * 收货订单详情 — 上架进度 / 打印
 * 收货和上架仅允许通过 PDA 完成；全部上架完成后系统自动结算应付，无需人工审核
 * 路由：/inbound-tasks/:id（多标签）
 */
import { useContext, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { toast } from '@/lib/toast'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { AppDialog } from '@/components/shared/AppDialog'
import { LimitedTextarea } from '@/components/shared/LimitedTextarea'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import {
  useInboundTaskDetail,
  useInboundTaskContainers,
  useSubmitInboundTask,
  useCancelInbound,
  useVoidInboundReceipt,
  useCloseReceivingInbound,
  useInboundQaDispositions,
  useQaDisposeInbound,
} from '@/hooks/useInboundTasks'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { OrderPrintOverlay } from '@/components/print/OrderPrintOverlay'
import { mapInboundTaskToPrint } from '@/lib/orderPrintData'
import { formatDisplayDateTime } from '@/lib/dateTime'
import DataTable from '@/components/shared/DataTable'
import { cn } from '@/lib/utils'
import type { TableColumn } from '@/types'
import type { InboundTaskItem, InboundContainerRow, QaDisposition } from '@/types/inbound-tasks'

function Section({ title, children, sectionId }: { title: string; children: React.ReactNode; sectionId?: string }) {
  return (
    <div id={sectionId} className="card-base p-5 space-y-4 scroll-mt-24">
      <h3 className="text-section-title pb-2 border-b border-border/50">{title}</h3>
      {children}
    </div>
  )
}

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
  const { data: containers, refetch: refetchContainers } = useInboundTaskContainers(validId)
  const { data: dispositions, refetch: refetchDispositions } = useInboundQaDispositions(validId)

  const { can } = usePermission()
  const submitMut = useSubmitInboundTask()
  const cancelMut = useCancelInbound()
  const voidReceiptMut = useVoidInboundReceipt()
  const closeReceivingMut = useCloseReceivingInbound()
  const disposeMut = useQaDisposeInbound()

  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false)
  const [voidConfirmOpen, setVoidConfirmOpen] = useState(false)
  const [closeReceivingConfirmOpen, setCloseReceivingConfirmOpen] = useState(false)
  const [printOpen, setPrintOpen] = useState(false)
  const [disposeOpen, setDisposeOpen] = useState(false)
  const [disposeType, setDisposeType] = useState<1 | 2>(1)
  const [disposeReason, setDisposeReason] = useState('')

  function closeTab() {
    const { removeTab } = useWorkspaceStore.getState()
    removeTab(tabPath || '/inbound-tasks')
    navigate('/inbound-tasks')
  }

  async function afterMutation() {
    await refetchTask()
    await refetchContainers()
    await refetchDispositions()
  }

  function handleDispose() {
    if (!validId) return
    disposeMut.mutate(
      { id: validId, data: { dispositionType: disposeType, reason: disposeReason.trim() || undefined } },
      {
        onSuccess: async (res) => {
          setDisposeOpen(false)
          toast.success(`已生成处置单：${disposeType === 1 ? '退供应商' : '报废'} ${res?.totalQty ?? ''} 件，待仓库 PDA 扫出确认`)
          await afterMutation()
        },
        onError: (err: unknown) => {
          const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '处置失败'
          toast.error(msg)
        },
      },
    )
  }

  const items = Array.isArray(task?.items) ? task.items : []
  const printSummary = task?.printSummary ?? null
  const putawaySummary = task?.putawaySummary ?? null
  const receiptStatus = task?.receiptStatus ?? null
  const putawayStatus = task?.putawayStatus ?? null
  const auditFlowStatus = task?.auditFlowStatus ?? null
  const printStatus = task?.printStatus ?? null

  // ── 来料质检（文档07 Phase2）：进度可视化 + 拒收品处置 ──
  const qaItems = items.filter(it => it.qaRequired)
  const rejectedContainers: InboundContainerRow[] = containers?.rejected ?? []
  const rejectedTotalQty = rejectedContainers.reduce((s, c) => s + c.qty, 0)
  const dispositionList: QaDisposition[] = Array.isArray(dispositions) ? dispositions : []
  const qaStatus = task?.qaStatus ?? 0
  const showQaSection = qaItems.length > 0 || qaStatus > 0 || rejectedContainers.length > 0 || dispositionList.length > 0
  const canDispose = can(PERMISSIONS.INBOUND_QA_DISPOSE)
  const qaStatusView: { label: string; tone: StatusTone } | null =
    qaStatus === 2 ? { label: '质检完成', tone: 'success' }
    : qaStatus === 1 ? { label: '待质检', tone: 'warning' }
    : null

  const printDetail = printSummary
    ? [
        printSummary.timeout > 0 ? `${printSummary.timeout} 条超时待确认` : null,
        printSummary.failed > 0 ? `${printSummary.failed} 条失败` : null,
        printSummary.queued + printSummary.printing > 0 ? `${printSummary.queued + printSummary.printing} 条待打印` : null,
      ].filter(Boolean).join(' · ') || `${printSummary.success} / ${printSummary.total} 已成功`
    : null

  const canSubmit = receiptStatus?.key === 'draft'
  const canCancel = task?.status === 1
  const canVoidReceipt = task?.status === 2 || task?.status === 3 || task?.status === 4
  const canCloseReceiving = task?.status === 2
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
            {canVoidReceipt && (
              <Button
                variant="outline"
                className="text-destructive border-destructive/30 hover:bg-destructive/5"
                size="sm"
                disabled={voidReceiptMut.isPending}
                onClick={() => setVoidConfirmOpen(true)}
              >
                撤回收货
              </Button>
            )}
            {canCloseReceiving && (
              <Button
                variant="outline"
                size="sm"
                disabled={closeReceivingMut.isPending}
                onClick={() => setCloseReceivingConfirmOpen(true)}
              >
                结束收货
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
            { key: 'orderedQty', title: '应到', width: 90, align: 'right', render: v => <span className="tabular-nums">{String(v)}</span> },
            {
              key: 'receivedQty', title: '已收', width: 90, align: 'right',
              render: (v, r) => (
                <span className={`tabular-nums ${(v as number) > r.orderedQty ? 'font-semibold text-destructive' : ''}`}>{String(v)}</span>
              ),
            },
            {
              key: 'lineRemain', title: '剩余', width: 90, align: 'right',
              render: (v, r) => {
                const overQty = r.receivedQty - r.orderedQty
                return overQty > 0
                  ? <span className="font-semibold text-destructive tabular-nums">超收 {overQty}</span>
                  : <span className="text-muted-foreground tabular-nums">{String(v)}</span>
              },
            },
            { key: 'putawayQty', title: '已上架', width: 90, align: 'right', render: v => <span className="tabular-nums">{String(v)}</span> },
            { key: 'unitPrice', title: '单价', width: 100, align: 'right', render: v => <span className="text-muted-foreground tabular-nums">{v != null ? `¥${(v as number).toFixed(2)}` : '—'}</span> },
            { key: 'lineAmount', title: '小记', width: 110, align: 'right', render: v => <span className="font-medium tabular-nums">{v != null ? `¥${(v as number).toFixed(2)}` : '—'}</span> },
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

      {showQaSection && (
        <Section title="来料质检" sectionId="qa">
          <div className="flex flex-wrap items-center gap-3">
            {qaStatusView
              ? <SoftStatusLabel label={qaStatusView.label} tone={qaStatusView.tone} />
              : qaItems.length === 0
                ? <span className="text-helper">本单无质检管控商品</span>
                : null}
            <span className="text-helper">质检管控商品先进「待质检」，合格才可上架、拒收不入库不结算</span>
          </div>

          {qaItems.length > 0 && (
            <DataTable
              columns={[
                { key: 'productCode', title: '编码', width: 110, render: v => <span className="text-doc-code-muted">{(v as string) || '—'}</span> },
                { key: 'productName', title: '商品', width: 200, render: v => <span className="font-medium">{String(v)}</span> },
                { key: 'receivedQty', title: '已收', width: 80, align: 'right', render: v => <span className="tabular-nums">{String(v)}</span> },
                { key: 'passedQty', title: '合格', width: 80, align: 'right', render: v => <span className="tabular-nums text-success">{String(v)}</span> },
                { key: 'rejectedShow', title: '拒收', width: 80, align: 'right', render: v => <span className={cn('tabular-nums', (v as number) > 0 && 'font-semibold text-destructive')}>{String(v)}</span> },
                { key: 'pendingQa', title: '待质检', width: 90, align: 'right', render: v => <span className={cn('tabular-nums', (v as number) > 0 && 'font-semibold text-warning')}>{String(v)}</span> },
              ] satisfies TableColumn<InboundTaskItem & { passedQty: number; rejectedShow: number; pendingQa: number }>[]}
              data={qaItems.map(it => {
                const received = it.receivedQty
                const checked = it.checkedQty ?? 0
                const rejected = it.rejectedQty ?? 0
                return { ...it, passedQty: Math.max(0, checked - rejected), rejectedShow: rejected, pendingQa: Math.max(0, received - checked) }
              })}
              rowKey="id"
              emptyText="无质检明细"
            />
          )}

          {rejectedContainers.length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-foreground">
                  质检拒收品 <span className="text-destructive tabular-nums">{rejectedTotalQty}</span> 件 · {rejectedContainers.length} 个容器
                  <span className="text-helper ml-1">（未入库、未结算，待处置）</span>
                </p>
                {canDispose && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive border-destructive/30 hover:bg-destructive/5"
                    onClick={() => { setDisposeType(1); setDisposeReason(''); setDisposeOpen(true) }}
                  >
                    处置拒收品
                  </Button>
                )}
              </div>
              <DataTable
                columns={[
                  { key: 'barcode', title: '库存条码', width: 120, render: v => <span className="text-doc-code">{String(v)}</span> },
                  { key: 'productName', title: '商品', width: 220, render: v => <span className="font-medium">{(v as string) || '—'}</span> },
                  { key: 'qty', title: '数量', width: 100, align: 'right', render: (v, r) => <span className="tabular-nums">{String(v)} {r.unit || ''}</span> },
                ] satisfies TableColumn<InboundContainerRow>[]}
                data={rejectedContainers}
                rowKey="id"
                emptyText="无拒收容器"
              />
            </div>
          )}

          {dispositionList.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">处置记录</p>
              <DataTable
                columns={[
                  { key: 'dispositionNo', title: '处置单号', width: 160, render: v => <span className="text-doc-code">{String(v)}</span> },
                  { key: 'dispositionTypeName', title: '方式', width: 100, render: (v, r) => <SoftStatusLabel label={String(v)} tone={r.dispositionType === 2 ? 'danger' : 'warning'} /> },
                  { key: 'status', title: '扫出状态', width: 140, render: (_, r) => r.status === 2
                    ? <SoftStatusLabel label="已完成" tone="success" />
                    : <span className="inline-flex items-center gap-1"><SoftStatusLabel label="待扫出" tone="warning" /><span className="text-xs text-muted-foreground tabular-nums">{r.scannedCount ?? 0}/{(r.scannedCount ?? 0) + (r.pendingCount ?? 0)}</span></span> },
                  { key: 'totalQty', title: '数量', width: 80, align: 'right', render: v => <span className="tabular-nums">{String(v)}</span> },
                  { key: 'totalAmount', title: '参考货值', width: 110, align: 'right', render: v => <span className="text-muted-foreground tabular-nums">¥{(v as number).toFixed(2)}</span> },
                  { key: 'reason', title: '原因', width: 150, render: v => <span className="text-muted-foreground">{(v as string) || '—'}</span> },
                  { key: 'operatorName', title: '处置人', width: 90, render: v => <span className="text-muted-foreground">{(v as string) || '—'}</span> },
                  { key: 'createdAt', title: '时间', width: 150, render: v => <span className="text-muted-foreground">{formatDisplayDateTime(v as string)}</span> },
                ] satisfies TableColumn<QaDisposition>[]}
                data={dispositionList}
                rowKey="id"
                emptyText="无处置记录"
              />
            </div>
          )}
        </Section>
      )}

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
          + '若容器已被后续拣货、拆分或调拨等动作动过，将无法撤回，请改用库存盘点处理差异。此操作请谨慎确认。'
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

      <ConfirmDialog
        open={closeReceivingConfirmOpen}
        title="结束收货"
        description="供应商短装、不再继续收货时使用：立即结束收货，剩余未收数量作罢，进入待上架，可正常上架已收到的部分。此操作不可撤回。"
        confirmText="确定结束收货"
        loading={closeReceivingMut.isPending}
        onConfirm={() => {
          if (!validId) return
          closeReceivingMut.mutate(validId, {
            onSuccess: async () => {
              setCloseReceivingConfirmOpen(false)
              toast.success('已结束收货，进入待上架')
              await afterMutation()
            },
            onError: (err: unknown) => {
              const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '结束收货失败'
              toast.error(msg)
            },
          })
        }}
        onCancel={() => setCloseReceivingConfirmOpen(false)}
      />

      <AppDialog
        open={disposeOpen}
        onOpenChange={setDisposeOpen}
        dialogId="inbound-qa-dispose"
        title="处置质检拒收品"
        resizable={false}
        defaultWidth={520}
        defaultHeight={520}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDisposeOpen(false)} disabled={disposeMut.isPending}>取消</Button>
            <Button variant="destructive" disabled={disposeMut.isPending || rejectedContainers.length === 0} onClick={handleDispose}>
              {disposeMut.isPending ? '处置中…' : `确认${disposeType === 1 ? '退供应商' : '报废'}`}
            </Button>
          </div>
        }
      >
        <div className="h-full overflow-auto p-5 space-y-4">
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 space-y-1">
            <p className="text-sm font-medium text-foreground">
              将处置 <span className="text-destructive tabular-nums">{rejectedTotalQty}</span> 件拒收品（{rejectedContainers.length} 个容器）
            </p>
            <p className="text-helper">
              生成处置单后，需仓库在 PDA「拒收处置」扫码逐个确认容器物理出场才最终作废；因拒收品从收货起就不计库存、不进应付，此操作
              <span className="font-medium text-foreground">不影响库存与账款、不生成凭证</span>。
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">处置方式</p>
            <div className="grid grid-cols-2 gap-2">
              {([[1, '退供应商', '退回供应商索赔/换货'], [2, '报废', '就地报废销毁']] as const).map(([val, label, desc]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setDisposeType(val)}
                  className={cn(
                    'rounded-lg border px-3 py-2.5 text-left transition-colors',
                    disposeType === val ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'border-border hover:bg-muted/40',
                  )}
                >
                  <p className="text-sm font-medium text-foreground">{label}</p>
                  <p className="text-helper mt-0.5">{desc}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">处置原因 <span className="text-helper">（选填）</span></p>
            <LimitedTextarea
              value={disposeReason}
              onChange={e => setDisposeReason(e.target.value)}
              maxLength={200}
              rows={3}
              placeholder="如：外观破损、色差、错版、过期…"
            />
          </div>

          {rejectedContainers.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-foreground">拒收品明细</p>
              <div className="rounded-lg border border-border divide-y divide-border/60">
                {rejectedContainers.map(c => (
                  <div key={c.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="text-doc-code shrink-0">{c.barcode}</span>
                    <span className="text-muted-foreground truncate flex-1">{c.productName || '—'}</span>
                    <span className="tabular-nums shrink-0">{c.qty} {c.unit || ''}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
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
