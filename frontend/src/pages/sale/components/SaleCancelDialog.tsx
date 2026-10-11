import type { ReactNode } from 'react'
import { useRef } from 'react'
import { AppDialog } from '@/components/shared/AppDialog'
import { Button } from '@/components/ui/button'

/** 销售取消原确认入口的选填原因；共享原生 ConfirmDialog 契约保持不变。 */
export default function SaleCancelDialog({ open, title = '取消订单', description, reason, onReasonChange,
  loading = false, frozen = false, error, confirmText = '确认', onConfirm, onCancel, children }: {
  open: boolean; title?: string; description: string; reason: string; onReasonChange: (value: string) => void
  loading?: boolean; frozen?: boolean; error?: string; confirmText?: string
  onConfirm: () => void | Promise<unknown>; onCancel: () => void; children?: ReactNode
}) {
  const submitting = useRef(false)
  async function confirm() {
    if (submitting.current || loading || frozen) return
    submitting.current = true
    try { await onConfirm() } finally { submitting.current = false }
  }
  function close() { if (!submitting.current && !loading && !frozen) onCancel() }
  return <AppDialog open={open} onOpenChange={value => { if (!value) close() }} dialogId="sale-cancel"
    title={title} defaultWidth={520} defaultHeight={340} minWidth={360} minHeight={280} resizable={false}
    footer={<div className="flex justify-end gap-2">
      <Button variant="outline" disabled={loading || frozen} onClick={close}>返回订单</Button>
      <Button variant="destructive" disabled={loading || frozen} onClick={() => void confirm()}>{loading ? '处理中…' : confirmText}</Button>
    </div>}>
    <div className="space-y-3 overflow-auto px-5 py-4 text-sm">
      <p className="whitespace-pre-wrap break-words leading-6 text-muted-foreground">{description}</p>
      <label className="block space-y-1.5"><span>取消原因（选填）</span>
        <textarea aria-label="取消原因（选填）" value={reason} onChange={e => { if (!loading && !frozen) onReasonChange(e.target.value) }}
          disabled={loading || frozen} maxLength={500} rows={2} className="block w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60" />
      </label>
      {error && <p role="alert" className="text-destructive-ink">{error}</p>}
      {children}
    </div>
  </AppDialog>
}
