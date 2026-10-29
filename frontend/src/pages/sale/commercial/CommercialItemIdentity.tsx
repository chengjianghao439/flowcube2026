import { ProductIdentitySummary } from '@/components/shared/ProductIdentitySummary'

export function CommercialItemIdentity({ code, name, spec, color, articleNumber, kitLine, groupKey }: {
  code?: string | null; name?: string | null; spec?: string | null; color?: string | null; articleNumber?: string | null
  kitLine?: 'parent' | 'component'; groupKey?: string
}) {
  return <div data-sale-kit-line={kitLine} data-sale-kit-group={groupKey} className={kitLine === 'component' ? 'pl-3' : undefined}>
    <ProductIdentitySummary product={{ code, name, spec, color, articleNumber }} name={<>{name || '—'}{kitLine === 'parent' && <span className="ml-2 rounded border px-1 text-xs font-normal text-muted-foreground">成套</span>}</>} />
  </div>
}
