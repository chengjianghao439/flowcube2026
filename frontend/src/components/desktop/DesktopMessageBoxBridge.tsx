/**
 * Electron：主进程通过 IPC 请求在渲染层展示多按钮提示（替代 dialog.showMessageBox）。
 */
import { useEffect, useState } from 'react'
import { AlertTriangle, Info } from 'lucide-react'
import { AppDialog } from '@/components/shared/AppDialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { DesktopMessageBoxPayload } from '@/types/desktop'

export function DesktopMessageBoxBridge() {
  const [box, setBox] = useState<DesktopMessageBoxPayload | null>(null)

  useEffect(() => {
    const d = window.flowcubeDesktop
    if (!d?.onDesktopMessageBox) return
    return d.onDesktopMessageBox((payload) => setBox(payload))
  }, [])

  if (!box) return null

  const buttons = box.buttons?.length ? box.buttons : ['确定']
  const defaultId = typeof box.defaultId === 'number' ? box.defaultId : 0
  const cancelId = typeof box.cancelId === 'number' ? box.cancelId : 0

  const respond = (idx: number) => {
    window.flowcubeDesktop?.sendDesktopMessageBoxResponse?.(box.id, idx)
    setBox(null)
  }

  const onOpenChange = (v: boolean) => {
    if (!v) respond(cancelId)
  }

  const type = box.type ?? 'info'
  const Icon =
    type === 'error' || type === 'warning' ? (
      <AlertTriangle className="h-4 w-4 text-destructive" />
    ) : (
      <Info className="h-4 w-4 text-primary" />
    )

  return (
    <AppDialog
      open
      onOpenChange={onOpenChange}
      dialogId="desktop-message-box"
      resizable={false}
      defaultWidth={440}
      defaultHeight={320}
      minWidth={360}
      minHeight={200}
      title={
        <span className="flex items-center gap-2">
          {Icon}
          {box.title || '提示'}
        </span>
      }
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          {buttons.map((label, idx) => {
            const isPrimary = idx === defaultId
            const isDestructive = type === 'error' && isPrimary
            return (
              <Button
                key={`${idx}-${label}`}
                variant={
                  isDestructive ? 'destructive' : isPrimary ? 'default' : 'outline'
                }
                className={cn(!isPrimary && !isDestructive && 'min-w-[88px]')}
                onClick={() => respond(idx)}
              >
                {label}
              </Button>
            )
          })}
        </div>
      }
    >
      <div className="space-y-3 px-5 py-4 text-sm">
        {box.message ? (
          <p className="whitespace-pre-wrap text-foreground">{box.message}</p>
        ) : null}
        {box.detail ? (
          <pre className="max-h-[min(40vh,320px)] overflow-auto rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground whitespace-pre-wrap">
            {box.detail}
          </pre>
        ) : null}
      </div>
    </AppDialog>
  )
}
