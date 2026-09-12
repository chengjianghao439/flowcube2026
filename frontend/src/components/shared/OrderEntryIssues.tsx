import type { EntryIssue } from '@/lib/orderEntry'
export function OrderEntryIssues({ issues }: { issues: EntryIssue[] }) {
  if (!issues.length) return null
  return <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
    <p className="font-medium text-destructive">还有 {issues.length} 处需要处理，点击可定位</p>
    <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto">
      {issues.map(issue => <li key={issue.target}><button type="button" className="text-left text-foreground underline decoration-destructive/40 underline-offset-2 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={event => {
        const form = event.currentTarget.closest('[data-order-entry]')
        const field = [...(form?.querySelectorAll<HTMLElement>('[data-entry-field]') || [])].find(el => el.dataset.entryField === issue.target)
        const control = field?.matches('input,button,select,textarea') ? field : field?.querySelector<HTMLElement>('input:not(:disabled),button:not(:disabled),select:not(:disabled),textarea:not(:disabled)') ?? field
        control?.focus()
        control?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
      }}>{issue.message}</button></li>)}
    </ul>
  </div>
}
