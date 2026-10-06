import { Button } from '@/components/ui/button'
import type { usePdaSplitRecovery } from '@/hooks/usePdaSplitRecovery'
import { splitEndpoint } from '@/lib/pdaSplitRecovery'
import { formatPdaActionError } from '@/utils/displayFormatters'
/** 仅展示当前账号/原服务器的持久拆分请求，无库存查询、扫码或新建请求。 */
export default function PdaSplitRecoveryPanel({ recovery, onError }: { recovery: ReturnType<typeof usePdaSplitRecovery>; onError: (message: string) => void }) {
  const visible = recovery.records.filter(r => r.endpoint === splitEndpoint())
  return <div className="space-y-3 px-4">
    {recovery.error && <p className="text-sm text-amber-800">{recovery.error}</p>}
    {recovery.records.length > visible.length && <p className="text-sm text-amber-800">其他服务器还有原拆分记录，请回原服务器核对；本页不使用其数据。</p>}
    {visible.map(rec => <div key={rec.requestKey} className="rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 space-y-2">
      <p>原提交：{rec.sourceBarcode ?? `来源 #${rec.sourceContainerId}`} · {rec.body ? `拆出 ${rec.body.qty}` : '原数据不完整，请人工核对'}</p>
      <p>原服务器：{rec.endpoint} · 请求键：{rec.requestKey}</p>
      <p>{recovery.notices[rec.requestKey]?.message ?? '原拆分结果待确认，暂勿改目标或重新提交'}</p>
      <Button variant="outline" size="sm" disabled={!!recovery.notices[rec.requestKey]?.busy}
        onClick={() => { void recovery.query(rec).catch(error => onError(formatPdaActionError(error, '核对失败'))) }}>查询原拆分结果</Button>
      {recovery.canRetry(rec) && <Button variant="outline" size="sm" onClick={() => { void recovery.retry(rec).catch(error => onError(formatPdaActionError(error, '原请求重试失败'))) }}>按原内容重试</Button>}
    </div>)}
  </div>
}
