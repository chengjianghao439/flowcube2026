import { Button } from '@/components/ui/button'
import type { useDisposalHandlingOperation } from '@/hooks/useDisposalHandlingOperation'
export function HandlingOperationPanel({ write }: { write: ReturnType<typeof useDisposalHandlingOperation> }) {
  if (!write.pending && !write.error && !write.result) return null
  return <section className="rounded border p-3 space-y-2"><p role="status">{write.error || (write.result ? '原处理结果已确认' : '原处理请求待确认，输入和原请求保留')}</p>
    {write.pending && <Button variant="outline" disabled={write.busy} onClick={() => void write.queryOriginal()}>查询原处理结果</Button>}
    <p className="text-xs text-muted-foreground">不会自动重发。暂未找到或仍在处理时，请继续核对原结果或请主管人工核对。</p>
  </section>
}
