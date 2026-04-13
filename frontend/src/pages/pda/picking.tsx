/**
 * PDA 拣货任务列表
 * 路由：/pda/picking
 *
 * 视图：
 *  - sku   商品汇总（默认）— 跨订单聚合同 SKU
 *  - order 订单列表         — 原有逻辑
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query'
import { getMyTasksApi, startPickingApi, getTaskByIdApi } from '@/api/warehouse-tasks'
import type { MyTask, WarehouseTaskItem } from '@/api/warehouse-tasks'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/toast'
import { Badge } from '@/components/ui/badge'
import PdaHeader, { PdaRefreshButton } from '@/components/pda/PdaHeader'
import PdaCard from '@/components/pda/PdaCard'
import { PdaEmptyCard, PdaLoading } from '@/components/pda/PdaEmptyState'
import PdaFlowPanel from '@/components/pda/PdaFlowPanel'

// ─── 常量 ─────────────────────────────────────────────────────────────────────

const STATUS_VARIANT: Record<number, 'default'|'secondary'|'outline'|'destructive'> = {
  1:'outline', 2:'default', 3:'secondary', 4:'secondary', 5:'destructive'
}
const PRIORITY_COLOR: Record<number, string> = {
  1:'text-red-600 bg-red-50 border-red-200',
  2:'text-blue-600 bg-blue-50 border-blue-200',
  3:'text-gray-500 bg-gray-50 border-gray-200',
}
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
            <p className="font-semibold text-foreground mt-0.5">{task.customerName}</p>
            <p className="text-sm text-muted-foreground">{task.warehouseName} · {task.itemCount} 种商品</p>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0 ml-2">
            <Badge variant={STATUS_VARIANT[task.status]}>{task.statusName}</Badge>
            <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${PRIORITY_COLOR[task.priority]}`}>{PRIORITY_LABEL[task.priority]}</span>
          </div>
        </div>
        <div>
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>拣货进度</span>
            <span>{task.totalPicked.toFixed(0)} / {task.totalRequired.toFixed(0)} ({pct}%)</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted">
            <div className="h-1.5 rounded-full transition-all"
              style={{ width: `${pct}%`, background: pct >= 100 ? 'hsl(var(--success))' : 'hsl(var(--primary))' }} />
          </div>
        </div>
        <Button size="lg" className="w-full" disabled={starting} onClick={onStart}>
          {starting ? '处理中…' : '开始拣货 →'}
        </Button>
      </div>
    </PdaCard>
  )
}

// ─── SKU 汇总行类型 ───────────────────────────────────────────────────────────

interface SkuSummary {
  productId: number
  productCode: string
  productName: string
  unit: string
  totalRequired: number
  totalPicked: number
  orderCount: number         // 涉及订单数
  taskIds: number[]          // 关联任务 ID（点击进入）
}

// ─── SKU 卡片 ─────────────────────────────────────────────────────────────────

function SkuCard({ sku, onTap }: { sku: SkuSummary; onTap: () => void }) {
  const pct = sku.totalRequired > 0 ? Math.min(100, Math.round(sku.totalPicked / sku.totalRequired * 100)) : 0
  const done = pct >= 100
  return (
    <PdaCard done={done} onClick={onTap}>
      <div className="space-y-2">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-foreground truncate">{sku.productName}</p>
            <p className="text-xs font-mono text-muted-foreground">{sku.productCode}</p>
          </div>
          {done
            ? <Badge className="bg-green-100 text-green-700 border-green-200 shrink-0 ml-2">✓ 已拣</Badge>
            : <Badge variant="outline" className="shrink-0 ml-2">待拣</Badge>
          }
        </div>
        <div className="flex items-center gap-4 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">总需</p>
            <p className="font-bold text-foreground">{sku.totalRequired.toFixed(0)} <span className="text-xs font-normal text-muted-foreground">{sku.unit}</span></p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">已拣</p>
            <p className="font-bold text-primary">{sku.totalPicked.toFixed(0)} <span className="text-xs font-normal text-muted-foreground">{sku.unit}</span></p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">涉及订单</p>
            <p className="font-bold text-foreground">{sku.orderCount} 单</p>
          </div>
        </div>
        <div>
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>拣货进度</span>
            <span>{pct}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted">
            <div className="h-1.5 rounded-full transition-all"
              style={{ width: `${pct}%`, background: done ? 'hsl(var(--success))' : 'hsl(var(--primary))' }} />
          </div>
        </div>
      </div>
    </PdaCard>
  )
}

// ─── 主组件 ───────────────────────────────────────────────────────────────────

export default function PdaPickingPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [startingId, setStartingId] = useState<number | null>(null)
  const [viewMode, setViewMode] = useState<'sku' | 'order'>('sku')

  // ── 任务列表 ────────────────────────────────────────────────────────────────
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['pda-my-tasks'],
    queryFn: () => getMyTasksApi().then(r => r.data.data ?? []),
    refetchInterval: 30_000, retry: 1,
  })
  const tasks = data ?? []

  // ── 任务详情（SKU 视图需要 items）─────────────────────────────────────────
  const detailQueries = useQueries({
    queries: tasks.map(t => ({
      queryKey: ['pda-task-detail', t.id],
      queryFn: () => getTaskByIdApi(t.id).then(r => r.data.data!),
      enabled: viewMode === 'sku' && tasks.length > 0,
      staleTime: 60_000,
    })),
  })

  const detailsLoading = detailQueries.some(q => q.isLoading)

  // ── SKU 汇总 ──────────────────────────────────────────────────────────────
  const skuList: SkuSummary[] = (() => {
    const map: Record<number, SkuSummary> = {}
    detailQueries.forEach((q, idx) => {
      const detail = q.data
      if (!detail?.items) return
      const taskId = tasks[idx]?.id
      detail.items.forEach((item: WarehouseTaskItem) => {
        if (!map[item.productId]) {
          map[item.productId] = {
            productId:     item.productId,
            productCode:   item.productCode,
            productName:   item.productName,
            unit:          item.unit,
            totalRequired: 0,
            totalPicked:   0,
            orderCount:    0,
            taskIds:       [],
          }
        }
        map[item.productId].totalRequired += item.requiredQty
        map[item.productId].totalPicked   += item.pickedQty
        map[item.productId].orderCount    += 1
        if (taskId && !map[item.productId].taskIds.includes(taskId)) {
          map[item.productId].taskIds.push(taskId)
        }
      })
    })
    return Object.values(map).sort((a, b) =>
      (a.totalPicked >= a.totalRequired ? 1 : 0) - (b.totalPicked >= b.totalRequired ? 1 : 0)
    )
  })()

  // ── 开始/继续拣货 ──────────────────────────────────────────────────────────
  const startMut = useMutation({
    mutationFn: (id: number) => startPickingApi(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['pda-my-tasks'] })
      navigate(`/pda/task/${id}`)
    },
    onError: () => { toast.error('操作失败'); setStartingId(null) },
  })

  function handleTaskStart(t: MyTask) {
    setStartingId(t.id)
    // status=1（待分配）自动调用 startPicking 切换到备货中
    // status=2（备货中）直接跳转
    if (t.status === 2) navigate(`/pda/task/${t.id}`)
    else startMut.mutate(t.id)
  }

  // ── 渲染 ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background">
      <PdaHeader title="拣货任务"
        onBack={() => navigate('/pda')}
        right={<PdaRefreshButton onRefresh={() => refetch()} />}
      />

      {/* 视图切换 */}
      <div className="flex gap-2 px-4 py-2 max-w-md mx-auto">
        <Button size="sm" variant={viewMode === 'sku' ? 'default' : 'outline'} className="flex-1" onClick={() => setViewMode('sku')}>商品列表</Button>
        <Button size="sm" variant={viewMode === 'order' ? 'default' : 'outline'} className="flex-1" onClick={() => setViewMode('order')}>订单列表</Button>
      </div>

      <div className="max-w-md mx-auto px-4 pb-8 space-y-3">
        <PdaFlowPanel
          badge="拣货闭环提示"
          title="拣货列表负责把待拣任务推进到待分拣，并为后续复核和打包准备正确数量"
          description="先按商品或订单挑选任务，再连续扫描库存条码完成拣货。发现库位异常、数量不对或任务卡住时，回异常工作台、仓库任务或岗位工作台继续处理。"
          nextAction="选择当前待拣任务"
          stepText="优先处理高优先级任务；拣货完成后继续去分拣，再推进复核和打包，不要跳过中间阶段。"
          actions={[
            { label: '打开仓库任务', onClick: () => navigate('/warehouse-tasks') },
            { label: '打开异常工作台', onClick: () => navigate('/reports/exception-workbench') },
            { label: '打开岗位工作台', onClick: () => navigate('/reports/role-workbench') },
          ]}
        />
        <p className="text-xs text-muted-foreground">
          {viewMode === 'sku' ? `${skuList.length} 个 SKU` : `${tasks.length} 个任务`}
        </p>

        {/* 加载中 */}
        {(isLoading || (viewMode === 'sku' && detailsLoading)) && <PdaLoading className="h-32" />}

        {/* 加载失败 */}
        {isError && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-center">
            <p className="text-sm text-destructive">加载失败</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => refetch()}>重试</Button>
          </div>
        )}

        {/* SKU 视图 */}
        {viewMode === 'sku' && !isLoading && !detailsLoading && !isError && (
          skuList.length === 0
            ? <PdaEmptyCard icon="📦" title="暂无待拣商品" description="后台确认订单后将在此显示" />
            : skuList.map(sku => (
                <SkuCard
                  key={sku.productId}
                  sku={sku}
                  onTap={() => {
                    // 跳转到第一个关联任务
                    const firstTaskId = sku.taskIds[0]
                    if (firstTaskId) navigate(`/pda/task/${firstTaskId}`)
                  }}
                />
              ))
        )}

        {/* 订单视图 */}
        {viewMode === 'order' && !isLoading && !isError && (
          tasks.length === 0
            ? <PdaEmptyCard icon="🗂️" title="暂无拣货任务" description="后台确认订单后将在此显示" />
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
