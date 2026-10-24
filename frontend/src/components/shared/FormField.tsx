import type { ReactNode } from 'react'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/** 字段外壳只统一标签、说明与间距；值、校验、禁用和提交仍由调用处负责。 */
export function FormField({ id, label, description, className, children }: {
  id: string
  label: ReactNode
  description?: ReactNode
  className?: string
  children: (field: { id: string; 'aria-describedby'?: string }) => ReactNode
}) {
  const descriptionId = description ? `${id}-description` : undefined
  return <div className={cn('fc-form-field min-w-0 space-y-1.5', className)}>
    <Label htmlFor={id}>{label}</Label>
    {children({ id, 'aria-describedby': descriptionId })}
    {description && <p id={descriptionId} className="text-helper leading-5">{description}</p>}
  </div>
}
