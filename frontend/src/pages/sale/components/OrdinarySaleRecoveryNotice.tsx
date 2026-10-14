import { Button } from '@/components/ui/button'
import type { useShipSale } from '@/hooks/useSale'
export type OrdinarySaleRecovery = ReturnType<typeof useShipSale>['recovery']
export default function OrdinarySaleRecoveryNotice({ recovery, onConfirmed }: { recovery?:OrdinarySaleRecovery; onConfirmed?:()=>void }) {
  if (!recovery?.pending && !recovery?.storageBlocked) return null
  const labels={reserve:'占库',release:'释放占库',ship:'发起出库'}
  async function recover(retry:boolean) {
    try { const answer=await(retry?recovery!.retry():recovery!.queryOriginal());if(answer.status==='success' && 'queryOnly' in answer && !answer.queryOnly)onConfirmed?.() }
    catch { /* 原记录和错误由 hook 保留，不把查询失败当未执行。 */ }
  }
  return <div role="status" className="space-y-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs">
    <p>{recovery.pending?`原订单 #${recovery.pending.saleId} 的${labels[recovery.pending.kind]}结果待确认。原数量、仓库和请求已冻结，请先核对；刷新后只能查询原结果。`:'原销售操作查询记录无法核对，请保留记录并人工核对。'}</p>
    {recovery.error && <p className="whitespace-pre-wrap break-words">{recovery.error}</p>}
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" disabled={recovery.busy || recovery.storageBlocked} onClick={()=>void recover(false)}>查询原操作结果</Button>
      <Button size="sm" variant="outline" disabled={recovery.busy || !recovery.canRetry} onClick={()=>void recover(true)}>按原请求重试</Button>
    </div>
  </div>
}
