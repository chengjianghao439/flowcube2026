import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

type BridgeAction = {
  label: string
  onClick: () => void
  variant?: 'default' | 'outline' | 'ghost'
}

export function ExecutionBridgePanel({
  badge,
  title,
  description,
  erpTitle,
  erpItems,
  pdaTitle,
  pdaItems,
  actions,
}: {
  badge: string
  title: string
  description: string
  erpTitle: string
  erpItems: string[]
  pdaTitle: string
  pdaItems: string[]
  actions?: BridgeAction[]
}) {
  return (
    <section className="rounded-2xl border border-primary/15 bg-gradient-to-r from-primary/5 via-white to-white p-5 shadow-sm">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="rounded-full border-primary/20 bg-white text-primary">
            {badge}
          </Badge>
        </div>

        <div>
          <h2 className="text-card-title">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>

        <div className="grid gap-3 xl:grid-cols-2">
          <div className="rounded-xl border border-border/70 bg-white/90 px-4 py-4">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">ERP 指挥</p>
            <p className="mt-1 text-sm font-semibold text-foreground">{erpTitle}</p>
            <div className="mt-3 space-y-2">
              {erpItems.map((item, index) => (
                <div key={`${index}-${item}`} className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
                  <p className="text-sm text-foreground">{item}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-border/70 bg-white/90 px-4 py-4">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">PDA 执行</p>
            <p className="mt-1 text-sm font-semibold text-foreground">{pdaTitle}</p>
            <div className="mt-3 space-y-2">
              {pdaItems.map((item, index) => (
                <div key={`${index}-${item}`} className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
                  <p className="text-sm text-foreground">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {actions && actions.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {actions.map(action => (
              <Button key={action.label} variant={action.variant ?? 'outline'} onClick={action.onClick}>
                {action.label}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  )
}
