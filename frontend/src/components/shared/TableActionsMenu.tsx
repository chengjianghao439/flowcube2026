import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useSectionActive } from '@/components/layout/SectionVisibilityContext'
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
  /** 打开弹窗前等菜单浮层完成清理，避免两套 modal 指针锁重叠。 */
  afterMenuClose?: boolean
}

interface TableActionsMenuProps {
  primaryLabel: string
  rowLabel?: string
  onPrimaryClick: () => void
  primaryVariant?: 'default' | 'outline' | 'destructive'
  primaryDisabled?: boolean
  menuDisabled?: boolean
  items: TableActionItem[]
  /** 当前行读取不可用或消失时，由页面提供有效的焦点返回位置。 */
  onUnavailableFocus?: () => void
}

export default function TableActionsMenu({
  primaryLabel,
  rowLabel,
  onPrimaryClick,
  primaryVariant = 'default',
  primaryDisabled = false,
  menuDisabled = primaryDisabled,
  items,
  onUnavailableFocus,
}: TableActionsMenuProps) {
  // 完整列表可能有数千行；用户首次展开前只保留普通按钮，避免每行预挂载 Radix 菜单树。
  // 初始化后继续保留实例，沿用页面隐藏、键盘导航、焦点归还与浮层状态保留规则。
  const [menuInitialized, setMenuInitialized] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuTrigger = useRef<HTMLButtonElement>(null)
  const focusFirstItem = useRef(false)
  const menuContent = useRef<HTMLDivElement>(null)
  const afterClose = useRef<{ index: number; label: string; rowLabel?: string } | null>(null)
  const current = useRef({ items, rowLabel, menuDisabled })
  current.current = { items, rowLabel, menuDisabled }
  const active = useSectionActive()
  const activeRef = useRef(active)
  activeRef.current = active
  const actionRoot = useRef<HTMLElement | null>(null)
  const ownsFocus = useRef(false)
  const unavailableFocus = useRef(onUnavailableFocus)
  unavailableFocus.current = onUnavailableFocus
  const hasFocusFallback = !!onUnavailableFocus
  useEffect(() => {
    if (!hasFocusFallback) return
    const trackFocus = (event: FocusEvent) => {
      const target = event.target as Node | null
      ownsFocus.current = !!target && (!!actionRoot.current?.contains(target) || !!menuContent.current?.contains(target))
    }
    document.addEventListener('focusin', trackFocus)
    return () => {
      document.removeEventListener('focusin', trackFocus)
      if (ownsFocus.current && activeRef.current) unavailableFocus.current?.()
    }
  }, [hasFocusFallback])
  useEffect(() => {
    if ((menuDisabled || !items.length) && ownsFocus.current && activeRef.current) unavailableFocus.current?.()
  }, [menuDisabled, items.length])
  useEffect(() => { if (!active) afterClose.current = null }, [active])
  useEffect(() => {
    if (!items.length) { setMenuOpen(false); afterClose.current = null }
  }, [items.length])
  useEffect(() => () => { afterClose.current = null }, [])
  // 主按钮样式：与下面拼接模式的主按钮保持完全一致（同高、同字号），避免有无下拉时大小不一
  const primaryClass = cn(
    'shrink-0 whitespace-nowrap px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
    primaryVariant === 'outline'
      ? 'bg-transparent text-foreground hover:bg-muted'
      : primaryVariant === 'destructive'
        ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
        : 'bg-primary text-primary-foreground hover:bg-primary/90',
  )
  const primaryAccessibleLabel = rowLabel ? `${primaryLabel} ${rowLabel}` : undefined
  const menuLabel = rowLabel ? `更多操作 ${rowLabel}` : '更多操作'

  if (items.length === 0 && !menuInitialized) {
    return (
      <button ref={node => { actionRoot.current = node }} type="button" disabled={primaryDisabled} aria-label={primaryAccessibleLabel} onClick={onPrimaryClick}
        className={cn('fc-table-actions inline-flex items-center rounded-md border border-border', primaryClass)}>
        {primaryLabel}
      </button>
    )
  }

  return (
    <div ref={node => { actionRoot.current = node }} className="fc-table-actions inline-flex items-center rounded-md border border-border overflow-hidden">
      <button
        type="button"
        disabled={primaryDisabled}
        aria-label={primaryAccessibleLabel}
        onClick={onPrimaryClick}
        className={cn('border-r border-border/60', primaryClass)}
      >
        {primaryLabel}
      </button>
      {!menuInitialized ? (
        <button
          type="button"
          disabled={menuDisabled}
          aria-label={menuLabel}
          aria-haspopup="menu"
          aria-expanded={false}
          onClick={event => {
            focusFirstItem.current = event.detail === 0
            setMenuInitialized(true)
            setMenuOpen(true)
          }}
          onKeyDown={event => {
            if (!menuDisabled && event.key === 'ArrowDown') {
              event.preventDefault()
              focusFirstItem.current = true
              setMenuInitialized(true)
              setMenuOpen(true)
            }
          }}
          className="px-1.5 py-1.5 text-muted-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
        >
          <ChevronDown className="size-3.5" />
        </button>
      ) : <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            ref={menuTrigger}
            disabled={menuDisabled || items.length === 0}
            aria-label={menuLabel}
            className="px-1.5 py-1.5 text-muted-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
          >
            <ChevronDown className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent ref={menuContent} align="end" onCloseAutoFocus={event => {
          const selected = afterClose.current
          const latest = current.current
          // 弹窗交接等待菜单关闭；在此期间行、权限或动作顺序都可能变化。
          const action = selected && selected.rowLabel === latest.rowLabel ? latest.items[selected.index] : undefined
          afterClose.current = null
          if (!activeRef.current) return
          if (latest.menuDisabled || !action?.afterMenuClose || action.disabled || action.label !== selected?.label) {
            if ((menuDisabled || !items.length) && unavailableFocus.current) {
              event.preventDefault()
              unavailableFocus.current()
            }
            return
          }
          event.preventDefault()
          // 先回到仍挂载的触发控件，供下一弹窗记住关闭后的焦点归属。
          menuTrigger.current?.focus({ preventScroll: true })
          action.onClick()
        }} onFocus={() => {
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
                aria-label={rowLabel ? `${item.label} ${rowLabel}` : undefined}
                className={cn('text-xs', item.destructive && 'text-destructive-ink focus:text-destructive-ink')}
                onClick={() => {
                  if (item.afterMenuClose) afterClose.current = { index, label: item.label, rowLabel }
                  else item.onClick()
                }}
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
