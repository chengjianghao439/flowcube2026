import type { ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'

/** PDA 模态壳：固定操作区、短屏滚动、焦点边界；标记同时暂停后台扫码。 */
export default function PdaDialog({ title, description, children, footer, onDismiss, titleClassName = '' }: {
  title: string
  description: string
  children: ReactNode
  footer: ReactNode
  onDismiss: () => void
  titleClassName?: string
}) {
  return <Dialog.Root open onOpenChange={open => { if (!open) onDismiss() }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
      <Dialog.Content
        data-pda-scan-paused="true"
        className="fixed bottom-4 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-xl outline-none"
        onPointerDownOutside={event => event.preventDefault()}
        onEscapeKeyDown={event => { event.preventDefault(); onDismiss() }}
      >
        <div className="shrink-0 border-b border-border p-4">
          <Dialog.Title className={`text-lg font-semibold ${titleClassName}`}>{title}</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{description}</Dialog.Description>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        <div className="shrink-0 border-t border-border p-4">{footer}</div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}
