/**
 * PDA 复核作业
 * 路由：/pda/check  或  /pda/check?taskId=X
 *
 * 流程：
 *   Step 1 — 选择待复核任务（status=3 待出库）
 *   Step 2 — 扫描商品条码（PRDxxxxxx）→ 确认 checked_qty
 *   Step 3 — 提交复核 → PUT /api/warehouse-tasks/:id/check
 */
import { useState, useRef, useCallback, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { parseBarcode } from '@/utils/barcode'
import PdaScanner from '@/components/pda/PdaScanner'
import PdaHeader from '@/components/pda/PdaHeader'
import PdaCard from '@/components/pda/PdaCard'
import PdaBottomBar from '@/components/pda/PdaBottomBar'
import PdaFlash from '@/components/pda/PdaFlash'
import { PdaEmptyCard, PdaLoading } from '@/components/pda/PdaEmptyState'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getTasksApi, getTaskByIdApi, checkTaskItemsApi, checkDoneApi } from '@/api/warehouse-tasks'
import { WT_STATUS } from '@/constants/warehouseTaskStatus'
import type { WarehouseTask, WarehouseTaskItem } from '@/api/warehouse-tasks'
import { usePdaFeedback } from '@/hooks/usePdaFeedback'

// ─── 扩展 item 类型（含 checked_qty）────────────────────────────────────────
interface CheckItem extends WarehouseTaskItem {
  checkedQty: number
}

type Step = 'select-task' | 'checking' | 'done'

