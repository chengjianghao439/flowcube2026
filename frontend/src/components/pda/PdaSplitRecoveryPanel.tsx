import { Button } from '@/components/ui/button'
import type { usePdaSplitRecovery } from '@/hooks/usePdaSplitRecovery'
import { formatPdaActionError } from '@/utils/displayFormatters'
/** 仅展示当前账号/原服务器的持久拆分请求，无库存查询、扫码或新建请求。 */
export default function PdaSplitRecoveryPanel({ recovery, onError }: { recovery: ReturnType<typeof usePdaSplitRecovery>; onError: (message: string) => void }) {
  return <div className="space-y-3 px-4">
    {recovery.error && <p className="text-sm text-warning-ink">{recovery.error}</p>}
    {recovery.records.map(rec => <div key={rec.requestKey} className="rounded border border-warning/30 bg-warning/10 p-3 text-xs text-warning-ink space-y-2">
      <p>原提交：{rec.sourceBarcode ?? `来源 #${rec.sourceContainerId}`} · {rec.body ? `拆出 ${rec.body.qty}` : '原数据不完整，请人工核对'}</p>
      <p>原服务器：{rec.endpoint} · 请求键：{rec.requestKey}</p>
      <p>{recovery.notices[rec.requestKey]?.message ?? '原拆分结果待确认，暂勿改目标或重新提交'}</p>
      <Button className="px-3" variant="outline" size="lg" disabled={!!recovery.notices[rec.requestKey]?.busy}
        onClick={() => { void recovery.query(rec).catch(error => onError(formatPdaActionError(error, '核对失败'))) }}>查询原拆分结果</Button>
      {recovery.canRetry(rec) && <Button className="px-3" variant="outline" size="lg" onClick={() => { void recovery.retry(rec).catch(error => onError(formatPdaActionError(error, '原请求重试失败'))) }}>按原内容重试</Button>}
    </div>)}
  </div>
}
