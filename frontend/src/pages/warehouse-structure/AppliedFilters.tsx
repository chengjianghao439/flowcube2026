import { X } from 'lucide-react'
import { FilterCard } from '@/components/shared/FilterCard'
import { Button } from '@/components/ui/button'

export function AppliedFilters({ chips, onClear }: {
  chips: { key: string; label: string; onRemove: () => void }[]
  onClear: () => void
}) {
  return <FilterCard>
    {chips.map(({ key, label, onRemove }) => (
      <span key={key} className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
        {label}
        <button type="button" onClick={onRemove} className="rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`移除「${label}」`}>
          <X className="size-3" aria-hidden />
        </button>
      </span>
    ))}
    <Button size="sm" variant="ghost" onClick={onClear}>清空</Button>
  </FilterCard>
}
