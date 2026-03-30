/**
 * PDA 上架（收货订单）— 路由 /pda/putaway/:id
 * 扫容器 CNT → 扫库位 LOC → 调用 POST /inbound-tasks/:id/putaway
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
        title="上架入库"
        subtitle={`任务 #${taskId}`}
        backLabel="← 收货订单"
        onBack={() => navigate('/pda/inbound')}
        right={<span className="text-xs text-muted-foreground">上架</span>}
      />

      <div className="px-4 pt-3">
        <PdaFlowSteps steps={flowDef.steps} currentId={engine.stepId} />
        <p className="text-xs text-muted-foreground mt-2">{engine.currentStep.label}</p>
      </div>

      <div className="flex-1 px-4 py-6 text-sm text-muted-foreground space-y-2">
        <p className="text-amber-600/90 font-medium">须扫码上架：先 CNT 容器，再 LOC 库位；不可手填容器 ID。</p>
        <p>① 扫描待上架容器（CNTxxxxxx）</p>
        <p>② 扫描目标库位（LOC-…）</p>
      </div>

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
        <button
          type="button"
          className="w-full rounded-2xl py-3 text-sm text-muted-foreground border border-border"
          onClick={() => engine.reset()}
        >
          重置流程
        </button>
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
        <PdaHeader title="上架" onBack={() => navigate('/pda/inbound')} />
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
        <PdaHeader title="上架" onBack={() => navigate('/pda/inbound')} />
        <PdaLoading className="h-40 mt-8" />
      </div>
    )
  }

  if (task.status < 3) {
    return (
      <div className="min-h-screen bg-background">
        <PdaHeader title="上架" onBack={() => navigate('/pda/inbound')} />
        <PdaEmptyState
          icon="⏳"
          title="任务尚未进入待上架"
          description="请先完成收货并打印箱码，任务进入待上架后会显示在这里。"
          actionText="返回收货订单"
          onAction={() => navigate('/pda/inbound')}
        />
      </div>
    )
  }

  if (task.status >= 4) {
    return (
      <div className="min-h-screen bg-background">
        <PdaHeader title="上架" onBack={() => navigate('/pda/inbound')} />
        <PdaEmptyState
          icon="✅"
          title="任务已完成"
          description="这张收货任务已经上架完成，无需重复操作。"
          actionText="返回收货订单"
          onAction={() => navigate('/pda/inbound')}
        />
      </div>
    )
  }

  return <PutawayRunner taskId={taskId} />
}
