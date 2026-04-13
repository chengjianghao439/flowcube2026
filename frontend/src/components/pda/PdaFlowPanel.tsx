import { Button } from '@/components/ui/button'
import PdaCard from '@/components/pda/PdaCard'

type PdaFlowAction = {
  label: string
  onClick: () => void
  variant?: 'default' | 'outline' | 'ghost'
}

export default function PdaFlowPanel({
  badge,
  title,
  description,
  nextAction,
  stepText,
  actions,
}: {
  badge: string
  title: string
  description: string
  nextAction: string
  stepText: string
  actions?: PdaFlowAction[]
}) {
  return (
    <PdaCard>
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{badge}</p>
            <p className="mt-1 text-base font-semibold text-foreground">{title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
          <div className="rounded-xl border border-border bg-muted/40 px-3 py-2 text-right">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">下一步</p>
            <p className="mt-1 text-sm font-semibold text-foreground">{nextAction}</p>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-background px-3 py-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">推荐顺序</p>
          <p className="mt-1 text-sm text-foreground">{stepText}</p>
        </div>
        {actions && actions.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {actions.map((action) => (
              <Button
                key={action.label}
                size="sm"
                variant={action.variant ?? 'outline'}
                onClick={action.onClick}
              >
                {action.label}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
    </PdaCard>
  )
}
