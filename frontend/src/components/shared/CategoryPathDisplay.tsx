import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CategoryPathDisplayProps {
  path?: string | null
  fallback?: string | null
  className?: string
}

export default function CategoryPathDisplay({ path, fallback = null, className }: CategoryPathDisplayProps) {
  const normalized = (path || fallback || '').trim()
  if (!normalized) return <span className={cn('italic text-muted-foreground', className)}>未分类</span>

  const segments = normalized.split('>').map(s => s.trim()).filter(Boolean)
  if (segments.length <= 1) {
    return (
      <span
        className={cn(
          'inline-flex max-w-full items-center rounded-md border border-border/70 bg-muted/30 px-2 py-1 text-sm',
          className,
        )}
      >
        <span className="truncate">{normalized}</span>
      </span>
    )
  }

  const [expanded, setExpanded] = useState(false)
  const leaf = segments[segments.length - 1]
  const parentPath = segments.slice(0, -1).join(' / ')

  return (
    <div className={cn('min-w-0', className)}>
      <button
        type="button"
        className={cn(
          'flex max-w-full items-center gap-1.5 rounded-md border border-border/70 bg-muted/30 px-2 py-1 text-left text-sm text-foreground',
          'hover:border-primary/30 hover:bg-primary/5 hover:text-primary',
        )}
        onClick={() => setExpanded(v => !v)}
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
        <span className="truncate font-medium">{leaf}</span>
        {!expanded && parentPath && (
          <span className="truncate text-xs text-muted-foreground">
            {parentPath}
          </span>
        )}
      </button>

      {expanded && (
        <div className="mt-1 rounded-md border border-border/60 bg-background/80 p-2">
          {segments.map((segment, index) => (
            <div key={`${segment}-${index}`} className="flex items-center gap-2 py-0.5 text-xs text-muted-foreground">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-border" />
              <span className={cn('truncate', index === segments.length - 1 && 'font-medium text-foreground')}>
                {segment}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
