import PdaOverviewText from '@/components/pda/PdaOverviewText'
import PdaProductIdentity from '@/components/pda/PdaProductIdentity'
/**
 * PDA 拣货任务列表
 * 路由：/pda/picking
 *
 * 视图：
 *  - sku   商品汇总（默认）— 跨订单聚合同 SKU
 *  - order 订单列表         — 原有逻辑
 */
import { Package, ClipboardList } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getMyTasksApi, getMyTaskSkuSummaryApi, getTaskByIdApi, startPickingApi } from '@/api/warehouse-tasks'
import type { MyTask, PdaTaskSkuSummary } from '@/api/warehouse-tasks'
import { Button } from '@/components/ui/button'
import PdaFlash from '@/components/pda/PdaFlash'
import { usePdaFeedback } from '@/hooks/usePdaFeedback'
import { formatPdaActionError } from '@/utils/displayFormatters'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { WT_PRIORITY_TONE, WT_STATUS_TONE } from '@/constants/warehouseTaskStatus'
import PdaHeader, { PdaRefreshButton } from '@/components/pda/PdaHeader'
import PdaCard from '@/components/pda/PdaCard'
import { PdaEmptyCard, PdaLoading } from '@/components/pda/PdaEmptyState'
import { qty as formatQty } from '@/lib/format'

// ─── 常量 ─────────────────────────────────────────────────────────────────────

const PRIORITY_LABEL: Record<number, string> = { 1:'紧急', 2:'普通', 3:'低' }

// ─── 订单卡片 ─────────────────────────────────────────────────────────────────

function TaskCard({ task, onStart, starting }: { task: MyTask; onStart: () => void; starting: boolean }) {
  const pct = task.totalRequired > 0 ? Math.min(100, Math.round(task.totalPicked / task.totalRequired * 100)) : 0
  return (
    <PdaCard>
      <div className="space-y-3">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-sm font-semibold text-foreground">{task.taskNo}</p>
            <PdaOverviewText>{task.customerName || '未知客户'}</PdaOverviewText>
            <p className="text-sm text-muted-foreground">{task.warehouseName} · {task.itemCount} 种商品</p>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0 ml-2">
            <SoftStatusLabel
              label={task.statusName}
              tone={WT_STATUS_TONE[String(task.status) as keyof typeof WT_STATUS_TONE] ?? 'draft'}
            />
            <SoftStatusLabel label={PRIORITY_LABEL[task.priority]} tone={WT_PRIORITY_TONE[task.priority] ?? 'draft'} />
          </div>
        </div>
        <div>
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>拣货进度</span>
            <span>{formatQty(task.totalPicked)} / {formatQty(task.totalRequired)} ({pct}%)</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted">
            <div className="h-1.5 rounded-full transition-all"
              style={{ width: `${pct}%`, background: pct >= 100 ? 'hsl(var(--success))' : 'hsl(var(--primary))' }} />
          </div>
        </div>
        <Button size="pda" className="w-full" disabled={starting} onClick={onStart}>
          {starting ? '处理中…' : '开始拣货 →'}
        </Button>
      </div>
    </PdaCard>
  )
}

// ─── SKU 卡片 ─────────────────────────────────────────────────────────────────

