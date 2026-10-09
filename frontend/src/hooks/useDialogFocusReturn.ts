import { useRef } from 'react'
import { useSectionActive } from '@/components/layout/SectionVisibilityContext'

function canRestoreFocus(target: HTMLElement) {
  if (!target.isConnected || target.matches(':disabled')) return false
  for (let node: HTMLElement | null = target; node; node = node.parentElement) {
    const style = window.getComputedStyle(node)
    if (node.hidden || node.hasAttribute('inert') || style.display === 'none' || style.visibility === 'hidden') return false
  }
  return true
}

/** DialogContent/AppDialog 共用；显式草稿 handler 保留自己的回焦归属。 */
export function useDialogFocusReturn({ onOpenAutoFocus, onCloseAutoFocus, captureOpen }: {
  captureOpen?: boolean
  onOpenAutoFocus?: (event: Event) => void
  onCloseAutoFocus?: (event: Event) => void
}) {
  const active = useSectionActive()
  const activeRef = useRef(active)
  activeRef.current = active
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const previousOpen = useRef(false)
  // Sale pickers opt in: React input autoFocus runs before Radix's open event.
  // Capture during the parent's opening render, before its portal children mount.
  if (captureOpen !== undefined) {
    if (captureOpen && !previousOpen.current) {
      const target = document.activeElement
      restoreFocusRef.current = target instanceof HTMLElement && target !== document.body ? target : null
    }
    previousOpen.current = captureOpen
  }
  return {
    onOpenAutoFocus: (event: Event) => {
      // Capture before the caller changes focus or the FocusScope enters.
      const target = document.activeElement
      if (captureOpen === undefined) restoreFocusRef.current = target instanceof HTMLElement && target !== document.body ? target : null
      onOpenAutoFocus?.(event)
    },
    onCloseAutoFocus: (event: Event) => {
      onCloseAutoFocus?.(event)
      if (event.defaultPrevented) return
      if (!activeRef.current) { event.preventDefault(); return }
      const target = restoreFocusRef.current
      // With no remembered element, keep Radix's own Trigger behavior.
      if (!target) return
      event.preventDefault()
      if (canRestoreFocus(target)) target.focus({ preventScroll: true })
    },
  }
}
