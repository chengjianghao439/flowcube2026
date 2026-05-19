import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export interface TableActionItem {
  label: string
  onClick: () => void
  icon?: ReactNode
  destructive?: boolean
  disabled?: boolean
  separatorBefore?: boolean
}

interface TableActionsMenuProps {
  primaryLabel: string
  onPrimaryClick: () => void
  primaryVariant?: 'default' | 'outline'
  primaryDisabled?: boolean
  items: TableActionItem[]
}

export default function TableActionsMenu({
  primaryLabel,
  onPrimaryClick,
  primaryVariant = 'default',
  primaryDisabled = false,
  items,
}: TableActionsMenuProps) {
  const visibleItems = items.filter(item => !item.disabled)

  if (visibleItems.length === 0) {
    return (
      <Button size="sm" variant={primaryVariant} disabled={primaryDisabled} onClick={onPrimaryClick}>
        {primaryLabel}
      </Button>
    )
  }

  return (
    <div className="inline-flex items-center rounded-md border border-border overflow-hidden">
      <button
        type="button"
        disabled={primaryDisabled}
        onClick={onPrimaryClick}
        className={cn(
          'px-3 py-1.5 text-xs font-medium border-r border-border/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
          primaryVariant === 'outline'
            ? 'bg-transparent text-foreground hover:bg-muted'
            : 'bg-primary text-primary-foreground hover:bg-primary/90'
        )}
      >
        {primaryLabel}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={primaryDisabled || visibleItems.length === 0}
            aria-label="更多操作"
            className="px-1.5 py-1.5 text-muted-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
          >
            <ChevronDown className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {visibleItems.map((item, index) => (
            <div key={`${item.label}-${index}`}>
              {item.separatorBefore && <DropdownMenuSeparator />}
              <DropdownMenuItem
                disabled={item.disabled}
                className={cn('text-xs', item.destructive && 'text-destructive focus:text-destructive')}
                onClick={item.onClick}
              >
                {item.icon}
                {item.label}
              </DropdownMenuItem>
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
