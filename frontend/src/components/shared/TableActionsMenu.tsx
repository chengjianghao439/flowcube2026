import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
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
  primaryVariant?: 'default' | 'outline' | 'destructive'
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
  // 主按钮样式：与下面拼接模式的主按钮保持完全一致（同高、同字号），避免有无下拉时大小不一
  const primaryClass = cn(
    'px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
    primaryVariant === 'outline'
      ? 'bg-transparent text-foreground hover:bg-muted'
      : primaryVariant === 'destructive'
        ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
        : 'bg-primary text-primary-foreground hover:bg-primary/90',
  )

  if (items.length === 0) {
    return (
      <button type="button" disabled={primaryDisabled} onClick={onPrimaryClick}
        className={cn('inline-flex items-center rounded-md border border-border', primaryClass)}>
        {primaryLabel}
      </button>
    )
  }

  return (
    <div className="inline-flex items-center rounded-md border border-border overflow-hidden">
      <button
        type="button"
        disabled={primaryDisabled}
        onClick={onPrimaryClick}
        className={cn('border-r border-border/60', primaryClass)}
      >
        {primaryLabel}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={primaryDisabled || items.length === 0}
            aria-label="更多操作"
            className="px-1.5 py-1.5 text-muted-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
          >
            <ChevronDown className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {items.map((item, index) => (
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
