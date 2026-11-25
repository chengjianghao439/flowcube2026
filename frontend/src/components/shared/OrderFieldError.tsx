import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function OrderFieldError({ children, id, className }: { children: ReactNode; id?: string; className?: string }) {
  if (!children) return null
  return <p id={id} role="alert" className={cn('text-xs text-destructive-ink', className)}>{children}</p>
}
