export function CommercialItemIdentity({ code, name, spec, color, articleNumber, kitLine, groupKey }: {
  code?: string | null; name?: string | null; spec?: string | null; color?: string | null; articleNumber?: string | null
  kitLine?: 'parent' | 'component'; groupKey?: string
}) {
  return <div data-sale-kit-line={kitLine} data-sale-kit-group={groupKey} className={`space-y-1 whitespace-normal [overflow-wrap:anywhere] ${kitLine === 'component' ? 'pl-3' : ''}`}>
    <div className="font-medium leading-5"><span className="mr-2 font-mono text-xs text-muted-foreground">{code}</span>{name}
      {kitLine === 'parent' && <span className="ml-2 rounded border px-1 text-xs font-normal text-muted-foreground">成套</span>}
    </div>
    {(spec || color || articleNumber) && <div className="text-xs text-muted-foreground">{[spec && `型号 ${spec}`, color && `颜色 ${color}`, articleNumber && `供应商型号 ${articleNumber}`].filter(Boolean).join(' · ')}</div>}
  </div>
}
