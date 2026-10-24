import { forwardRef, useEffect, useState, type ReactNode } from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import type { LucideIcon } from 'lucide-react'
import { Button, type ButtonProps } from '@/components/ui/button'
import { useSectionActive } from '@/components/layout/SectionVisibilityContext'
import { cn } from '@/lib/utils'

type IconButtonProps = Omit<ButtonProps, 'asChild' | 'children' | 'aria-label' | 'title'> & {
  icon: LucideIcon
  label: string
  badge?: ReactNode
}

/** 有界工具区使用的图标按钮；保留原按钮事件、禁用条件和焦点目标。 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon: Icon, label, badge, className, type = 'button', variant = 'ghost', size = 'icon', disabled, onClick, ...props }, ref) => {
    const active = useSectionActive()
    const [open, setOpen] = useState(false)
    useEffect(() => { if (!active || disabled) setOpen(false) }, [active, disabled])
    return <Tooltip.Provider delayDuration={400} skipDelayDuration={100}>
      <Tooltip.Root open={active && !disabled && open} onOpenChange={setOpen} disableHoverableContent>
        <Tooltip.Trigger asChild>
          <Button {...props} ref={ref} type={type} variant={variant} size={size} disabled={disabled} aria-label={label}
            onClick={event => { setOpen(false); onClick?.(event) }} className={cn('fc-icon-button', className)}>
            <Icon aria-hidden="true" className="size-4" strokeWidth={1.75} />
            {badge}
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content side="bottom" sideOffset={6} collisionPadding={8}
            className="fc-icon-tooltip z-50 max-w-60 rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs leading-5 text-popover-foreground shadow-md">
            {label}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  },
)
IconButton.displayName = 'IconButton'
