import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

type ActionItem = {
  label: string
  onClick: () => void
  variant?: 'default' | 'outline' | 'ghost'
}

export function FocusModePanel({
  badge,
  title,
  description,
  steps,
  summary,
  actions,
}: {
  badge: string
  title: string
  description: string
  steps: string[]
  summary?: string
  actions?: ActionItem[]
}) {
  return (
    <section className="rounded-2xl border border-primary/15 bg-gradient-to-r from-primary/5 via-white to-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="rounded-full border-primary/20 bg-white text-primary">
              {badge}
            </Badge>
            {summary && (
              <span className="text-xs text-muted-foreground">{summary}</span>
            )}
          </div>
          <div>
            <h2 className="text-card-title">{title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
          <div className="grid gap-2 md:grid-cols-3">
            {steps.map((step, index) => (
              <div key={`${index}-${step}`} className="rounded-xl border border-border/70 bg-white/80 px-3 py-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">步骤 {index + 1}</p>
                <p className="mt-1 text-sm font-medium text-foreground">{step}</p>
              </div>
            ))}
          </div>
        </div>

        {actions && actions.length > 0 && (
          <div className="flex shrink-0 flex-wrap gap-2 xl:max-w-[280px] xl:justify-end">
            {actions.map(action => (
              <Button key={action.label} variant={action.variant ?? 'outline'} onClick={action.onClick}>
                {action.label}
              </Button>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