function SkuCard({ sku, tasksById, onTaskSelect, startingId }: {
  sku: PdaTaskSkuSummary
  tasksById: Map<number, MyTask>
  onTaskSelect: (taskId: number) => void
  startingId: number | null
}) {
  const [expanded, setExpanded] = useState(false)
  const pct = sku.totalRequired > 0 ? Math.min(100, Math.round(sku.totalPicked / sku.totalRequired * 100)) : 0
  const remaining = Math.max(0, Math.round((sku.totalRequired - sku.totalPicked) * 100) / 100)
  const done = remaining === 0
  const multipleTasks = sku.taskIds.length > 1
  const taskOptionsById = new Map(sku.taskOptions?.map(task => [task.id, task]) ?? [])
  return (
    <PdaCard done={done} className="text-left">
      <button
        type="button"
        className="block w-full text-left active:opacity-80"
        aria-label={multipleTasks ? `选择 ${sku.productCode} 的拣货任务` : `进入 ${sku.productCode} 的拣货任务`}
        aria-expanded={multipleTasks ? expanded : undefined}
        disabled={sku.taskIds.length === 0}
        onClick={() => {
          if (multipleTasks) setExpanded(value => !value)
          else if (sku.taskIds[0]) onTaskSelect(sku.taskIds[0])
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <PdaProductIdentity code={sku.productCode} name={sku.productName} view="overview" />
          </div>
          <span className={`shrink-0 rounded-lg px-2 py-1 text-right text-xs font-semibold ${done ? 'bg-green-100 text-green-800' : 'bg-primary/10 text-primary'}`}>
            {done ? '已拣齐' : <>还需拣 {formatQty(remaining)} {sku.unit}</>}
          </span>
        </div>
        {(sku.spec || sku.color || sku.articleNumber) && (
          <div className="mt-2 space-y-0.5 text-xs leading-5 text-muted-foreground">
            {sku.spec && <p className="whitespace-normal [overflow-wrap:anywhere]">型号：{sku.spec}</p>}
            {sku.color && <p className="whitespace-normal [overflow-wrap:anywhere]">颜色：{sku.color}</p>}
            {sku.articleNumber && <p className="whitespace-normal [overflow-wrap:anywhere]">供应商型号：{sku.articleNumber}</p>}
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs">
          <span className="text-foreground">已拣 {formatQty(sku.totalPicked)} / 共需 {formatQty(sku.totalRequired)} {sku.unit}</span>
          <span className="shrink-0 text-muted-foreground">涉及 {sku.orderCount} 单</span>
        </div>
        <div className="mt-2 h-1.5 rounded-full bg-muted">
          <div className="h-1.5 rounded-full transition-all"
            style={{ width: `${pct}%`, background: done ? 'hsl(var(--success))' : 'hsl(var(--primary))' }} />
        </div>
        <p className="mt-2 text-right text-xs font-medium text-primary">
          {sku.taskIds.length === 0 ? '暂无关联任务' : multipleTasks ? (expanded ? '收起任务' : '选择任务') : '进入拣货'}
        </p>
      </button>
      {expanded && multipleTasks && (
        <div className="mt-3 max-h-64 space-y-2 overflow-y-auto border-t border-border pt-3">
          {sku.taskIds.map(taskId => {
            const task = taskOptionsById.get(taskId) ?? tasksById.get(taskId)
            return <button
              key={taskId}
              type="button"
              className="flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 py-2.5 text-left active:bg-muted"
              disabled={startingId === taskId}
              onClick={() => onTaskSelect(taskId)}
            >
              <span className="min-w-0">
                <span className="block font-mono text-sm font-semibold text-foreground whitespace-normal [overflow-wrap:anywhere]">
                  {task?.saleOrderNo ? `销售单 ${task.saleOrderNo}` : `任务 #${taskId}`}
                </span>
                <span className="block text-xs text-muted-foreground whitespace-normal [overflow-wrap:anywhere]">
                  {task ? `${task.taskNo} · ${task.customerName} · ${task.warehouseName}` : '点此读取任务信息'}
                </span>
              </span>
              {task && <SoftStatusLabel label={task.statusName} tone={WT_STATUS_TONE[String(task.status) as keyof typeof WT_STATUS_TONE] ?? 'draft'} className="shrink-0" />}
            </button>
          })}
        </div>
      )}
    </PdaCard>
  )
}

// ─── 主组件 ───────────────────────────────────────────────────────────────────

export default function PdaPickingPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [startingId, setStartingId] = useState<number | null>(null)
  const [viewMode, setViewMode] = useState<'sku' | 'order'>('sku')
  const { flash, err } = usePdaFeedback()

  // ── 任务列表 ────────────────────────────────────────────────────────────────
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['pda-my-tasks'],
    queryFn: () => getMyTasksApi().then(r => r ?? []),
    refetchInterval: 30_000,
    // 重进列表（keep-alive 下组件仍在挂载）必须立刻取一次最新状态，
    // 否则会出现「商品列表还显示已完成任务、订单列表已经没有」的自相矛盾
    //（2026-09-17 验收 ISSUE-001 / ISSUE-017）。
    refetchOnMount: 'always',
    retry: 1,
  })
  const tasks = data ?? []
  const tasksById = new Map(tasks.map(task => [task.id, task]))

  const { data: skuData, isLoading: skuLoading } = useQuery({
    queryKey: ['pda-my-task-sku-summary'],
    queryFn: () => getMyTaskSkuSummaryApi().then(r => r ?? []),
    enabled: viewMode === 'sku',
    refetchInterval: viewMode === 'sku' ? 30_000 : false,
    refetchOnMount: 'always',
    retry: 1,
  })
  const skuList = skuData ?? []

  // 「刷新」必须同时刷新订单列表与商品汇总：只刷一个就会出现两个视图数据打架
  //（2026-09-17 验收 ISSUE-001）。
  const refreshAll = async () => {
    await Promise.all([
      refetch(),
      qc.invalidateQueries({ queryKey: ['pda-my-task-sku-summary'] }),
    ])
  }

  // ── 开始/继续拣货 ──────────────────────────────────────────────────────────
  const startMut = useMutation({
    mutationFn: (id: number) => startPickingApi(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['pda-my-tasks'] })
      navigate(`/pda/task/${id}`)
    },
    onError: (error) => { err(formatPdaActionError(error, '启动拣货失败，请重试')); setStartingId(null) },
  })

  function handleTaskStart(t: Pick<MyTask, 'id' | 'status'>) {
    if (t.status !== 1 && t.status !== 2) {
      err('任务状态已变化，请刷新后重试')
      void refreshAll()
      return
    }
    setStartingId(t.id)
    // status=1（待分配）自动调用 startPicking 切换到备货中
    // status=2（备货中）直接跳转
    if (t.status === 2) navigate(`/pda/task/${t.id}`)
    else startMut.mutate(t.id)
  }

  async function handleTaskStartById(taskId: number) {
    if (startMut.isPending) return
    const knownTask = tasksById.get(taskId)
    if (knownTask) { handleTaskStart(knownTask); return }
    setStartingId(taskId)
    try {
      const detail = await getTaskByIdApi(taskId, { skipGlobalError: true })
      handleTaskStart(detail)
    } catch (error) {
      err(formatPdaActionError(error, '任务已更新，请刷新后重试'))
      setStartingId(null)
      await refreshAll()
    }
  }

  // ── 渲染 ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background">
      <PdaHeader title="拣货任务"
        onBack={() => navigate('/pda')}
        right={<PdaRefreshButton onRefresh={() => { void refreshAll() }} />}
      />
      <PdaFlash flash={flash} />

      {/* 视图切换 */}
      <div className="flex gap-2 px-4 py-2 max-w-md mx-auto">
        <Button size="sm" variant={viewMode === 'sku' ? 'default' : 'outline'} className="flex-1" onClick={() => setViewMode('sku')}>商品列表</Button>
        <Button size="sm" variant={viewMode === 'order' ? 'default' : 'outline'} className="flex-1" onClick={() => setViewMode('order')}>订单列表</Button>
      </div>

      <div className="max-w-md mx-auto px-4 pb-8 space-y-3">
        <p className="text-xs text-muted-foreground">
          {viewMode === 'sku' ? `${skuList.length} 个 SKU` : `${tasks.length} 个任务`}
        </p>

        {/* 加载中 */}
        {(isLoading || (viewMode === 'sku' && skuLoading)) && <PdaLoading className="h-32" />}

        {/* 加载失败 */}
        {isError && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-center">
            <p className="text-sm text-destructive">加载失败</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => refetch()}>重试</Button>
          </div>
        )}

        {/* SKU 视图 */}
        {viewMode === 'sku' && !isLoading && !skuLoading && !isError && (
          skuList.length === 0
            ? <PdaEmptyCard icon={<Package className="h-12 w-12 text-muted-foreground" />} title="暂无待拣商品" description="订单确认后会自动显示在这里" />
            : <div className="flex flex-col gap-3">
                {skuList.map(sku => (
                  <SkuCard
                    key={`${sku.productId}|${sku.productCode}|${sku.productName}|${sku.unit}|${sku.articleNumber ?? ''}|${sku.spec ?? ''}|${sku.color ?? ''}`}
                    sku={sku}
                    tasksById={tasksById}
                    onTaskSelect={(taskId) => { void handleTaskStartById(taskId) }}
                    startingId={startingId}
                  />
                ))}
              </div>
        )}

        {/* 订单视图 */}
        {viewMode === 'order' && !isLoading && !isError && (
          tasks.length === 0
            ? <PdaEmptyCard icon={<ClipboardList className="h-12 w-12 text-muted-foreground" />} title="暂无拣货任务" description="订单确认后会自动显示在这里" />
            : tasks.map(t => (
                <TaskCard
                  key={t.id}
                  task={t}
                  onStart={() => handleTaskStart(t)}
                  starting={startingId === t.id && startMut.isPending}
                />
              ))
        )}
      </div>
    </div>
  )
}
