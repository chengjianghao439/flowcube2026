import {Button} from '@/components/ui/button'
import type {useProcurementIntentRecovery,ProcurementConfirmed} from '@/hooks/useProcurementIntentRecovery'
export default function ProcurementIntentRecoveryNotice({recovery,onConfirmed}:{recovery:ReturnType<typeof useProcurementIntentRecovery>;onConfirmed?:(answer:ProcurementConfirmed)=>void}){
  if(!recovery.pending&&!recovery.storageBlocked&&!recovery.confirmed)return null
  async function check(retry:boolean){try{const answer=await(retry?recovery.retry():recovery.queryOriginal());if(answer?.status==='success'&&'query' in answer)onConfirmed?.(answer)}catch{/* 保留原身份与错误，不把读取失败当成未执行。 */}}
  if(!recovery.pending&&!recovery.storageBlocked&&recovery.confirmed)return <div role="status" className="rounded-md border px-3 py-2 text-xs">原计划转单已确认，请核对原计划；可重新选择下一批。</div>
  return <div role="status" className="space-y-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs">
    <p>原计划转采购结果待确认，原勾选已冻结。请先查询原结果，再决定下一批。重开页面后只能查询原结果。</p>
    {recovery.error&&<p className="whitespace-pre-wrap break-words">{recovery.error}</p>}
    <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={recovery.busy||recovery.storageBlocked} onClick={()=>void check(false)}>查询原操作结果</Button><Button size="sm" variant="outline" disabled={recovery.busy||!recovery.canRetry} onClick={()=>void check(true)}>按原请求重试</Button></div>
  </div>
}
