import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function OrderFacts({ children }: { children: ReactNode }) {
  return <div className="desktop-order-facts grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2 xl:grid-cols-6 [&>div]:min-w-0 [&>div]:[overflow-wrap:anywhere]">{children}</div>
}
export function OrderFact({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return <div className={cn('min-w-0', className)}><span className="text-muted-foreground">{label}：</span>{children}</div>
}