// ─── 任务选择页 ──────────────────────────────────────────────────────────────
function TaskSelectStep({
  onSelect,
}: {
  onSelect: (task: WarehouseTask) => void
}) {
  const navigate = useNavigate()
  const { data, isLoading } = useQuery({
    queryKey: ['pda-check-tasks'],
    queryFn: () => getTasksApi({ status: WT_STATUS.CHECKING, pageSize: 50 }).then(r => r.data.data!),
  })

  const tasks = data?.list ?? []

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PdaHeader title="选择复核任务" onBack={() => navigate('/pda')} right={<span className="text-xs text-muted-foreground">{tasks.length} 个待复核</span>} />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-md mx-auto px-4 py-4 space-y-3">
          {isLoading && <PdaLoading className="h-40" />}
          {!isLoading && tasks.length === 0 && (
            <PdaEmptyCard icon="✅" title="暂无待复核任务" description="任务完成拣货后进入此列表" />
          )}

          {tasks.map(task => {
            const total   = task.items?.reduce((s, i) => s + i.requiredQty, 0) ?? 0
            const checked = task.items?.reduce((s, i) => s + ((i as CheckItem).checkedQty ?? 0), 0) ?? 0
            const pct = total > 0 ? Math.round(checked / total * 100) : 0
            return (
              <PdaCard key={task.id} onClick={() => onSelect(task)} className="w-full text-left space-y-2">
                <div className="flex items-center justify-between">
                  <p className="font-mono text-sm font-semibold text-foreground">{task.taskNo}</p>
                  <Badge className={task.priority === 1 ? 'bg-red-100 text-red-700 border-red-200' : 'bg-orange-100 text-orange-700 border-orange-200'}>{task.priorityName}</Badge>
                </div>
                <p className="text-sm text-foreground">{task.customerName}</p>
                <p className="text-xs text-muted-foreground">{task.warehouseName}</p>
                {pct > 0 && (
                  <div>
                    <div className="flex justify-between text-xs text-muted-foreground mb-1"><span>已复核</span><span>{pct}%</span></div>
                    <div className="h-1 rounded-full bg-muted"><div className="h-1 rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} /></div>
                  </div>
                )}
              </PdaCard>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── 复核明细行 ───────────────────────────────────────────────────────────────
function CheckItemRow({
  item,
  active,
  checkedQty,
  onChange,
}: {
  item: CheckItem
  active: boolean
  checkedQty: number
  onChange: (qty: number) => void
}) {
  const done = checkedQty >= item.requiredQty

  return (
    <div className={`rounded-2xl border p-4 transition-all ${
      active
        ? 'border-primary bg-primary/5 shadow-sm'
        : done
          ? 'border-green-200 bg-green-50/50'
          : 'border-border bg-card'
    }`}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <p className="font-medium text-foreground truncate">{item.productName}</p>
          <p className="text-xs font-mono text-muted-foreground">{item.productCode}</p>
        </div>
        {done
          ? <Badge className="bg-green-100 text-green-700 border-green-200 ml-2 shrink-0">✓ 已核</Badge>
          : active
            ? <Badge className="ml-2 shrink-0">复核中</Badge>
            : null
        }
      </div>

      <div className="flex items-center gap-3 text-sm">
        <div className="text-center">
          <p className="text-xs text-muted-foreground">应拣</p>
          <p className="font-bold text-foreground">{item.requiredQty}</p>
        </div>
        <div className="h-6 w-px bg-border" />
        <div className="text-center">
          <p className="text-xs text-muted-foreground">已拣</p>
          <p className="font-semibold text-foreground">{item.pickedQty}</p>
        </div>
        <div className="h-6 w-px bg-border" />
        <div className="flex-1">
          <p className="text-xs text-muted-foreground mb-1">复核数量</p>
          <input
            type="number"
            min={0}
            step="1"
            value={checkedQty === 0 && !active ? '' : checkedQty}
            onChange={e => onChange(Math.max(0, Number(e.target.value)))}
            className={`w-full rounded-xl border px-3 py-1.5 text-right text-base font-bold outline-none transition-colors ${
              active
                ? 'border-primary bg-background text-foreground focus:ring-1 focus:ring-primary'
                : done
                  ? 'border-green-300 bg-green-50 text-green-800'
                  : 'border-input bg-background text-foreground'
            }`}
            readOnly={!active}
          />
        </div>
        <span className="text-xs text-muted-foreground shrink-0">{item.unit}</span>
      </div>
    </div>
  )
}

// ─── 主组件 ──────────────────────────────────────────────────────────────────
export default function PdaCheckPage() {
  const navigate   = useNavigate()
  const [params]   = useSearchParams()
  const qc         = useQueryClient()

  const [step, setStep]           = useState<Step>(
    params.get('taskId') ? 'checking' : 'select-task',
  )
  const [selectedTask, setSelectedTask] = useState<WarehouseTask | null>(null)
  const [checkedMap, setCheckedMap]     = useState<Record<number, number>>({})  // itemId → checkedQty
  const [activeItemId, setActiveItemId] = useState<number | null>(null)
  const [allChecked, setAllChecked]     = useState(false)

  const { flash, ok, err } = usePdaFeedback()

  // ── 加载任务详情（含 items）──────────────────────────────────────────────
  const taskId = selectedTask?.id ?? (params.get('taskId') ? Number(params.get('taskId')) : 0)

  const { data: taskDetail, isLoading: taskLoading } = useQuery({
    queryKey: ['pda-check-task', taskId],
    queryFn: () => getTaskByIdApi(taskId).then(r => r.data.data!),
    enabled: taskId > 0,
    onSuccess: (t) => {
      // 用已有的 checkedQty 初始化 map
      const init: Record<number, number> = {}
      t.items?.forEach(i => { init[i.id] = (i as CheckItem).checkedQty ?? 0 })
      setCheckedMap(init)
    },
  })

  const items: CheckItem[] = (taskDetail?.items ?? []) as CheckItem[]

  // ── 提交复核 mutation ───────────────────────────────────────────────────
  const submitMut = useMutation({
    mutationFn: () => checkTaskItemsApi(
      taskId,
      items.map(i => ({ itemId: i.id, checkedQty: checkedMap[i.id] ?? 0 })),
    ),
    onSuccess: (res) => {
      const done = res.data.data?.allChecked ?? false
      setAllChecked(done)
      qc.invalidateQueries({ queryKey: ['pda-check-tasks'] })
      setStep('done')
    },
    onError: (e: unknown) => {
      err((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '提交失败')
    },
  })

  // ── 扫码处理：扫码即自动填入并推进 ──────────────────────────────────────
  const handleScan = useCallback((raw: string) => {
    const parsed = parseBarcode(raw)
    if (parsed.type !== 'product') {
      err('必须扫描商品条码（PRDxxxxxx）')
      return
    }
    const item = items.find(i => i.productCode === raw || i.productCode === raw.toUpperCase())
    if (!item) {
      err(`商品 ${raw} 不在此任务中`)
      return
    }
    // 扫码即自动填入应拣数量（无需手动确认）
    const autoQty = item.pickedQty
    setCheckedMap(prev => ({
      ...prev,
      [item.id]: autoQty,
    }))
    setActiveItemId(item.id)
    ok(`✓ ${item.productName}：已核 ${autoQty} ${item.unit}`)

    // 检查是否全部完成，全部完成时自动提交
    const updatedMap = { ...checkedMap, [item.id]: autoQty }
    const allComplete = items.length > 0 && items.every(i => (updatedMap[i.id] ?? 0) >= i.requiredQty)
    if (allComplete) {
      setTimeout(() => submitMut.mutate(), 600)
    }
  }, [items, checkedMap, ok, err, submitMut])

  // ── 进度 ──────────────────────────────────────────────────────────────
  const totalRequired = items.reduce((s, i) => s + i.requiredQty, 0)
  const totalChecked  = items.reduce((s, i) => s + (checkedMap[i.id] ?? 0), 0)
  const pct           = totalRequired > 0 ? Math.min(100, Math.round(totalChecked / totalRequired * 100)) : 0
  const canSubmit     = items.length > 0 && items.every(i => (checkedMap[i.id] ?? 0) >= 0)
  const allDone       = items.length > 0 && items.every(i => (checkedMap[i.id] ?? 0) >= i.requiredQty)

  // ── 任务选择 ──────────────────────────────────────────────────────────
  if (step === 'select-task') {
    return (
      <TaskSelectStep
        onSelect={task => {
          setSelectedTask(task)
          setStep('checking')
        }}
      />
    )
  }

  // ── 完成页 ────────────────────────────────────────────────────────────
  if (step === 'done') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
        <div className="text-6xl mb-6">{allChecked ? '✅' : '📋'}</div>
        <h2 className="text-2xl font-bold text-foreground">
          {allChecked ? '复核完成！' : '复核已保存'}
        </h2>
        <p className="text-muted-foreground mt-2 mb-1">
          任务号：<span className="font-mono font-semibold text-foreground">{taskDetail?.taskNo}</span>
        </p>
        <p className="text-muted-foreground mb-8">
          {allChecked ? '所有商品已核验，任务进入待打包' : `已复核 ${pct}%，可继续核对`}
        </p>
        <div className="flex gap-3 w-full max-w-xs">
          {!allChecked && (
            <Button variant="outline" className="flex-1" onClick={() => setStep('checking')}>
              继续复核
            </Button>
          )}
          <Button className="flex-1" onClick={() => navigate('/pda/picking')}>
            返回任务列表
          </Button>
        </div>
      </div>
    )
  }

  // ── 复核作业页 ────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-screen flex-col bg-background">

      <PdaHeader
        title={taskDetail?.taskNo ?? '…'}
        subtitle={taskDetail?.customerName}
        onBack={() => step === 'checking' ? setStep('select-task') : navigate('/pda')}
        right={<Badge className="text-xs">复核中</Badge>}
        progress={{ current: totalChecked, total: totalRequired, label: '复核进度' }}
      />

      {/* Flash */}
      <PdaFlash flash={flash} />

      {/* 商品列表 */}
      <div className="flex-1 overflow-y-auto pb-48">
        <div className="max-w-md mx-auto px-4 py-4 space-y-3">
          {taskLoading && (
            <div className="flex h-40 items-center justify-center">
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          )}
          {items.map(item => (
            <CheckItemRow
              key={item.id}
              item={item}
              active={activeItemId === item.id}
              checkedQty={checkedMap[item.id] ?? 0}
              onChange={qty => setCheckedMap(prev => ({ ...prev, [item.id]: qty }))}
            />
          ))}
        </div>
      </div>

      <PdaBottomBar>
        <PdaScanner onScan={handleScan} placeholder="扫描商品条码 PRDxxxxxx" disabled={submitMut.isPending} />
        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={() => { setActiveItemId(null); const defaults: Record<number, number> = {}; items.forEach(i => { defaults[i.id] = i.pickedQty }); setCheckedMap(defaults); ok('已按已拣数量填入，请逐项确认') }} disabled={submitMut.isPending}>一键填入</Button>
          <Button className="flex-1" onClick={() => submitMut.mutate()} disabled={!canSubmit || submitMut.isPending}>
            {submitMut.isPending ? <span className="flex items-center gap-2"><span className="h-4 w-4 rounded-full border-2 border-primary-foreground border-t-transparent animate-spin" />提交中…</span> : allDone ? '✓ 提交复核' : '保存复核'}
          </Button>
        </div>
        {allDone && <p className="text-center text-xs text-green-600 font-medium">✓ 所有商品已核验完毕，可提交</p>}
      </PdaBottomBar>

    </div>
  )
}