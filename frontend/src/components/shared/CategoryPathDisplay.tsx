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
    return <span className={cn('truncate text-sm', className)}>{normalized}</span>
  }

  const [expanded, setExpanded] = useState(false)
  const leaf = segments[segments.length - 1]

  return (
    <div className={cn('min-w-0', className)}>
      <button
        type="button"
        className="flex max-w-full items-center gap-1 text-left text-sm text-foreground hover:text-primary"
        onClick={() => setExpanded(v => !v)}
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
        <span className="truncate">{leaf}</span>
      </button>

      {expanded && (
        <div className="mt-1 space-y-1 pl-5">
          {segments.map((segment, index) => (
            <div key={`${segment}-${index}`} className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-border" />
              <span className="truncate">{segment}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
