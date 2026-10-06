import { Button } from '@/components/ui/button'

export function ApprovalHandoffNotice({ message, canRetry, retry, canClose, close }: { message: string; canRetry: boolean; retry: () => void; canClose?: boolean; close?: () => void }) {
  return message ? <div role="status" className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm text-muted-foreground">
    <span>{message}</span>{canRetry && <Button size="sm" variant="outline" onClick={retry}>重试原单</Button>}
  {canClose && <Button size="sm" variant="outline" onClick={close}>关闭当前原单</Button>}
  </div> : null
}
