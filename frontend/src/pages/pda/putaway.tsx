/**
 * PDA 上架（收货订单）— 路由 /pda/putaway/:id
 * 扫库存条码 → 扫库位条码或输入库位编码 → 调用 POST /inbound-tasks/:id/putaway
 */
import { ArrowUpFromLine, CircleCheck, Hourglass } from 'lucide-react'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getInboundTaskByIdApi, putawayInboundApi, getInboundTaskContainersApi } from '@/api/inbound-tasks'
import PdaHeader from '@/components/pda/PdaHeader'
import PdaBottomBar from '@/components/pda/PdaBottomBar'
import PdaScanner from '@/components/pda/PdaScanner'
import PdaEmptyState, { PdaLoading } from '@/components/pda/PdaEmptyState'
import { usePdaFlow } from '@/hooks/usePdaFlow'
import PdaFlowSteps from '@/components/pda/PdaFlowSteps'
import PdaFlash from '@/components/pda/PdaFlash'
import { makePutawayFlow, type PutawayFlowContext } from '@/flows/putawayFlow'

import { usePdaFeedback } from '@/hooks/usePdaFeedback'
import { useCriticalPdaAction } from '@/hooks/useCriticalPdaAction'
import PdaCriticalActionNotice from '@/components/pda/PdaCriticalActionNotice'

function PutawayRunner({ taskId }: { taskId: number }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { warn, err, flash } = usePdaFeedback()
  const resetScanner = useRef<(() => void) | null>(null)
  const putawayAction = useCriticalPdaAction<void>({
    action: `inbound.putaway.${taskId}`,
    label: `收货单 ${taskId} 上架`,
    onConfirmed: async () => {
      // 刷新后若没有待上架箱，扫码组件会卸载；先清掉已完成箱的本地扫码草稿。
      resetScanner.current?.()
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['pda-inbound-task', taskId] }),
        qc.invalidateQueries({ queryKey: ['pda-inbound-tasks'] }),
        qc.invalidateQueries({ queryKey: ['inbound-tasks'] }),
      ])
    },
    // 网络波动导致提交结果不明时，用目标容器是否已经离开"待上架"清单来核实
    // 上一次上架请求是否其实已经生效，而不是让用户只能凭经验决定要不要重试。
    resolveServerState: async ({ record }) => {
      const containerId = Number(record.metadata?.containerId ?? 0)
      if (!containerId) return { effective: false }
      const containers = await getInboundTaskContainersApi(taskId, { skipGlobalError: true })
      if (containers.waiting.some((c) => c.id === containerId)) return { effective: false }
      const stored = containers.stored.find((c) => c.id === containerId)
      if (!stored) return { effective: false }
      return {
        effective: true,
        data: undefined,
        message: stored.locationCode ? `库存条码已上架到库位 ${stored.locationCode}。` : '库存条码已完成上架。',
      }
    },
  })
  const flowDef = useMemo(
    () =>
      makePutawayFlow({
        submitPutaway: async ({ taskId: nextTaskId, containerId, locationId, deviatedFromSuggestion, suggestedLocationCode }) => {
          const result = await putawayAction.run(
            (requestKey) => putawayInboundApi(nextTaskId, { containerId, locationId, deviatedFromSuggestion, suggestedLocationCode }, requestKey).then(() => undefined),
            { containerId },
          )
          if (result.kind === 'pending') {
            throw new Error('网络中断，上架结果待确认。请先确认结果，再决定是否重试。')
          }
        },
      }),
    [putawayAction],
  )

  const initialContext = useMemo<PutawayFlowContext>(() => ({ taskId, containerId: null }), [taskId])
  const engine = usePdaFlow<PutawayFlowContext>(flowDef, initialContext, `inbound-putaway-${taskId}`)
  useLayoutEffect(() => {
    resetScanner.current = engine.reset
    return () => { resetScanner.current = null }
  }, [engine.reset])

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PdaHeader
        title="扫码上架"
        subtitle={`任务 #${taskId}`}
        backLabel="← 收货订单"
        onBack={() => navigate('/pda/inbound')}
        right={<span className="text-xs text-muted-foreground">库存上架</span>}
      />

      <div className="max-w-md mx-auto px-4 pt-3 w-full">
        <PdaCriticalActionNotice
          blockedReason={putawayAction.blockedReason}
          pendingRecord={putawayAction.pendingRecord}
          confirming={putawayAction.confirming}
          phase={putawayAction.phase}
          phaseMessage={putawayAction.phaseMessage}
          lastErrorMessage={putawayAction.lastErrorMessage}
          onConfirm={() => {
            void putawayAction.confirmPending().then((status) => {
              if (!status) return
              if (status.status === 'pending') warn(status.message || '系统还未确认结果，请稍后再查或刷新任务状态')
              if (status.status === 'state_unconfirmed') warn(status.message)
              if (status.status === 'not_found') warn(status.message || '未找到上次上架记录；请先刷新确认是否已落账，再手动重试')
              if (status.status === 'failed') err(status.message || '上架未成功，请检查后重试')
            })
          }}
          onClear={() => putawayAction.clearPending()}
          onDismissError={() => putawayAction.clearError()}
        />
        <PdaFlowSteps steps={flowDef.steps} currentId={engine.stepId} />
        <p className="text-xs text-muted-foreground mt-2">
          {engine.stepId === 'scan-location' ? '使用本仓的库位标签（如 R000123），也可手动输入库位编码。' : engine.currentStep.label}
        </p>
        {/*
          偏离推荐库位需要「同一库位连扫两次」确认，此前只弹一条一闪而过的提示，
          现场很容易当成扫了没反应（2026-09-17 验收 ISSUE-014）。这里把待确认状态
          常驻显示，直到再扫一次或改扫推荐库位。
        */}
        {engine.context.deviationArmedCode ? (
          <div className="mt-3 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-xs text-warning-ink">
            <p className="font-semibold">与推荐库位不同，需要再扫一次确认</p>
            <p className="mt-1">
              已扫库位 <span className="font-mono">{engine.context.deviationArmedCode}</span>
              {engine.context.suggestedLocations?.[0]?.locationCode
                ? <>，建议库位 <span className="font-mono">{engine.context.suggestedLocations[0].locationCode}</span></>
                : null}
              。请再次扫描或输入同一库位以确认，也可改用建议库位的条码或编码。
            </p>
          </div>
        ) : null}
      </div>

      <div className="flex-1" />

      <PdaBottomBar>
        {(flash ?? engine.flash) && (
          <div className="[&>*]:mx-0 [&>*]:mt-0"><PdaFlash flash={flash ?? engine.flash} /></div>
        )}
        <PdaScanner
          key={engine.stepId}
          allowIntentionalRepeat={engine.stepId === 'scan-location' && !!engine.context.deviationArmedCode}
          onScan={engine.scan}
          placeholder={engine.currentStep.placeholder}
          disabled={engine.scanning || putawayAction.submitBlocked}
          busy={engine.scanning}
        />
      </PdaBottomBar>
    </div>
  )
}

