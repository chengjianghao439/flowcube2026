/**
 * PDA 复核作业
 * 路由：/pda/check  或  /pda/check?taskId=X
 *
 * 须扫描拣货阶段使用过的库存条码 / 塑料盒条码（I/B，兼容旧版 CNT），由后端按库存单元累加 checked_qty；禁止手填。
 */
import { useState, useCallback } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
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
import { getTasksApi, getTaskByIdApi, submitCheckScanApi } from '@/api/warehouse-tasks'
import { WT_STATUS } from '@/constants/warehouseTaskStatus'
import type { WarehouseTask, WarehouseTaskItem } from '@/api/warehouse-tasks'
import { usePdaFeedback } from '@/hooks/usePdaFeedback'
import { useCriticalPdaAction } from '@/hooks/useCriticalPdaAction'
import PdaCriticalActionNotice from '@/components/pda/PdaCriticalActionNotice'
import { stateConfirmedMessage, taskReachedStatus } from '@/lib/pdaCriticalState'

interface CheckItem extends WarehouseTaskItem {
  checkedQty: number
}

type Step = 'select-task' | 'checking' | 'done'

function readPositiveId(value: string | undefined | null): number {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : 0
}

function PdaTaskState({
  title,
  description,
  actionText,
  onAction,
  secondaryText,
  onSecondary,
}: {
  title: string
  description: string
  actionText: string
  onAction: () => void
  secondaryText?: string
  onSecondary?: () => void
}) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PdaHeader title={title} onBack={onAction} />
      <div className="flex-1 px-4 py-10">
        <div className="mx-auto max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
          <p className="mb-4 text-5xl">⚠️</p>
          <h2 className="text-lg font-bold text-foreground">{title}</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
          <div className="mt-6 flex gap-3">
            {secondaryText && onSecondary ? (
              <Button variant="outline" className="flex-1" onClick={onSecondary}>
                {secondaryText}
              </Button>
            ) : null}
            <Button className="flex-1" onClick={onAction}>
              {actionText}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function TaskSelectStep({
  onSelect,
}: {
  onSelect: (task: WarehouseTask) => void
}) {
  const navigate = useNavigate()
  const { data, isLoading } = useQuery({
    queryKey: ['pda-check-tasks'],
    queryFn: () => getTasksApi({ status: WT_STATUS.CHECKING, pageSize: 50 }),
  })

  const tasks = data?.list ?? []

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PdaHeader title="选择复核任务" onBack={() => navigate('/pda')} right={<span className="text-xs text-muted-foreground">{tasks.length} 个待复核</span>} />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-md mx-auto px-4 py-4 space-y-3">

          {isLoading && <PdaLoading className="h-40" />}
          {!isLoading && tasks.length === 0 && (
            <PdaEmptyCard icon="✅" title="暂无待复核任务" description="任务完成分拣后进入此列表" />
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

function CheckItemRow({ item }: { item: CheckItem }) {
  const checkedQty = item.checkedQty ?? 0
  const matchPick  = checkedQty === item.pickedQty && item.pickedQty > 0
  const done       = matchPick

  return (
    <div className={`rounded-2xl border p-4 transition-all ${
      done ? 'border-green-200 bg-green-50/50' : 'border-border bg-card'
    }`}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <p className="font-medium text-foreground truncate">{item.productName}</p>
          <p className="text-xs font-mono text-muted-foreground">{item.productCode}</p>
        </div>
        {done
          ? <Badge className="bg-green-100 text-green-700 border-green-200 ml-2 shrink-0">✓ 已核满</Badge>
          : null}
      </div>

      <div className="flex items-center gap-3 text-sm">
        <div className="text-center">
          <p className="text-xs text-muted-foreground">需求</p>
          <p className="font-bold text-foreground">{item.requiredQty}</p>
        </div>
        <div className="h-6 w-px bg-border" />
        <div className="text-center">
          <p className="text-xs text-muted-foreground">已拣</p>
          <p className="font-semibold text-foreground">{item.pickedQty}</p>
        </div>
        <div className="h-6 w-px bg-border" />
        <div className="text-center flex-1">
          <p className="text-xs text-muted-foreground">已核</p>
          <p className="font-bold text-primary">{checkedQty}</p>
        </div>
        <span className="text-xs text-muted-foreground shrink-0">{item.unit}</span>
      </div>
    </div>
  )
}

export default function PdaCheckPage() {
  const navigate   = useNavigate()
  const [params]   = useSearchParams()
  const routeParams = useParams()
  const qc         = useQueryClient()
  const routeTaskId = readPositiveId(routeParams.id) || readPositiveId(params.get('taskId'))

  const [step, setStep]           = useState<Step>(
    routeTaskId ? 'checking' : 'select-task',
  )
  const [selectedTask, setSelectedTask] = useState<WarehouseTask | null>(null)
  const [allChecked, setAllChecked]     = useState(false)
  const taskId = selectedTask?.id ?? routeTaskId

  const { flash, ok, err, warn } = usePdaFeedback()
  const checkAction = useCriticalPdaAction<{
    allChecked: boolean
  }>({
    action: `warehouse.check-scan.${taskId}`,
    requestAction: 'scan-log.check',
    label: `复核任务 ${taskId}`,
    onConfirmed: async (payload) => {
      await qc.invalidateQueries({ queryKey: ['pda-check-task', taskId] })
      await qc.invalidateQueries({ queryKey: ['pda-check-tasks'] })
      if (payload.allChecked) {
        setAllChecked(true)
        setStep('done')
        ok('✓ 复核完成')
      } else {
        ok('✓ 已记录复核扫码')
      }
    },
    resolveServerState: async () => {
      const latest = await getTaskByIdApi(taskId)
      if (taskReachedStatus(latest, WT_STATUS.PACKING)) {
        return {
          effective: true,
          data: { allChecked: true },
          message: stateConfirmedMessage(`复核任务 ${taskId}`, latest.statusName),
        }
      }
      return { effective: false }
    },
  })

  const { data: taskDetail, isLoading: taskLoading, isError: taskError, error: taskLoadError } = useQuery({
    queryKey: ['pda-check-task', taskId],
    queryFn: () => getTaskByIdApi(taskId),
    enabled: taskId > 0,
  })

  const items: CheckItem[] = (taskDetail?.items ?? []) as CheckItem[]

  const scanMut = useMutation({
    mutationFn: async (barcode: string) => {
      if (!taskDetail) throw new Error('任务数据仍在加载，请稍后重试')
      if (taskDetail.status !== WT_STATUS.CHECKING) throw new Error('当前任务不是待复核状态，不能执行复核扫码')
      const result = await checkAction.run((requestKey) =>
        submitCheckScanApi(taskId, barcode, requestKey).then((res) => res!),
      )
      return result
    },
    onSuccess: (result) => {
      if (result.kind === 'pending') {
        warn('网络中断，复核结果待确认。请先确认结果，避免重复扫码。')
      }
    },
    onError: (e: unknown) => {
      err((e as { message?: string })?.message ?? '复核扫码失败')
    },
  })

  const handleScan = useCallback((raw: string) => {
    const b = raw.trim()
    if (!b) return
    if (taskLoading) {
      err('任务数据加载中，请稍后扫码')
      return
    }
    if (!taskDetail) {
      err('任务不存在或加载失败，请返回任务列表重新选择')
      return
    }
    if (taskDetail.status !== WT_STATUS.CHECKING) {
      err(`当前任务状态为「${taskDetail.statusName}」，不能执行复核`)
      return
    }
    if (parseBarcode(b).type !== 'container') {
      err('扫描库存条码')
      return
    }
    scanMut.mutate(b)
  }, [err, scanMut, taskDetail, taskLoading])

  const totalPick   = items.reduce((s, i) => s + i.pickedQty, 0)
  const totalChecked = items.reduce((s, i) => s + (i.checkedQty ?? 0), 0)
  const pct         = totalPick > 0 ? Math.min(100, Math.round(totalChecked / totalPick * 100)) : 0
  const linesDone   = items.length > 0 && items.every(i => (i.checkedQty ?? 0) === i.pickedQty)

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

  if (taskId <= 0) {
    return (
      <PdaTaskState
        title="缺少复核任务"
        description="当前页面没有有效任务号，请从待复核任务列表重新选择。"
        actionText="选择任务"
        onAction={() => setStep('select-task')}
        secondaryText="返回工作台"
        onSecondary={() => navigate('/pda')}
      />
    )
  }

  if (taskLoading) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <PdaHeader title="复核作业" onBack={() => setStep('select-task')} />
        <div className="flex flex-1 items-center justify-center">
          <div className="space-y-3 text-center">
            <PdaLoading className="h-10" />
            <p className="text-sm text-muted-foreground">正在加载任务数据…</p>
          </div>
        </div>
      </div>
    )
  }

  if (taskError || !taskDetail) {
    return (
      <PdaTaskState
        title="复核任务不存在"
        description={(taskLoadError as { message?: string })?.message || `未找到任务 #${taskId}，请确认任务是否已被删除或状态已变化。`}
        actionText="选择其他任务"
        onAction={() => setStep('select-task')}
        secondaryText="返回工作台"
        onSecondary={() => navigate('/pda')}
      />
    )
  }

  if (step !== 'done' && taskDetail.status !== WT_STATUS.CHECKING) {
    return (
      <PdaTaskState
        title="当前任务不能复核"
        description={`任务 ${taskDetail.taskNo} 当前状态为「${taskDetail.statusName}」。复核页只允许处理「待复核」任务，请选择其他待复核任务。`}
        actionText="选择其他任务"
        onAction={() => setStep('select-task')}
        secondaryText="返回工作台"
        onSecondary={() => navigate('/pda')}
      />
    )
  }

  if (step === 'done') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
        <div className="text-6xl mb-6">{allChecked ? '✅' : '📋'}</div>
        <h2 className="text-2xl font-bold text-foreground">
          {allChecked ? '复核完成！' : '已保存'}
        </h2>
        <p className="text-muted-foreground mt-2 mb-1">
          任务号：<span className="font-mono font-semibold text-foreground">{taskDetail?.taskNo}</span>
        </p>
        <p className="text-muted-foreground mb-8">
          {allChecked ? '任务已进入待打包' : `进度约 ${pct}%`}
        </p>
        <div className="flex gap-3 w-full max-w-xs">
          {!allChecked && (
            <Button variant="outline" className="flex-1" onClick={() => setStep('checking')}>
              继续复核
            </Button>
          )}
          <Button variant="outline" className="flex-1" onClick={() => setStep('select-task')}>
            选择任务
          </Button>
          <Button className="flex-1" onClick={() => navigate(allChecked ? '/pda/pack' : '/pda')}>
            {allChecked ? '去打包' : '返回工作台'}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">

      <PdaHeader
        title={taskDetail?.taskNo ?? '…'}
        subtitle={taskDetail?.customerName}
        onBack={() => step === 'checking' ? setStep('select-task') : navigate('/pda')}
        right={<Badge className="text-xs">复核中</Badge>}
        progress={{ current: totalChecked, total: totalPick || 1, label: '复核进度（对已拣）' }}
      />

      <PdaFlash flash={flash} />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-md mx-auto px-4 py-4 space-y-3">
          <PdaCriticalActionNotice
            blockedReason={checkAction.blockedReason}
            pendingRecord={checkAction.pendingRecord}
            confirming={checkAction.confirming}
            phase={checkAction.phase}
            phaseMessage={checkAction.phaseMessage}
            lastErrorMessage={checkAction.lastErrorMessage}
            onConfirm={() => {
              void checkAction.confirmPending().then((status) => {
                if (!status) return
                if (status.status === 'pending') warn(status.message || '服务端仍未确认结果，请稍后再查')
                if (status.status === 'state_unconfirmed') warn(status.message)
                if (status.status === 'not_found') warn(status.message || '未找到上次复核记录；请刷新任务后再决定是否重扫')
                if (status.status === 'failed') err(status.message || '上次复核未成功，请检查后重试')
              })
            }}
            onClear={() => checkAction.clearPending()}
            onDismissError={() => checkAction.clearError()}
          />

          {taskLoading && (
            <div className="flex h-40 items-center justify-center">
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          )}
          {items.map(item => (
            <CheckItemRow key={item.id} item={item} />
          ))}
          {!taskLoading && items.length > 0 && linesDone && (
            <p className="text-center text-xs text-green-600 font-medium">✓ 各明细已核数量已与拣货一致</p>
          )}
        </div>
      </div>

      <PdaBottomBar>
        <PdaScanner onScan={handleScan} placeholder="扫描库存条码" disabled={scanMut.isPending || checkAction.submitBlocked} />
      </PdaBottomBar>

    </div>
  )
}
