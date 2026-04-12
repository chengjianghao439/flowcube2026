/**
 * PDA 上架（收货订单）— 路由 /pda/putaway/:id
 * 扫库存条码 I → 扫货架条码 R → 调用 POST /inbound-tasks/:id/putaway
 */
import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getInboundTaskByIdApi } from '@/api/inbound-tasks'
import PdaHeader from '@/components/pda/PdaHeader'
import PdaBottomBar from '@/components/pda/PdaBottomBar'
import PdaScanner from '@/components/pda/PdaScanner'
import PdaEmptyState, { PdaLoading } from '@/components/pda/PdaEmptyState'
import { usePdaFlow } from '@/hooks/usePdaFlow'
import PdaFlowSteps from '@/components/pda/PdaFlowSteps'
import { makePutawayFlow, type PutawayFlowContext } from '@/flows/putawayFlow'
import { getInboundClosureCopy } from '@/lib/inboundClosure'

function PutawayRunner({ taskId }: { taskId: number }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const flowDef = useMemo(
    () =>
      makePutawayFlow(taskId, {
        onAfterPutaway: async () => {
          await qc.invalidateQueries({ queryKey: ['pda-inbound-task', taskId] })
          await qc.invalidateQueries({ queryKey: ['pda-inbound-tasks'] })
        },
      }),
    [taskId, qc],
  )

  const initialContext: PutawayFlowContext = { taskId, containerId: null }
  const engine = usePdaFlow(flowDef, initialContext, `inbound-putaway-${taskId}`)

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
          disabled={engine.scanning}
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
    queryFn: () => getInboundTaskByIdApi(taskId).then(r => r.data.data!),
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
