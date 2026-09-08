import { useRef, useState, type ReactNode } from 'react'
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
  // 完整列表可能有数千行；用户首次展开前只保留普通按钮，避免每行预挂载 Radix 菜单树。
  // 初始化后继续保留实例，沿用页面隐藏、键盘导航、焦点归还与浮层状态保留规则。
  const [menuInitialized, setMenuInitialized] = useState(false)
  const focusFirstItem = useRef(false)
  const menuContent = useRef<HTMLDivElement>(null)
  // 主按钮样式：与下面拼接模式的主按钮保持完全一致（同高、同字号），避免有无下拉时大小不一
  const primaryClass = cn(
    'shrink-0 whitespace-nowrap px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
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
      {!menuInitialized ? (
        <button
          type="button"
          disabled={primaryDisabled}
          aria-label="更多操作"
          aria-haspopup="menu"
          aria-expanded={false}
          onClick={event => {
            focusFirstItem.current = event.detail === 0
            setMenuInitialized(true)
          }}
          onKeyDown={event => {
            if (!primaryDisabled && event.key === 'ArrowDown') {
              event.preventDefault()
              focusFirstItem.current = true
              setMenuInitialized(true)
            }
          }}
          className="px-1.5 py-1.5 text-muted-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
        >
          <ChevronDown className="size-3.5" />
        </button>
      ) : <DropdownMenu defaultOpen>
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
        <DropdownMenuContent ref={menuContent} align="end" onFocus={() => {
          // 首次按键发生在 Radix 挂载之前，补上键盘打开时应聚焦首个可用菜单项的语义。
          if (!focusFirstItem.current) return
          focusFirstItem.current = false
          menuContent.current?.querySelector<HTMLElement>('[role="menuitem"]:not([data-disabled])')?.focus()
        }}>
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
      </DropdownMenu>}
    </div>
  )
}
