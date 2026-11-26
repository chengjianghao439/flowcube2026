import { useQueryClient } from '@tanstack/react-query'
import { useCriticalPdaAction } from '@/hooks/useCriticalPdaAction'
import PdaCriticalActionNotice from './PdaCriticalActionNotice'

/** 任务不可执行时仍能查询原收货/上架回执。只在作业表单卸载后挂载。 */
export default function PdaInboundReceiptNotice({ taskId, operation }: { taskId: number; operation: 'receive' | 'putaway' }) {
  const qc = useQueryClient()
  const action = useCriticalPdaAction({
    action: `inbound.${operation}.${taskId}`,
    label: `收货单 #${taskId}`,
    onConfirmed: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['pda-inbound-task', taskId] }),
        qc.invalidateQueries({ queryKey: ['pda-inbound-tasks'] }),
        qc.invalidateQueries({ queryKey: ['inbound-tasks'] }),
      ])
    },
  })
  if (!action.pendingRecord && !action.lastErrorMessage) return null
  return <PdaCriticalActionNotice {...action} onConfirm={() => void action.confirmPending()}
    onClear={action.clearPending} onDismissError={action.clearError} />
}
