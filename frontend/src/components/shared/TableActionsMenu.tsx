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
  primaryVariant?: 'default' | 'outline' | 'ghost' | 'destructive'
  primaryDisabled?: boolean
  items: TableActionItem[]
}

export default function TableActionsMenu({
  primaryLabel,
  onPrimaryClick,
  primaryVariant = 'outline',
  primaryDisabled = false,
  items,
}: TableActionsMenuProps) {
  const visibleItems = items.filter(item => !item.disabled)

  return (
    <div className="flex items-center gap-1">
      <Button size="sm" variant={primaryVariant} disabled={primaryDisabled} onClick={onPrimaryClick}>
        {primaryLabel}
      </Button>
      {visibleItems.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" className="px-2" disabled={primaryDisabled && visibleItems.every(item => item.disabled)}>
              更多
              <ChevronDown className="ml-0.5 size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {visibleItems.map((item, index) => (
              <div key={`${item.label}-${index}`}>
                {item.separatorBefore && <DropdownMenuSeparator />}
                <DropdownMenuItem
                  disabled={item.disabled}
                  className={item.destructive ? 'text-destructive focus:text-destructive' : undefined}
                  onClick={item.onClick}
                >
                  {item.icon}
                  {item.label}
                </DropdownMenuItem>
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
