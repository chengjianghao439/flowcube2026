/**
 * PdaFlowSteps — 流程步骤进度条
 *
 * 配合 usePdaFlow 使用：
 *   <PdaFlowSteps steps={flow.steps} currentId={engine.stepId} />
 */
import type { FlowStep } from '@/hooks/usePdaFlow'

interface Props {
  steps: FlowStep<any>[]  // eslint-disable-line @typescript-eslint/no-explicit-any
  currentId: string
}

export default function PdaFlowSteps({ steps, currentId }: Props) {
  if (steps.length <= 1) return null
  return (
    <div className="flex items-center gap-2 px-4 py-3 bg-muted/30 border-b border-border">
      {steps.map((step, idx) => {
        const currentIdx = steps.findIndex(s => s.id === currentId)
        const state =
          idx < currentIdx ? 'done' :
          idx === currentIdx ? 'active' : 'pending'
        return (
          <div key={step.id} className="flex items-center gap-2 flex-1 min-w-0">
            <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-all ${
              state === 'done'   ? 'bg-green-500 text-white' :
              state === 'active' ? 'bg-primary text-primary-foreground' :
                                   'bg-muted text-muted-foreground'
            }`}>
              {state === 'done' ? '✓' : idx + 1}
            </div>
            <p className={`text-xs truncate ${
              state === 'active' ? 'font-semibold text-foreground' : 'text-muted-foreground'
            }`}>{step.label}</p>
            {idx < steps.length - 1 && <div className="h-px flex-1 bg-border" />}
          </div>
        )
      })}
    </div>
  )
}
