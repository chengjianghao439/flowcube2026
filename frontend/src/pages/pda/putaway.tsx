/**
 * PDA 上架（收货订单）— 路由 /pda/putaway/:id
 * 扫库存条码 I → 扫货架条码 R → 调用 POST /inbound-tasks/:id/putaway
 */
import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getInboundTaskByIdApi, putawayInboundApi } from '@/api/inbound-tasks'
import PdaHeader from '@/components/pda/PdaHeader'
import PdaBottomBar from '@/components/pda/PdaBottomBar'
import PdaScanner from '@/components/pda/PdaScanner'
import PdaEmptyState, { PdaLoading } from '@/components/pda/PdaEmptyState'
import PdaFlowPanel from '@/components/pda/PdaFlowPanel'
import { usePdaFlow } from '@/hooks/usePdaFlow'
import PdaFlowSteps from '@/components/pda/PdaFlowSteps'
import { makePutawayFlow, type PutawayFlowContext } from '@/flows/putawayFlow'
import { getInboundClosureCopy } from '@/lib/inboundClosure'
import { usePdaFeedback } from '@/hooks/usePdaFeedback'
import { useCriticalPdaAction } from '@/hooks/useCriticalPdaAction'
import PdaCriticalActionNotice from '@/components/pda/PdaCriticalActionNotice'

function PutawayRunner({ taskId }: { taskId: number }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { warn, err } = usePdaFeedback()
  const { data: task } = useQuery({
    queryKey: ['pda-inbound-task', taskId],
    queryFn: () => getInboundTaskByIdApi(taskId),
    enabled: taskId > 0,
  })
  const putawayAction = useCriticalPdaAction<void>({
    action: `inbound.putaway.${taskId}`,
    label: `收货单 ${taskId} 上架`,
    onConfirmed: async () => {
      await qc.invalidateQueries({ queryKey: ['pda-inbound-task', taskId] })
      await qc.invalidateQueries({ queryKey: ['pda-inbound-tasks'] })
    },
  })
  const flowDef = useMemo(
    () =>
      makePutawayFlow(taskId, {
        onAfterPutaway: async () => {
          await qc.invalidateQueries({ queryKey: ['pda-inbound-task', taskId] })
          await qc.invalidateQueries({ queryKey: ['pda-inbound-tasks'] })
        },
        submitPutaway: async ({ taskId: nextTaskId, containerId, locationId }) => {
          const result = await putawayAction.run((requestKey) =>
            putawayInboundApi(nextTaskId, { containerId, locationId }, requestKey).then(() => undefined),
          )
          if (result.kind === 'pending') {
            throw new Error('网络中断，上架结果待确认。请先确认结果，再决定是否重试。')
          }
        },
      }),
    [taskId, qc, putawayAction],
  )

  const initialContext: PutawayFlowContext = { taskId, containerId: null }
  const engine = usePdaFlow(flowDef, initialContext, `inbound-putaway-${taskId}`)
  const closureCopy = task ? getInboundClosureCopy(task) : null

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PdaHeader
        title="扫码上架"
        subtitle={`任务 #${taskId}`}
        backLabel="← 收货订单"
        onBack={() => navigate('/pda/inbound')}
        right={<span className="text-xs text-muted-foreground">库存上架</span>}
      />

      <div className="px-4 pt-3">
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
              if (status.status === 'pending') warn('服务端仍未确认结果，请稍后再查或刷新任务状态')
              if (status.status === 'not_found') warn('未找到上次上架记录，请先刷新确认是否已落账，再手动重试')
              if (status.status === 'failed') err(status.message || '上架未成功，请检查后重试')
            })
          }}
          onClear={() => putawayAction.clearPending()}
          onDismissError={() => putawayAction.clearError()}
        />
        {closureCopy ? (
          <div className="mb-3">
            <PdaFlowPanel
              badge="上架执行中"
              title={`当前阶段：${closureCopy.stageLabel}`}
              description={closureCopy.description}
              nextAction={closureCopy.nextAction}
              stepText="先扫描库存条码，再扫描货架条码完成上架；如果发现库位不匹配或待上架数据不对，先回收货列表、异常工作台或 ERP 收货详情处理。"
              actions={[
                { label: '返回收货列表', onClick: () => navigate('/pda/inbound') },
                { label: '打开异常工作台', onClick: () => navigate('/reports/exception-workbench') },
                { label: '打开收货详情', onClick: () => navigate(`/inbound-tasks/${taskId}`) },
              ]}
            />
          </div>
        ) : null}
        <PdaFlowSteps steps={flowDef.steps} currentId={engine.stepId} />
        <p className="text-xs text-muted-foreground mt-2">{engine.currentStep.label}</p>
      </div>

      <div className="flex-1" />

      <PdaBottomBar>
        <PdaScanner
          onScan={async (code) => {
            await engine.scan(code)
            await qc.invalidateQueries({ queryKey: ['pda-inbound-tasks'] })
            await qc.invalidateQueries({ queryKey: ['inbound-tasks'] })
          }}
          placeholder={engine.currentStep.placeholder}
          disabled={engine.scanning || putawayAction.submitBlocked}
          allowManualEntry={false}
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
          icon="📤"
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
    const copy = getInboundClosureCopy(task)
    return (
      <div className="min-h-screen bg-background">
        <PdaHeader title="扫码上架" onBack={() => navigate('/pda/inbound')} />
        <PdaEmptyState
          icon="⏳"
          title={copy.stageLabel}
          description={copy.nextAction}
          actionText="返回收货订单"
          onAction={() => navigate('/pda/inbound')}
        />
      </div>
    )
  }

  if (!task.submittedAt) {
    const copy = getInboundClosureCopy(task)
    return (
      <div className="min-h-screen bg-background">
        <PdaHeader title="扫码上架" onBack={() => navigate('/pda/inbound')} />
        <PdaEmptyState
          icon="📤"
          title={copy.stageLabel}
          description={copy.nextAction}
          actionText="返回收货订单"
          onAction={() => navigate('/pda/inbound')}
        />
      </div>
    )
  }

  if (task.putawayStatus?.key === 'completed' || task.status >= 4) {
    const copy = getInboundClosureCopy(task)
    return (
      <div className="min-h-screen bg-background">
        <PdaHeader title="扫码上架" onBack={() => navigate('/pda/inbound')} />
        <PdaEmptyState
          icon="✅"
          title={copy.stageLabel}
          description={copy.nextAction}
          actionText="返回收货订单"
          onAction={() => navigate('/pda/inbound')}
        />
      </div>
    )
  }

  return <PutawayRunner taskId={taskId} />
}
