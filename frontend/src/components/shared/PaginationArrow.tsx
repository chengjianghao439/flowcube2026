import type { ComponentProps } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** 列表和查找弹窗共用的分页方向按钮。 */
export function PaginationArrow({ direction, ...props }: Omit<ComponentProps<typeof Button>, 'children' | 'size'> & { direction: 'previous' | 'next' }) {
  const label = direction === 'previous' ? '上一页' : '下一页'
  const Icon = direction === 'previous' ? ChevronLeft : ChevronRight
  return (
    <Button type="button" variant="outline" size="icon" className="size-8 shrink-0 rounded-md" title={label} aria-label={label} {...props}>
      <Icon className="size-4" strokeWidth={1.75} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </Button>
  )
}
