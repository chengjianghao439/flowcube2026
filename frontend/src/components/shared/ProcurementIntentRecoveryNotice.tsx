import {Button} from '@/components/ui/button'
import type {useProcurementIntentRecovery,ProcurementConfirmed,RequisitionCreated} from '@/hooks/useProcurementIntentRecovery'
export default function ProcurementIntentRecoveryNotice({recovery,onConfirmed,onViewRequisition}:{recovery:ReturnType<typeof useProcurementIntentRecovery>;onConfirmed?:(answer:ProcurementConfirmed)=>void;onViewRequisition?:(id:number)=>void}){
  if(!recovery.pending&&!recovery.storageBlocked&&!recovery.confirmed)return null
  async function check(retry:boolean){try{const answer=await(retry?recovery.retry():recovery.queryOriginal());if(answer?.status==='success'&&'query' in answer)onConfirmed?.(answer)}catch{/* 保留原身份与错误，不把读取失败当成未执行。 */}}
  if(!recovery.pending&&!recovery.storageBlocked&&recovery.confirmed){const result=recovery.confirmed;return <div role="status" className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-xs"><span>{result.query.domain==='requisition-create'?`原采购申请 ${(result.data as RequisitionCreated).requisitionNo} 已确认创建。当前输入用于新的申请。`:'原计划转单已确认，请核对原计划；可重新选择下一批。'}</span>{result.query.domain==='requisition-create'&&onViewRequisition&&<Button size="sm" variant="outline" onClick={()=>onViewRequisition((result.data as RequisitionCreated).id)}>查看原采购申请</Button>}</div>}
  return <div role="status" className="space-y-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs">
    <p>{recovery.pending?.domain==='plan-convert'?'原计划转采购结果待确认，原勾选已冻结。请先查询原结果，再决定下一批。':'原采购申请创建结果待确认，原输入已冻结。请先查询原申请，再填写新的需求。'}重开页面后只能查询原结果。</p>
    {recovery.error&&<p className="whitespace-pre-wrap break-words">{recovery.error}</p>}
    <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={recovery.busy||recovery.storageBlocked} onClick={()=>void check(false)}>查询原操作结果</Button><Button size="sm" variant="outline" disabled={recovery.busy||!recovery.canRetry} onClick={()=>void check(true)}>按原请求重试</Button></div>
  </div>
}
