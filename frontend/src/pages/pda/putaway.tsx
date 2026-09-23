/**
 * PDA 上架（收货订单）— 路由 /pda/putaway/:id
 * 扫库存条码 I → 扫货架条码 R → 调用 POST /inbound-tasks/:id/putaway
 */
import { ArrowUpFromLine, CircleCheck, Hourglass } from 'lucide-react'
import { useMemo } from 'react'
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
  const putawayAction = useCriticalPdaAction<void>({
    action: `inbound.putaway.${taskId}`,
    label: `收货单 ${taskId} 上架`,
    onConfirmed: async () => {
      await qc.invalidateQueries({ queryKey: ['pda-inbound-task', taskId] })
      await qc.invalidateQueries({ queryKey: ['pda-inbound-tasks'] })
    },
    // 网络波动导致提交结果不明时，用目标容器是否已经离开"待上架"清单来核实
    // 上一次上架请求是否其实已经生效，而不是让用户只能凭经验决定要不要重试。
    resolveServerState: async ({ record }) => {
      const containerId = Number(record.metadata?.containerId ?? 0)
      if (!containerId) return { effective: false }
      const containers = await getInboundTaskContainersApi(taskId)
      if (containers.waiting.some((c) => c.id === containerId)) return { effective: false }
      const stored = containers.stored.find((c) => c.id === containerId)
      if (!stored) return { effective: false }
      return {
        effective: true,
        data: undefined,
        message: `上架已成功，库存条码已上架到货架 ${stored.locationCode ?? ''}。`,
      }
    },
  })
  const flowDef = useMemo(
    () =>
      makePutawayFlow({
        onAfterPutaway: async () => {
          await qc.invalidateQueries({ queryKey: ['pda-inbound-task', taskId] })
          await qc.invalidateQueries({ queryKey: ['pda-inbound-tasks'] })
          await qc.invalidateQueries({ queryKey: ['inbound-tasks'] })
        },
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
    [taskId, qc, putawayAction],
  )

  const initialContext: PutawayFlowContext = { taskId, containerId: null }
  const engine = usePdaFlow<PutawayFlowContext>(flowDef, initialContext, `inbound-putaway-${taskId}`)

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PdaHeader
        title="扫码上架"
        subtitle={`任务 #${taskId}`}
        backLabel="← 收货订单"
        onBack={() => navigate('/pda/inbound')}
        right={<span className="text-xs text-muted-foreground">库存上架</span>}
      />

      <PdaFlash flash={engine.flash} />
      <PdaFlash flash={flash} />

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
        <p className="text-xs text-muted-foreground mt-2">{engine.currentStep.label}</p>
        {/*
          偏离推荐库位需要「同一库位连扫两次」确认，此前只弹一条一闪而过的提示，
          现场很容易当成扫了没反应（2026-09-17 验收 ISSUE-014）。这里把待确认状态
          常驻显示，直到再扫一次或改扫推荐库位。
        */}
        {engine.context.deviationArmedCode ? (
          <div className="mt-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-800">
            <p className="font-semibold">与推荐库位不同，需要再扫一次确认</p>
            <p className="mt-1">
              已扫库位 <span className="font-mono">{engine.context.deviationArmedCode}</span>
              {engine.context.suggestedLocations?.[0]?.locationCode
                ? <>，建议库位 <span className="font-mono">{engine.context.suggestedLocations[0].locationCode}</span></>
                : null}
              。确认放到该库位请再扫一次同一库位条码；改放建议库位则直接扫建议库位条码。
            </p>
          </div>
        ) : null}
      </div>

      <div className="flex-1" />

      <PdaBottomBar>
        <PdaScanner
          onScan={async (code) => {
            // 扫容器只是校验步骤、无服务端副作用；真正的上架落库发生在扫库位
            // 那一步，查询失效已经在 onAfterPutaway 里做了，这里不用重复触发。
            await engine.scan(code)
          }}
          placeholder={engine.currentStep.placeholder}
          disabled={engine.scanning || putawayAction.submitBlocked}
        />
      </PdaBottomBar>
    </div>
  )
}

export default function PdaPutawayPage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id?: string }>()
  const taskId = id ? Number(id) : 0

  const { data: task, isLoading } = useQuery({
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

  if (isLoading || !task) {
    return (
      <div className="min-h-screen bg-background">
        <PdaHeader title="扫码上架" onBack={() => navigate('/pda/inbound')} />
        <PdaLoading className="h-40 mt-8" />
      </div>
    )
  }

  if (task.status < 3) {
    return (
      <div className="min-h-screen bg-background">
        <PdaHeader title="扫码上架" onBack={() => navigate('/pda/inbound')} />
        <PdaEmptyState
          icon={<Hourglass className="h-12 w-12 text-muted-foreground" />}
          title="收货尚未完成"
          // 状态 1 还没收过货，短装结案要求已有实收数量，这里不能给这条出路
          description={task.status === 1
            ? '这张收货单还没有开始收货，请先到收货页登记实收数量，全部收满后才能上架。'
            : '全部收满后才能上架。供应商少发货时，请在 ERP 端对这张收货单做「短装结案」，剩余未收量作罢，即可上架已收到的部分。'}
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

  if (task.putawayStatus?.key === 'completed' || task.status >= 4) {
    return (
      <div className="min-h-screen bg-background">
        <PdaHeader title="扫码上架" onBack={() => navigate('/pda/inbound')} />
        <PdaEmptyState
          icon={<CircleCheck className="h-12 w-12 text-muted-foreground" />}
          title="已完成"
          description="该订单上架已完成。"
          actionText="返回收货订单"
          onAction={() => navigate('/pda/inbound')}
        />
      </div>
    )
  }

  return <PutawayRunner taskId={taskId} />
}
