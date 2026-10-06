import type { useDisposalExecution } from '@/hooks/useDisposalExecution'
import { Button } from '@/components/ui/button'
export function DisposalExecutionPanel({ write, active }: { write: ReturnType<typeof useDisposalExecution>; active: boolean }) {
  if (!write.pending && !write.error && !write.result) return null
  return <div className="rounded border p-3 space-y-2" role="status">
    <p>{write.result ? `原报废 ${write.result.disposalNo} 已确认完成` : write.error || '报废结果待确认，请查询原请求，勿另发执行'}</p>
    {write.pending && <div className="flex gap-2">
      <Button variant="outline" disabled={!active || write.busy} onClick={() => void write.queryOriginal()}>查询原报废结果</Button>
      <Button variant="outline" disabled={!active || write.busy || !write.canRetry} onClick={() => void write.retry()}>按原请求重试</Button>
    </div>}
    <p className="text-xs text-muted-foreground">查询失败、处理中或身份不一致时保留原请求。过期、时间异常或旧记录缺载荷只能查询／人工核对；已处置状态不能代替原结果。</p>
  </div>
}
