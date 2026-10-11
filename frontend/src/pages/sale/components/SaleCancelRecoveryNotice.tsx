import { Button } from '@/components/ui/button'
import type { useCancelSale } from '@/hooks/useSale'
export default function SaleCancelRecoveryNotice({ recovery, onConfirmed }: {
  recovery?: ReturnType<typeof useCancelSale>['recovery']; onConfirmed:()=>void
}) {
  if(recovery?.storageBlocked)return <div role="alert" className="space-y-1 rounded-md border border-destructive/30 px-3 py-2 text-xs text-destructive-ink">
    <p>取消查询记录无法核对，请保留原记录并人工核对；当前操作保持禁用，不要重新发起取消。</p>
    {recovery.error && <p className="whitespace-pre-wrap break-words">{recovery.error}</p>}
  </div>
  if(!recovery?.pending)return null
  return <div className="space-y-2 text-xs">
    <p>原订单 #{recovery.pending.resourceId} 的取消结果待确认，原因与原请求已冻结；刷新后仅恢复查询身份，不保存原因输入。</p>
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" disabled={recovery.busy} onClick={()=>void recovery.queryOriginal().then(ok=>{if(ok)onConfirmed()})}>查询原操作结果</Button>
      <Button size="sm" variant="outline" disabled={recovery.busy || !recovery.canRetry} onClick={()=>void recovery.retry().then(ok=>{if(ok)onConfirmed()})}>按原请求重试</Button>
    </div>
  </div>
}
