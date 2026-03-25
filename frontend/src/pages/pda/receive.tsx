/**
 * PDA 收货（流程引擎）— 路由 /pda/receive/:id
 */
import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getInboundTaskByIdApi } from '@/api/inbound-tasks'
import type { InboundTask } from '@/types/inbound-tasks'
import PdaHeader from '@/components/pda/PdaHeader'
import PdaBottomBar from '@/components/pda/PdaBottomBar'
import PdaScanner from '@/components/pda/PdaScanner'
import { PdaLoading } from '@/components/pda/PdaEmptyState'
import { usePdaFlow } from '@/hooks/usePdaFlow'
import PdaFlowSteps from '@/components/pda/PdaFlowSteps'
import { makeReceiveFlow, type ReceiveFlowContext } from '@/flows/receiveFlow'

function ReceiveRunner({ task }: { task: InboundTask }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const flowDef = useMemo(
    () =>
      makeReceiveFlow({
        onPackageReceived: async () => {
          await qc.invalidateQueries({ queryKey: ['pda-inbound-task', task.id] })
          await qc.invalidateQueries({ queryKey: ['pda-inbound-tasks'] })
        },
      }),
    [qc, task.id],
  )

  const initialContext: ReceiveFlowContext = {
    taskId: task.id,
    purchaseOrderNo: task.purchaseOrderNo,
    taskNo: task.taskNo,
    items: task.items ?? [],
    productId: null,
    productName: null,
    productCode: null,
  }

  const engine = usePdaFlow(flowDef, initialContext, `inbound-receive-${task.id}`)

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PdaHeader
        title={task.taskNo}
        subtitle={task.supplierName ?? undefined}
        backLabel="← 收货列表"
        onBack={() => navigate('/pda/inbound')}
        right={<span className="text-xs text-muted-foreground">收货</span>}
      />

      <div className="px-4 pt-3">
        <PdaFlowSteps steps={flowDef.steps} currentId={engine.stepId} />
        <p className="text-xs text-muted-foreground mt-2">
          {engine.currentStep.label}
          {engine.context.productName ? ` · ${engine.context.productName}` : ''}
        </p>
      </div>

      <div className="flex-1 px-4 py-3 space-y-2 text-sm">
        <p className="text-muted-foreground">采购单：{task.purchaseOrderNo ?? '—'}</p>
        <div className="rounded-xl border border-border divide-y max-h-[40vh] overflow-y-auto">
          {(task.items ?? []).map(it => {
            const live = engine.context.items.find(x => x.id === it.id)
            const rec = live?.receivedQty ?? it.receivedQty
            return (
              <div key={it.id} className="flex justify-between px-3 py-2">
                <span className="font-medium truncate pr-2">{it.productName}</span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {rec}/{it.orderedQty} {it.unit ?? ''}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      <PdaBottomBar>
        <PdaScanner
          onScan={async (code) => {
            await engine.scan(code)
            await qc.invalidateQueries({ queryKey: ['pda-inbound-task', task.id] })
            await qc.invalidateQueries({ queryKey: ['pda-inbound-tasks'] })
          }}
          placeholder={engine.currentStep.placeholder}
          disabled={engine.scanning}
        />
        <button
          type="button"
          className="w-full rounded-2xl py-3 text-sm text-muted-foreground border border-border"
          onClick={() => engine.reset()}
        >
          重置本单流程
        </button>
      </PdaBottomBar>
    </div>
  )
}

export default function PdaReceivePage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const taskId = Number(id) || 0

  const { data: task, isLoading } = useQuery({
    queryKey: ['pda-inbound-task', taskId],
    queryFn: () => getInboundTaskByIdApi(taskId).then(r => r.data.data!),
    enabled: taskId > 0,
  })

  if (!taskId) {
    return (
      <div className="min-h-screen bg-background p-6 text-center text-muted-foreground">
        无效任务
        <button type="button" className="mt-4 block mx-auto text-primary" onClick={() => navigate('/pda/inbound')}>返回</button>
      </div>
    )
  }

  if (isLoading || !task) {
    return (
      <div className="min-h-screen bg-background">
        <PdaHeader title="收货" onBack={() => navigate('/pda/inbound')} />
        <PdaLoading className="h-40 mt-8" />
      </div>
    )
  }

  if (task.status >= 3) {
    return (
      <div className="min-h-screen bg-background p-6 text-center space-y-3">
        <p className="text-muted-foreground">
          {task.status === 3 ? '本单已收满，请前往「开始上架」扫描容器与库位。' : '任务已结束'}
        </p>
        <button type="button" className="text-primary font-medium" onClick={() => navigate('/pda/inbound')}>返回列表</button>
      </div>
    )
  }

  return <ReceiveRunner task={task} />
}
