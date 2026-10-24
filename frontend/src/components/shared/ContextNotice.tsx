import { Info, type LucideIcon } from 'lucide-react'
import type { AriaRole, ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** 页面已有业务说明的共用呈现；不添加新的警告、确认或权限判断。 */
export function ContextNotice({ children, icon: Icon = Info, variant = 'panel', className, role }: { children: ReactNode; icon?: LucideIcon; variant?: 'panel' | 'inline'; className?: string; role?: AriaRole }) {
  return <div role={role} className={cn('fc-context-notice flex items-start gap-2.5 text-xs leading-5 text-muted-foreground', variant === 'inline' ? 'fc-context-notice-inline py-1' : 'rounded-lg border border-border bg-card px-3 py-3', className)}>
    <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
    <div className="min-w-0 flex-1">{children}</div>
  </div>
}