export default function PdaPutawayPage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id?: string }>()
  const taskId = id ? Number(id) : 0

  const { data: task, isLoading, isError, refetch } = useQuery({
    queryKey: ['pda-inbound-task', taskId],
    queryFn: () => getInboundTaskByIdApi(taskId),
    enabled: taskId > 0,
  })

  if (!taskId) {
    return (
      <div className="min-h-screen bg-background">
        <PdaHeader title="扫码上架" onBack={() => navigate('/pda/inbound')} />
        <PdaEmptyState
          icon={<ArrowUpFromLine className="h-12 w-12 text-muted-foreground" />}
          title="请选择上架任务"
          description="请先从收货订单列表进入待上架任务。"
          actionText="返回收货订单"
          onAction={() => navigate('/pda/inbound')}
        />
      </div>
    )
  }

  if (isError || (!isLoading && !task)) {
    return <div className="min-h-screen bg-background">
      <PdaHeader title="扫码上架" onBack={() => navigate('/pda/inbound')} />
      <PdaEmptyState title="加载失败" description="上架任务暂时无法读取，请检查网络后重试" actionText="重试" onAction={() => { void refetch() }} />
    </div>
  }

  if (isLoading || !task) {
    return (
      <div className="min-h-screen bg-background">
        <PdaHeader title="扫码上架" onBack={() => navigate('/pda/inbound')} />
        <PdaLoading className="h-40 mt-8" />
      </div>
    )
  }

  if (task.status === 1) {
    return (
      <div className="min-h-screen bg-background">
        <PdaHeader title="扫码上架" onBack={() => navigate('/pda/inbound')} />
        <PdaEmptyState
          icon={<Hourglass className="h-12 w-12 text-muted-foreground" />}
          title="尚未收货"
          description="这张收货单还没有开始收货，请先到收货页登记实收数量，已收到的货即可扫码上架。"
          actionText="返回收货订单"
          onAction={() => navigate('/pda/inbound')}
        />
      </div>
    )
  }

  if (!task.submittedAt) {
    return (
      <div className="min-h-screen bg-background">
        <PdaHeader title="扫码上架" onBack={() => navigate('/pda/inbound')} />
        <PdaEmptyState
          icon={<ArrowUpFromLine className="h-12 w-12 text-muted-foreground" />}
          title="未提交"
          description="收货订单尚未提交，请先在 ERP 中提交。"
          actionText="返回收货订单"
          onAction={() => navigate('/pda/inbound')}
        />
      </div>
    )
  }

  if (task.status === 4 || task.status === 5) {
    return (
      <div className="min-h-screen bg-background">
        <PdaHeader title="扫码上架" onBack={() => navigate('/pda/inbound')} />
        <PdaEmptyState
          icon={<CircleCheck className="h-12 w-12 text-muted-foreground" />}
          title={task.status === 5 ? '已取消' : '已完成'}
          description={task.status === 5 ? '该收货订单已取消，不能继续上架。' : '该订单上架已完成。'}
          actionText="返回收货订单"
          onAction={() => navigate('/pda/inbound')}
        />
      </div>
    )
  }

  if (task.status === 2 && (task.putawaySummary?.waitingContainers ?? 0) === 0) {
    return <div className="min-h-screen bg-background">
      <PdaHeader title="扫码上架" onBack={() => navigate('/pda/inbound')} />
      <PdaEmptyState title="暂无待上架货物" description="已收到的货已全部上架，仍可继续收货" actionText="继续收货" onAction={() => navigate(`/pda/receive/${taskId}`)} />
    </div>
  }
  return <PutawayRunner key={taskId} taskId={taskId} />
}
