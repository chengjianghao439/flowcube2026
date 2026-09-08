import { useState } from 'react'
import { useSectionActive } from '@/components/layout/SectionVisibilityContext'

/** Portal 浮层随所属页面隐藏，但不调用业务关闭回调或清空调用方草稿。 */
export function useVisibleDisclosure({ open, defaultOpen = false, onOpenChange }: { open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void }) {
  const active = useSectionActive()
  const [localOpen, setLocalOpen] = useState(defaultOpen)
  return {
    open: active && (open ?? localOpen),
    onOpenChange: (next: boolean) => {
      if (!active) return
      setLocalOpen(next)
      onOpenChange?.(next)
    },
  }
}
