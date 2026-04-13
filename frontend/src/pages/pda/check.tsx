/**
 * PDA 复核作业
 * 路由：/pda/check  或  /pda/check?taskId=X
 *
 * 须扫描拣货阶段使用过的库存条码 / 塑料盒条码（I/B，兼容旧版 CNT），由后端按库存单元累加 checked_qty；禁止手填。
 */
import { useState, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { parseBarcode } from '@/utils/barcode'
import PdaScanner from '@/components/pda/PdaScanner'
import PdaHeader from '@/components/pda/PdaHeader'
import PdaCard from '@/components/pda/PdaCard'
import PdaBottomBar from '@/components/pda/PdaBottomBar'
import PdaFlash from '@/components/pda/PdaFlash'
import { PdaEmptyCard, PdaLoading } from '@/components/pda/PdaEmptyState'
import PdaFlowPanel from '@/components/pda/PdaFlowPanel'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getTasksApi, getTaskByIdApi, submitCheckScanApi } from '@/api/warehouse-tasks'
import { WT_STATUS } from '@/constants/warehouseTaskStatus'
import type { WarehouseTask, WarehouseTaskItem } from '@/api/warehouse-tasks'
import { usePdaFeedback } from '@/hooks/usePdaFeedback'

interface CheckItem extends WarehouseTaskItem {
  checkedQty: number
}

type Step = 'select-task' | 'checking' | 'done'

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
          <PdaFlowPanel
            badge="复核闭环提示"
            title="复核页负责确认“已拣数量”和“已核数量”一致，再把任务推进到待打包"
            description="先选任务，再连续扫库存条码完成复核。若发现任务卡住、分拣未完成或数量不一致，回仓库任务、PDA 分拣或异常工作台继续处理。"
            nextAction="选择待复核任务"
            stepText="先确认任务已经完成分拣，再做复核扫码；复核完成后继续打包，不要绕过待打包阶段直接出库。"
            actions={[
              { label: '打开仓库任务', onClick: () => navigate('/warehouse-tasks') },
              { label: '打开 PDA 分拣', onClick: () => navigate('/pda/sort') },
              { label: '打开异常工作台', onClick: () => navigate('/reports/exception-workbench') },
            ]}
          />

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
  const qc         = useQueryClient()

  const [step, setStep]           = useState<Step>(
    params.get('taskId') ? 'checking' : 'select-task',
  )
  const [selectedTask, setSelectedTask] = useState<WarehouseTask | null>(null)
  const [allChecked, setAllChecked]     = useState(false)

  const { flash, ok, err } = usePdaFeedback()

  const taskId = selectedTask?.id ?? (params.get('taskId') ? Number(params.get('taskId')) : 0)

  const { data: taskDetail, isLoading: taskLoading } = useQuery({
    queryKey: ['pda-check-task', taskId],
    queryFn: () => getTaskByIdApi(taskId).then(r => r.data.data!),
    enabled: taskId > 0,
  })

  const items: CheckItem[] = (taskDetail?.items ?? []) as CheckItem[]

  const scanMut = useMutation({
    mutationFn: (barcode: string) => submitCheckScanApi(taskId, barcode),
    onSuccess: async (res) => {
      const payload = res.data.data
      const done = payload?.allChecked ?? false
      await qc.invalidateQueries({ queryKey: ['pda-check-task', taskId] })
      await qc.invalidateQueries({ queryKey: ['pda-check-tasks'] })
      if (done) {
        setAllChecked(true)
        setStep('done')
        ok('✓ 复核完成')
      } else {
        ok('✓ 已记录复核扫码')
      }
    },
    onError: (e: unknown) => {
      err((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '复核扫码失败')
    },
  })

  const handleScan = useCallback((raw: string) => {
    const b = raw.trim()
    if (!b) return
    if (parseBarcode(b).type !== 'container') {
      err('扫描库存条码')
      return
    }
    scanMut.mutate(b)
  }, [err, scanMut])

  const totalPick   = items.reduce((s, i) => s + i.pickedQty, 0)
  const totalChecked = items.reduce((s, i) => s + (i.checkedQty ?? 0), 0)
  const pct         = totalPick > 0 ? Math.min(100, Math.round(totalChecked / totalPick * 100)) : 0
  const linesDone   = items.length > 0 && items.every(i => (i.checkedQty ?? 0) === i.pickedQty)
  const phaseCopy = linesDone
    ? {
        stage: '复核收口',
        description: '当前各明细已核数量已与拣货一致，可以结束复核并推进到待打包。',
        nextAction: '确认复核完成并进入待打包',
      }
    : {
        stage: '复核进行中',
        description: '当前优先连续扫描库存条码，让已核数量追平已拣数量。发现缺少分拣或数量不一致时，回分拣或异常入口继续处理。',
        nextAction: '继续扫描库存条码',
      }

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
          <Button variant="outline" className="flex-1" onClick={() => navigate('/warehouse-tasks')}>
            仓库任务
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
          <PdaFlowPanel
            badge="复核闭环提示"
            title={phaseCopy.stage}
            description={phaseCopy.description}
            nextAction={phaseCopy.nextAction}
            stepText="先追平复核数量，再结束当前任务；复核完成后优先去 PDA 打包，异常时回仓库任务和异常工作台。"
            actions={[
              { label: '打开仓库任务', onClick: () => navigate('/warehouse-tasks') },
              { label: '打开 PDA 打包', onClick: () => navigate('/pda/pack') },
              { label: '打开异常工作台', onClick: () => navigate('/reports/exception-workbench') },
            ]}
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
        <PdaScanner onScan={handleScan} placeholder="扫描库存条码" disabled={scanMut.isPending} />
      </PdaBottomBar>

    </div>
  )
}
